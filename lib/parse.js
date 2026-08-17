// Parser determinístico de laudos laboratoriais (pt-BR).
// Nenhum dado sai da máquina: tudo roda em JavaScript puro.

import {
  ANALYTES,
  IGNORE_PATTERNS,
  REF_CUT,
  URINE_SECTION,
  BLOOD_SECTION,
} from './analytes.js';

// ---------- normalização ----------

export function normalize(s) {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

export function normalizeName(s) {
  return normalize(s).replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

// número pt-BR ou en: "4.960" (milhar), "7,35", "7.35", "-8,4"
const NUM_RE = /-?\d{1,3}(?:\.\d{3})+(?:,\d+)?|-?\d+(?:[.,]\d+)?/g;

export function parseNumberBR(tok) {
  let t = tok;
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(t)) {
    // ponto = milhar
    t = t.replace(/\./g, '').replace(',', '.');
  } else {
    t = t.replace(',', '.');
  }
  return parseFloat(t);
}

// exibe número com vírgula decimal, sem zeros supérfluos
export function fmtNum(n) {
  if (n == null || Number.isNaN(n)) return '';
  if (Number.isInteger(n)) return String(n);
  return String(Math.round(n * 100) / 100).replace('.', ',');
}

// ---------- nome do paciente ----------

const NAME_LINE =
  /^\s*(?:nome\s+do\s+paciente|paciente|nome|cliente)\s*[:\-]\s*(.+)$/i;
const NAME_CUT =
  /\b(convenio|conv\.|rg|cpf|cns|idade|sexo|dn\b|nasc|data|atendimento|cod\.|codigo|protocolo|os\b|registro|leito|quarto|medico|dr\.|dra\.|solicitante)\b.*/i;

export function extractPatientName(text) {
  const lines = text.split(/\r?\n/).slice(0, 120);
  for (const line of lines) {
    const m = line.match(NAME_LINE);
    if (!m) continue;
    let name = m[1];
    // corta em rótulos subsequentes na mesma linha ou colunas separadas por 2+ espaços
    name = name.replace(NAME_CUT, '');
    name = name.split(/\s{2,}|\t/)[0];
    name = name.replace(/[\d|;,.:*_-]+$/g, '').trim();
    // precisa parecer nome de pessoa: ao menos 2 palavras alfabéticas
    const words = name.split(/\s+/).filter((w) => /^[A-Za-zÀ-ÿ']{2,}$/.test(w));
    if (words.length >= 2) return name.toUpperCase().replace(/\s+/g, ' ').trim();
  }
  return null;
}

// ---------- datas de coleta ----------

const DATE_RE = /(\d{2})\/(\d{2})\/(\d{2,4})/;
const TIME_RE = /(\d{1,2}):(\d{2})(?::\d{2})?/;

function toDT(dateMatch, timeMatch) {
  let [, d, mo, y] = dateMatch;
  if (y.length === 4) y = y.slice(2);
  const time = timeMatch
    ? `${timeMatch[1].padStart(2, '0')}:${timeMatch[2]}`
    : null;
  const sortKey = `20${y}${mo}${d}${time ? time.replace(':', '') : '0000'}`;
  return { date: `${d}/${mo}/${y}`, time, sortKey, dayKey: `${d}/${mo}/${y}` };
}

// ---------- construção dos regexes de analitos ----------

function compilePattern(p) {
  const src = typeof p === 'string' ? p : p.re;
  const near = typeof p === 'object' && p.near;
  const body = near
    ? // código curto: até o valor só pode haver separadores (espaço, ":", "=",
      // líderes de pontos "....") — nunca letras (evita "na coleta" -> Na)
      `(?<=^|[^a-z0-9+])(${src})(?=[\\s.:=]*-?\\d)`
    : `(?<=^|[^a-z0-9])(${src})(?=$|[^a-z0-9])`;
  return { rx: new RegExp(body, 'g'), near };
}

const COMPILED = ANALYTES.map((a) => ({
  ...a,
  compiled: a.patterns.map(compilePattern),
}));

const IGNORE_COMPILED = IGNORE_PATTERNS.map(
  (p) => new RegExp(`(?<=^|[^a-z0-9])(${p})(?=$|[^a-z0-9])`, 'g')
);

function maskRange(chars, start, end) {
  for (let i = start; i < end; i++) chars[i] = '\x00';
}

// procura o valor de um analito a partir de `from` na linha
function findValue(line, from, opts) {
  const seg = line.slice(from, from + 60);
  // gap entre nome e valor: só separadores, parênteses (unidades) e "resultado"
  // rejeita se houver palavra estranha ou região mascarada no caminho
  NUM_RE.lastIndex = 0;
  let m;
  const candidates = [];
  while ((m = NUM_RE.exec(seg)) !== null) {
    const before = seg.slice(0, m.index);
    // remove trechos entre parênteses (unidades) do gap
    const gap = before.replace(/\([^)]*\)/g, ' ');
    if (gap.includes('\x00')) break; // atravessou nome mascarado
    const letters = gap.match(/[a-z]{3,}/g) || [];
    const okWords = letters.every((w) => ['resultado', 'result', 'valor'].includes(w));
    if (!okWords) break;
    const after = seg.slice(m.index + m[0].length);
    const prevCh = m.index > 0 ? seg[m.index - 1] : '';
    // pula números que são parte de data/hora (12/08/26, 07:30)
    if (/^\s*[/:]\d/.test(after) || prevCh === '/' || prevCh === ':') {
      continue;
    }
    const isPct = /^\s*%/.test(after);
    candidates.push({ tok: m[0], isPct, index: m.index });
    if (candidates.length >= 4) break;
  }
  if (candidates.length === 0) return null;
  if (opts.percent) {
    const pct = candidates.find((c) => c.isPct);
    if (pct) return pct;
  }
  return candidates[0];
}

// ---------- parser principal ----------

/**
 * Analisa o texto bruto de um laudo.
 * @returns {{ patientName, results: Array<{id,label,value,raw,pct,dt}>, warnings: string[] }}
 */
export function parseReport(text) {
  const warnings = [];
  const patientName = extractPatientName(text);
  const rawLines = text.split(/\r?\n/);

  let currentDT = null;
  let inUrine = false;
  const results = [];
  const seen = new Set();

  for (const rawLine of rawLines) {
    const norm = normalize(rawLine);

    // data/hora de coleta
    if (/colet/.test(norm)) {
      const dm = rawLine.match(DATE_RE);
      if (dm) {
        const afterDate = rawLine.slice(rawLine.indexOf(dm[0]) + dm[0].length);
        const tm = afterDate.match(TIME_RE) || rawLine.match(TIME_RE);
        currentDT = toDT(dm, tm);
        continue;
      }
    }

    // seções de urina: ignora analitos até voltar a sangue/soro
    if (URINE_SECTION.test(norm)) { inUrine = true; continue; }
    if (inUrine && BLOOD_SECTION.test(norm)) inUrine = false;
    if (inUrine) continue;

    // corta valores de referência
    let line = norm;
    const refM = line.match(REF_CUT);
    if (refM) line = line.slice(0, refM.index);
    if (!/\d/.test(line)) continue;

    const chars = line.split('');

    // mascara falsos amigos (HbA1c, HCM, CA-125...)
    for (const rx of IGNORE_COMPILED) {
      rx.lastIndex = 0;
      let im;
      const masked = chars.join('');
      while ((im = rx.exec(masked)) !== null) {
        maskRange(chars, im.index, im.index + im[0].length);
      }
    }

    for (const a of COMPILED) {
      for (const { rx } of a.compiled) {
        rx.lastIndex = 0;
        const current = chars.join('');
        let m;
        while ((m = rx.exec(current)) !== null) {
          const nameEnd = m.index + m[0].length;
          const v = findValue(current, nameEnd, { percent: a.percent });
          // mascara o nome mesmo sem valor (evita recaptura por padrão genérico)
          maskRange(chars, m.index, nameEnd);
          if (!v) continue;
          const value = parseNumberBR(v.tok);
          if (Number.isNaN(value)) continue;
          const dt = currentDT;
          const key = `${a.id}|${dt ? dt.sortKey : 'x'}`;
          if (seen.has(key)) continue;
          seen.add(key);
          let rawDisp = v.tok;
          if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(rawDisp)) {
            rawDisp = rawDisp.replace(/\./g, ''); // ponto de milhar
          }
          rawDisp = rawDisp.replace('.', ','); // decimal sempre com vírgula
          results.push({
            id: a.id,
            label: a.label,
            value,
            raw: rawDisp,
            pct: v.isPct,
            dt,
          });
          break; // um valor por analito por linha
        }
      }
    }
  }

  if (!results.some((r) => r.dt)) {
    if (results.length > 0) {
      warnings.push(
        'Nenhuma data/hora de coleta encontrada — os exames foram agrupados como "SEM DATA". Confira o laudo.'
      );
    }
  }
  if (!patientName) {
    warnings.push('Nome do paciente não encontrado no texto.');
  }

  return { patientName, results, warnings };
}

/**
 * Junta resultados de várias fontes, deduplicando por (analito, data/hora).
 * A primeira ocorrência vence.
 */
export function mergeResults(sources) {
  const seen = new Set();
  const merged = [];
  for (const src of sources) {
    for (const r of src.results) {
      const key = `${r.id}|${r.dt ? r.dt.sortKey : 'x'}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(r);
    }
  }
  return merged;
}
