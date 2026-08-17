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

// Formato hospitalar (ICr/SIGH e similares): nº de registro + nome em CAPS,
// sem rótulo. Ex.: "0014163072H DANIEL ALVES DO NASCIMENTO"
const ID_NAME_LINE = /^\s*\d[\dA-Za-z]{5,}\s+([A-Za-zÀ-ÿ' ]{6,})$/;
const NAME_BLACKLIST =
  /(resultado|exame|laborator|hospital|clinic|unidade|solicit|liberad|medic|paciente|convenio|responsav|tecnic|biolog|patolog|supervis|contagem|hemograma|metodo|material|plasma|\bsoro\b|sangue)/;

function looksLikePersonName(name) {
  const words = name.trim().split(/\s+/);
  if (words.length < 2) return false;
  if (!words.every((w) => /^[A-Za-zÀ-ÿ']+$/.test(w))) return false;
  if (NAME_BLACKLIST.test(normalize(name))) return false;
  return true;
}

export function extractPatientName(text) {
  const lines = text.split(/\r?\n/).slice(0, 120);

  // 1) linha com rótulo explícito (Paciente:, Nome:, ...)
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

  // 2) fallback: registro + nome em CAPS nas primeiras linhas
  for (const line of lines.slice(0, 12)) {
    const m = line.match(ID_NAME_LINE);
    if (!m) continue;
    const name = m[1].trim();
    if (name !== name.toUpperCase()) continue; // nomes vêm em CAPS neste formato
    if (looksLikePersonName(name)) {
      return name.replace(/\s+/g, ' ').trim();
    }
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
    // pula números colados a letras: fazem parte de siglas ("(T4L)", "B12", "mm3")
    if (/[a-z]/.test(prevCh)) {
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
// linhas administrativas: nunca contêm resultados e podem confundir o parser
// (NÃO limpam a pendência: em layouts hospitalares o valor pode vir depois da
// quebra de página, com rodapé/cabeçalho no meio)
const ADMIN_SKIP =
  /(solicit|liberad|\bcrm\b|\bcrbm\b|responsav|patolog|biolog|supervis|impress|pagina|emitido|resultado de exames|observac)/;

// linha que é só um valor (formato hospitalar: nome do exame na linha anterior)
// aceita qualificadores de limite ("> 13,0", "< 0,2")
const VALUE_LINE = /^\s*(resultado\s*:*\s*)?[<>]?\s*-?\d/;

// continuação de faixa de referência quebrada em várias linhas
// (ex.: "1 a 14 anos Homens: 186 388 mg/dL")
const REF_WRAP =
  /(\banos?\b|\bmeses\b|homens|mulheres|adultos?|criancas?|\brn\b|gestantes?|referencia|a partir|mudanca|desejav|\bate\b|\bidade\b)/;

// unidade imediatamente após o valor — exigida em linhas só-valor
const UNIT_AFTER =
  /^\s*(%|μ|µ|u[gil]?\b|ui\b|uui\b|mg\b|mg\/|g\/|g\b|d?l\b|meq|mmol|mcg|ng\b|ng\/|pg\b|pg\/|fl\b|mil\b|milh|mm3|mm³|seg\b|\/|x\s?10|k\/)/;

export function parseReport(text, opts = {}) {
  const warnings = [];
  const patientName = extractPatientName(text);
  const rawLines = text.split(/\r?\n/);

  // Datação por bloco: um mesmo PDF pode conter exames de VÁRIAS datas.
  // "Coletado em" (prioridade, com hora) e "Liberado/Recebido em" (fallback,
  // só data) atualizam o marcador corrente; cada exame herda o mais recente.
  let coletaDT = null;
  let coletaIdx = -1;
  let releaseDT = null;
  let releaseIdx = -1;
  let usedRelease = false;
  let inUrine = false;
  let pending = null; // {a, ttl} — analito cujo valor vem em linha posterior
  let srcLine = ''; // linha atual (para rastreio/debug)
  const results = [];
  const seen = new Set();

  function currentDTNow() {
    if (coletaIdx < 0 && releaseIdx < 0) return null;
    if (releaseIdx > coletaIdx) {
      usedRelease = true;
      return releaseDT;
    }
    return coletaDT;
  }

  function pushResult(a, v, dt, qual = '') {
    const value = parseNumberBR(v.tok);
    if (Number.isNaN(value)) return false;
    const key = `${a.id}|${dt ? dt.sortKey : 'x'}`;
    if (seen.has(key)) return false;
    seen.add(key);
    let rawDisp = v.tok;
    if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(rawDisp)) {
      rawDisp = rawDisp.replace(/\./g, ''); // ponto de milhar
    }
    rawDisp = rawDisp.replace('.', ','); // decimal sempre com vírgula
    const r = { id: a.id, label: a.label, value, raw: qual + rawDisp, pct: v.isPct, dt };
    if (opts.debug) r.src = srcLine.trim().slice(0, 100);
    results.push(r);
    return true;
  }

  let lineIdx = -1;
  for (const rawLine of rawLines) {
    lineIdx++;
    srcLine = rawLine;
    const norm = normalize(rawLine);

    // data/hora de coleta (prioridade)
    if (/colet/.test(norm)) {
      const dm = rawLine.match(DATE_RE);
      if (dm) {
        const afterDate = rawLine.slice(rawLine.indexOf(dm[0]) + dm[0].length);
        const tm = afterDate.match(TIME_RE) || rawLine.match(TIME_RE);
        coletaDT = toDT(dm, tm);
        coletaIdx = lineIdx;
        pending = null;
        continue;
      }
    }

    // fallback de data POR BLOCO: "Liberado em"/"Recebido em" (sem hora)
    if (/(liberad|recebid)/.test(norm)) {
      const dm = rawLine.match(DATE_RE);
      if (dm) {
        releaseDT = toDT(dm, null);
        releaseIdx = lineIdx;
      }
    }

    // linhas administrativas não carregam resultados
    if (ADMIN_SKIP.test(norm)) continue;

    // seções de urina: ignora analitos até voltar a sangue/soro
    if (URINE_SECTION.test(norm)) { inUrine = true; pending = null; continue; }
    if (inUrine && BLOOD_SECTION.test(norm)) inUrine = false;
    if (inUrine) continue;

    // corta valores de referência
    let line = norm;
    const refM = line.match(REF_CUT);
    if (refM) line = line.slice(0, refM.index);
    if (!line.trim()) continue;

    const chars = line.split('');

    // mascara falsos amigos (HbA1c, HCM, CA-125, células imaturas...)
    for (const rx of IGNORE_COMPILED) {
      rx.lastIndex = 0;
      let im;
      const masked = chars.join('');
      while ((im = rx.exec(masked)) !== null) {
        maskRange(chars, im.index, im.index + im[0].length);
      }
    }

    const hasDigits = /\d/.test(line);

    // ---- linha SEM dígitos: pode ser cabeçalho de analito ("CREATININA (SORO)")
    if (!hasDigits) {
      const matched = [];
      for (const a of COMPILED) {
        for (const { rx } of a.compiled) {
          rx.lastIndex = 0;
          const current = chars.join('');
          const m = rx.exec(current);
          if (m) {
            maskRange(chars, m.index, m.index + m[0].length);
            matched.push(a);
            break;
          }
        }
      }
      if (matched.length === 1) {
        pending = { a: matched[0], ttl: 6 }; // valor deve aparecer em breve
      } else if (matched.length > 1) {
        pending = null; // título de exame combinado ("UREIA E CREATININA") — ambíguo
      }
      continue;
    }

    // ---- linha só-valor para um analito pendente
    // exige forma "VALOR unidade ..." ou linha apenas com o número — nunca
    // continuação de faixa de referência ("1 a 14 anos Homens: 186 388 mg/dL")
    if (pending && VALUE_LINE.test(line.trim()) && !REF_WRAP.test(line)) {
      const v = findValue(line, 0, { percent: pending.a.percent });
      if (v) {
        // plausibilidade: descarta protocolos/registros (>6 dígitos inteiros)
        const intDigits = v.tok.replace(',', '.').split('.')[0].replace('-', '').length;
        const after = line.slice(v.index + v.tok.length);
        const bareNumber = /^\s*(resultado\s*:*\s*)?[<>]?\s*-?[\d.,]+\s*$/.test(line.trim());
        if (intDigits <= 6 && (bareNumber || UNIT_AFTER.test(after) || v.isPct)) {
          // preserva qualificador de limite ("> 13,0" / "< 0,2")
          const qual = (line.trim().match(/^(?:resultado\s*:*\s*)?([<>])/) || [])[1] || '';
          pushResult(pending.a, v, currentDTNow(), qual);
          pending = null;
          continue;
        }
      }
    }

    // ---- captura normal (nome e valor na mesma linha)
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
          pushResult(a, v, currentDTNow());
          // valor veio na própria linha: cancela pendência do mesmo analito
          if (pending && pending.a.id === a.id) pending = null;
          break; // um valor por analito por linha
        }
      }
    }

    // TTL não conta linhas de referência quebrada — fazem parte do mesmo bloco
    if (pending && !REF_WRAP.test(line) && --pending.ttl <= 0) pending = null;
  }

  if (usedRelease) {
    warnings.push(
      'Blocos sem data de COLETA — usada a data de LIBERAÇÃO de cada bloco. Confira as datas reais de coleta.'
    );
  }
  if (results.length > 0 && !results.some((r) => r.dt)) {
    warnings.push(
      'Nenhuma data/hora de coleta encontrada — os exames foram agrupados como "SEM DATA". Confira o laudo.'
    );
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
