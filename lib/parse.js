// Parser determinístico de laudos laboratoriais (pt-BR).
// Nenhum dado sai da máquina: tudo roda em JavaScript puro.

import {
  ANALYTES,
  IGNORE_PATTERNS,
  REF_CUT,
  URINE_SECTION,
  BLOOD_SECTION,
  URINE_ANALYTES,
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
  /\b(convenio|conv\.|rg|cpf|cns|idade|sexo|dn\b|nasc|data|atendimento|cod\.|codigo|protocolo|os\b|registro|leito|quarto|medico|dr\.|dra\.|solicitante|prescri\w*|prontu\w*|fap\b|cip\b|local\b|abertura)\b.*/i;

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
  // profundidade de parênteses por posição: números DENTRO de parênteses são
  // parte do nome do ensaio ("PTH (1-84)"), nunca o resultado
  const depth = [];
  let d = 0;
  for (let i = 0; i < seg.length; i++) {
    if (seg[i] === '(') d++;
    depth.push(d);
    if (seg[i] === ')') d = Math.max(0, d - 1);
  }
  // gap entre nome e valor: só separadores, parênteses (unidades) e "resultado"
  // rejeita se houver palavra estranha ou região mascarada no caminho
  NUM_RE.lastIndex = 0;
  let m;
  let firstHundred = null;
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
    // pula números dentro de parênteses ("PTH (1-84)")
    if (depth[m.index] > 0) {
      continue;
    }
    // layout em duas colunas (% | absoluto): "Leucócitos 100 9.240" — o
    // primeiro "100" é a coluna de %, o valor real vem depois
    if (opts.twoCol && m[0] === '100' && !firstHundred) {
      firstHundred = { tok: m[0], isPct: false, index: m.index };
      continue;
    }
    const isPct = /^\s*%/.test(after);
    candidates.push({ tok: m[0], isPct, index: m.index, after: after.slice(0, 14) });
    if (candidates.length >= 4) break;
  }
  if (candidates.length === 0) return firstHundred; // "Leucócitos 100" isolado
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
// aceita qualificadores de limite ("> 13,0") e de método ("RESULTADO (37ºC): 325")
const VALUE_LINE = /^\s*(resultado\s*(\([^)]*\))?\s*:*\s*)?[<>]?\s*-?\d/;

// resultados qualitativos (sorologias, autoanticorpos, PCR viral...)
const QUALITATIVE =
  /^(nao\s+)?(reagente|detectado|positivo|negativo|ausente|presente|indetectavel|inconclusivo|reator|padrao|titulo)/;

// faixa de referência isolada em linha própria ("0,50 a 1,00 mg/dL") — em
// alguns laboratórios ela vem ANTES do resultado; nunca é valor
const RANGE_LINE = /^\s*[<>]?\s*-?[\d.,]+\s+(a|ate|até)\s+-?[\d.,]/;

// frases de nota citando relações urinárias ("não foi possível calcular a
// relação... pois a microalbuminúria está abaixo do...") não abrem pendência
const RATIO_NOTE =
  /(pois|nao\s+foi\s+possivel|abaixo|acima|\bpode\b|\bdeve\b|recomend|transitoria|conforme|consenso)/;

// títulos de sorologia/autoanticorpo vêm em caixa mista neste tipo de laudo
const SEROLOGY_HINT =
  /(anti[\s-]|anticorpo|antigeno|sorologia|\bfan\b|\bhiv\b|hbsag|hb[sce]\b|\bhcv\b|\bhbv\b|\bhtlv\b|vdrl|\bfta\b|chagas|toxoplasm|citomegalo|epstein|rubeola|sarampo|dengue|sifilis|treponema|\big[gma]\b|anticoagulante\s+lupico|glicoprote|beta[\s-]?2)/;
const SEROLOGY_STOP =
  /(\buma\b|\bpara\b|\bpelo\b|\bpela\b|\bcom\b|\bser\b|\bque\b|\bdias\b|\bapos\b|\bdevera\b|\bamostra\s+devera\b|\bsuspeita\b|\brecomenda\b|\bindica\b|\bcaso\b)/;

// linhas que nunca são título de exame genérico
const GENERIC_SKIP =
  /(hemograma|eritrograma|leucograma|contagem diferencial|gasometria|coagulograma|plaquetas|resultado|urina\b|\beas\b|observa|\bnota\b|adendo|assinatura|conferido|repetido|confirmado|automatizado|tabela|referencia|\bindice\b|conclusao|comentario|metodo|material)/;

// título de exame FORA do dicionário ("FAN, SANGUE", "ANTICARDIOLIPINA IgG,SANGUE")
function genericTitle(rawCut, normCut) {
  const t = rawCut.trim();
  if (t.length < 4 || t.length > 70) return null;
  if (t.includes(':')) return null;
  // nunca linhas de registro/protocolo ("0011223344X NOME...") ou com número longo
  if (/^\d/.test(t) || /\d{4}/.test(t)) return null;
  if (GENERIC_SKIP.test(normCut)) return null;
  // nunca itens deliberadamente excluídos (CHCM, RDW, VPM...)
  for (const rx of IGNORE_COMPILED) {
    rx.lastIndex = 0;
    if (rx.test(normCut)) return null;
  }
  if (!/[A-Za-zÀ-ÿ]{3}/.test(t)) return null;
  const letters = t.replace(/[^A-Za-zÀ-ÿ]/g, '');
  const upper = letters.replace(/[^A-ZÀ-Ü]/g, '');
  // títulos vêm em CAPS — exceto sorologias/autoanticorpos (caixa mista)
  if (upper.length / letters.length < 0.7) {
    const isSero =
      SEROLOGY_HINT.test(normCut.slice(0, 40)) &&
      !SEROLOGY_STOP.test(normCut) &&
      /^[A-ZÀ-Ü]/.test(t); // continuações de frase começam em minúscula
    if (!isSero) return null;
  }
  let name = t.replace(/[,.]?\s*(SANGUE(\s+TOTAL)?|SORO|PLASMA|URINA[^)]*)\s*$/i, '');
  name = name.replace(/\s*\((SORO|SANGUE[^)]*|PLASMA|EDTA)\)\s*$/i, '');
  name = name.trim().replace(/[,;.]+$/, '');
  return name.length >= 3 ? name.slice(0, 60) : null;
}

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
  let urContext = null; // bloco de microalbuminúria ('MC') ou proteinúria ('PC')
  let inGaso = false; // bloco de gasometria (Na/K/Cl dele são ignorados)
  let inFooter = false; // rodapé "Locais de execução" lista nomes de exames
  let urineSediment = false; // subseção sedimento (prevalece sobre tira reativa)
  let pendingRatio = null; // {a, ttl} — P/C ou M/C com valor em linha posterior
  let pending = null; // {a, ttl} — analito cujo valor vem em linha posterior
  let pendingGeneric = null; // {name, ttl} — exame FORA do dicionário
  let srcLine = ''; // linha atual (para rastreio/debug)
  const results = [];
  const seen = new Set();

  // tokens de resultado urinário (CAPS = resultado; caixa mista = referência)
  const URINE_QUAL_CAPS =
    /^(POSITIVOS?|NEGATIVOS?|AUSENTES?|PRESENTES?|RAR[AO]S|RAERAS|NUMEROS[AO]S|NORMAL|TRA[ÇC]OS|ESCASS[AO]S|MODERAD[AO]S|INCONT[ÁA]VEIS|MILH[ÃA]O|MILH[ÕO]ES|URATO|AMORFO|HIALINO|GRANULOSO)$/;
  const URINE_QUAL_ANY =
    /^(positivos?|negativos?|ausentes?|presentes?|rar[ao]s|numeros[ao]s|normal|tra[çc]os)$/i;

  const urineByKey = new Map();
  function pushUrine(u, val, isSed) {
    const dt = currentDTNow();
    const key = `${u.id}|${dt ? dt.sortKey : 'x'}`;
    const existing = urineByKey.get(key);
    if (existing) {
      // sedimento prevalece sobre a tira reativa (Leuco/Erit)
      if (isSed && !existing.sed) {
        existing.raw = val;
        existing.sed = true;
      }
      return;
    }
    const r = { id: u.id, label: u.label, value: NaN, raw: val, pct: false, dt, sed: isSed, urine: true };
    if (opts.debug) r.src = srcLine.trim().slice(0, 100);
    urineByKey.set(key, r);
    results.push(r);
  }

  // uma linha dentro da seção de urina
  function urineLine(nline, rline) {
    // relações P/C e M/C (dentro ou fora de urina)
    for (const a of COMPILED) {
      if (!['PC', 'MC', 'U-CrQ', 'U-AlbQ', 'U-ProtQ'].includes(a.id)) continue;
      for (const { rx } of a.compiled) {
        rx.lastIndex = 0;
        const m = rx.exec(nline);
        if (!m) continue;
        const v = findValue(nline, m.index + m[0].length, {});
        if (v) pushResult(a, v, currentDTNow());
        else if (!RATIO_NOTE.test(nline)) pendingRatio = { a, ttl: 8 };
        return;
      }
    }
    if (pendingRatio && VALUE_LINE.test(nline.trim()) && !RANGE_LINE.test(nline)) {
      const v = findValue(nline, 0, {});
      if (v) {
        const intDigits = v.tok.replace(',', '.').split('.')[0].replace('-', '').length;
        const bare = /^\s*(resultado\s*(\([^)]*\))?\s*:*\s*)?[<>]?\s*-?[\d.,]+\s*$/.test(nline.trim());
        if (intDigits <= 6 && (bare || UNIT_AFTER.test(v.after || ''))) {
          pushResult(pendingRatio.a, v, currentDTNow());
          pendingRatio = null;
          return;
        }
      }
    }

    for (const u of URINE_ANALYTES) {
      const m = nline.match(u.re);
      if (!m) continue;
      const restRaw = rline.trim().slice(m[0].length).trim();
      let val = null;
      if (u.id === 'U-Dism') {
        const dm = rline.match(/(aus[êe]ncia|presen[çc]a)[^0-9]{0,45}/i);
        if (dm) val = dm[0].trim().replace(/\s+/g, ' ');
      }
      if (!val) {
        // resultado em CAPS até encontrar referência em caixa mista
        const toks = restRaw.split(/\s+/);
        const got = [];
        for (const tk of toks) {
          if (/^\+{1,4}$/.test(tk) || /^>\s?[\d.,]+$/.test(tk) || URINE_QUAL_CAPS.test(tk)) {
            got.push(tk);
            continue;
          }
          break;
        }
        if (!got.length && toks[0] && URINE_QUAL_ANY.test(toks[0])) got.push(toks[0]);
        if (got.length) val = got.join(' ');
      }
      if (!val) {
        const v = findValue(nline, m[0].length, {});
        if (v) {
          let rawDisp = v.tok;
          if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(rawDisp)) rawDisp = rawDisp.replace(/\./g, '');
          val = rawDisp.replace('.', ',');
        }
      }
      if (val) pushUrine(u, val, urineSediment);
      return;
    }

    if (pendingRatio && /\d/.test(nline) && --pendingRatio.ttl <= 0) pendingRatio = null;
  }

  function pushGeneric(name, val) {
    const id = 'GEN:' + normalize(name).replace(/[^a-z0-9]+/g, '-');
    const dt = currentDTNow();
    const key = `${id}|${dt ? dt.sortKey : 'x'}`;
    if (seen.has(key)) return;
    seen.add(key);
    const r = { id, label: name, value: NaN, raw: val, pct: false, dt, generic: true };
    if (opts.debug) r.src = srcLine.trim().slice(0, 100);
    results.push(r);
  }

  function currentDTNow() {
    if (coletaIdx < 0 && releaseIdx < 0) return null;
    if (releaseIdx > coletaIdx) {
      usedRelease = true;
      return releaseDT;
    }
    return coletaDT;
  }

  // fator de conversão da unidade urinária para mg/dL
  function urineUnitFactor(after) {
    const u = (after || '').trim().toLowerCase();
    if (u.startsWith('mg/dl')) return 1;
    if (u.startsWith('mg/l')) return 0.1;
    if (u.startsWith('g/dl')) return 1000;
    if (u.startsWith('g/l')) return 100;
    return 1; // assume mg/dL
  }

  function pushResult(a, v, dt, qual = '') {
    let value = parseNumberBR(v.tok);
    if (Number.isNaN(value)) return false;
    // componentes urinários: valor normalizado para mg/dL (para o cálculo)
    if (a.hidden) value *= urineUnitFactor(v.after);
    // eletrólitos medidos pela gasometria não são transcritos (o valor de
    // referência é o do laboratório)
    if (inGaso && (a.id === 'Na' || a.id === 'K' || a.id === 'Cl')) return false;
    // plausibilidade: creatinina > 30 mg/dL não existe (linha de referência,
    // protocolo etc.)
    if (a.id === 'Cr' && value > 30) return false;
    let id = a.id;
    let key = `${id}|${dt ? dt.sortKey : 'x'}`;
    if (seen.has(key)) {
      // segundo cálcio iônico da MESMA liberação (gasometria + laboratório):
      // guarda como CaI2 — o formatador decide qual é o CaM (menor)
      if (a.id !== 'CaI') return false;
      id = 'CaI2';
      key = `${id}|${dt ? dt.sortKey : 'x'}`;
      if (seen.has(key)) return false;
    }
    seen.add(key);
    let rawDisp = v.tok;
    if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(rawDisp)) {
      rawDisp = rawDisp.replace(/\./g, ''); // ponto de milhar
    }
    rawDisp = rawDisp.replace('.', ','); // decimal sempre com vírgula
    const r = { id, label: a.label, value, raw: qual + rawDisp, pct: v.isPct, dt };
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

    // fallback de data POR BLOCO: "Liberado em"/"Recebido em"
    // (mantém a HORA para não colapsar exames seriados do mesmo dia)
    if (/(liberad|recebid)/.test(norm)) {
      const dm = rawLine.match(DATE_RE);
      if (dm) {
        const afterDate = rawLine.slice(rawLine.indexOf(dm[0]) + dm[0].length);
        const tm = afterDate.match(TIME_RE);
        releaseDT = toDT(dm, tm);
        releaseIdx = lineIdx;
      }
    }

    // bloco de gasometria: do título até o próximo bloco (solicitação/
    // liberação/assinatura). No ICr inclui os sub-blocos "SODIO, SANGUE
    // TOTAL" etc. (analisador de gases) — os do laboratório vêm "(SORO)".
    if (/gasometria/.test(norm)) inGaso = true;
    else if (inGaso && /(solicit|liberad|assinad)/.test(norm)) inGaso = false;

    // linhas administrativas não carregam resultados
    if (ADMIN_SKIP.test(norm)) {
      // nova solicitação encerra o contexto de microalbuminúria/proteinúria
      if (/solicit/.test(norm)) urContext = null;
      continue;
    }
    // hash de assinatura eletrônica (64 hex)
    if (/^[0-9a-f]{32,}\s*$/.test(norm.trim())) continue;
    // rodapé final: lista de exames por local de execução — nunca resultados
    if (/locais\s+de\s+execucao/.test(norm)) inFooter = true;
    if (inFooter) continue;

    // blocos de HISTÓRICO trazem resultados de datas antigas — pular e
    // encerrar pendências (o resultado atual já veio antes)
    if (/^\s*(historico\b|grafico\s+de\s+historico)/.test(norm)) {
      pending = null;
      pendingGeneric = null;
      pendingRatio = null;
      continue;
    }

    // seções de urina: modo próprio (grupo U1) até voltar a sangue/soro
    if (URINE_SECTION.test(norm)) {
      inUrine = true;
      if (/sediment|elementos\s+anormais/.test(norm)) urineSediment = true;
      else if (/caracteres|bioquimic|urina,?\s+exame|exame\s+de\s+urina/.test(norm)) urineSediment = false;
      // contexto de bloco: a relação pode vir em linha própria "438,9 mg/g"
      // com o nome quebrado em colunas (layout ICr)
      if (/microalbuminuria/.test(norm)) urContext = 'MC';
      else if (/proteina|proteinuria/.test(norm)) urContext = 'PC';
      // título de relação, componente urinário ou P/C-M/C na própria linha
      outer: for (const a of COMPILED) {
        if (!['PC', 'MC', 'U-CrQ', 'U-AlbQ', 'U-ProtQ'].includes(a.id)) continue;
        for (const { rx } of a.compiled) {
          rx.lastIndex = 0;
          if (rx.test(norm)) {
            pendingRatio = { a, ttl: 8 };
            break outer;
          }
        }
      }
      pending = null;
      pendingGeneric = null;
      continue;
    }
    if (inUrine && BLOOD_SECTION.test(norm)) {
      inUrine = false;
      urineSediment = false;
      pendingRatio = null;
    }

    // corta valores de referência (rawCut preserva o texto original alinhado)
    let line = norm;
    let rawCut = rawLine;
    const refM = line.match(REF_CUT);
    if (refM) {
      line = line.slice(0, refM.index);
      rawCut = rawLine.slice(0, refM.index);
    }
    if (!line.trim()) continue;

    // relação impressa em linha própria com unidade mg/g (nome quebrado em
    // colunas): "438,9 mg/g creat." dentro do bloco de micro/proteinúria
    if (urContext && /^\s*[<>]?\s*-?[\d.,]+\s*mg\/g/.test(line.trim())) {
      const v = findValue(line, 0, {});
      if (v) {
        const a =
          urContext === 'MC' ? { id: 'MC', label: 'M/C' } : { id: 'PC', label: 'P/C' };
        pushResult(a, v, currentDTNow());
        urContext = null;
        continue;
      }
    }

    // dentro da seção de urina: processamento próprio (grupo U1 + P/C + M/C)
    if (inUrine) {
      urineLine(line.trim(), rawCut);
      continue;
    }

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

    // ---- valor para exame genérico pendente (fora do dicionário):
    // numérico ("RESULTADO: 39 GPL"), titulado ("1/160") ou qualitativo
    // ("Reagente, padrão pontilhado fino 1/160")
    if (pendingGeneric && !REF_WRAP.test(line) && !RANGE_LINE.test(line)) {
      // "Resultado Inferior a 0,09" -> "Resultado < 0,09"
      const nt = line
        .trim()
        .replace(/\binferior\s+a\s+(?=\d)/g, '< ')
        .replace(/\bsuperior\s+a\s+(?=\d)/g, '> ');
      const t = rawCut
        .trim()
        .replace(/\binferior\s+a\s+(?=\d)/gi, '< ')
        .replace(/\bsuperior\s+a\s+(?=\d)/gi, '> ');
      const rm = nt.match(/^resultado\s*(\([^)]*\))?\s*:?\s*/);
      const rest = rm ? t.slice(rm[0].length).trim() : t;
      const restNorm = rm ? nt.slice(rm[0].length).trim() : nt;
      let val = null;
      if (/^[<>]?\s*-?\d/.test(restNorm) && (rm || VALUE_LINE.test(nt))) {
        const m2 = restNorm.match(
          /^([<>]?\s*-?[\d.,]+(\s*\/\s*[\d.,]+)?)(\s*[a-zµμ%][\w/µμ%³.]*)?/
        );
        if (m2) {
          const intDigits = m2[1].replace(/[^\d.,]/g, '').split(/[.,]/)[0].length;
          if (intDigits <= 6) val = rest.slice(0, m2[0].length).trim();
        }
      } else if ((rm || QUALITATIVE.test(restNorm) || /\d\s*\/\s*\d/.test(restNorm)) && restNorm) {
        val = rest.slice(0, 60).trim();
        // corta referência colada ("Detectado Não Detectado" -> "Detectado")
        if (!/^n[aã]o\b/i.test(val)) {
          val = val.replace(/\s+(n[aã]o\s+(detectado|reagente)|indetect[aá]vel)\s*$/i, '');
        }
        // frases de nota e tabelas de referência não são resultado
        const words = val ? val.split(/\s+/).length : 0;
        if (val && ((words > 6 && !/\d\s*\/\s*\d/.test(val)) || val.includes(':'))) {
          val = null;
        }
      }
      if (val) {
        pushGeneric(pendingGeneric.name, val);
        pendingGeneric = null;
        continue;
      }
    }

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
        pendingGeneric = null;
      } else if (matched.length > 1) {
        pending = null; // título de exame combinado ("UREIA E CREATININA") — ambíguo
        pendingGeneric = null;
      } else {
        // nenhum analito conhecido: pode ser exame fora do dicionário
        const gname = genericTitle(rawCut, line);
        if (gname) {
          pendingGeneric = { name: gname, ttl: 6 };
          pending = null;
        }
      }
      continue;
    }

    // ---- linha só-valor para um analito pendente
    // exige forma "VALOR unidade ..." ou linha apenas com o número — nunca
    // continuação de faixa de referência ("1 a 14 anos Homens: 186 388 mg/dL")
    if (pending && VALUE_LINE.test(line.trim()) && !REF_WRAP.test(line) && !RANGE_LINE.test(line)) {
      const v = findValue(line, 0, { percent: pending.a.percent });
      if (v) {
        // plausibilidade: descarta protocolos/registros (>6 dígitos inteiros)
        const intDigits = v.tok.replace(',', '.').split('.')[0].replace('-', '').length;
        const after = line.slice(v.index + v.tok.length);
        const bareNumber = /^\s*(resultado\s*(\([^)]*\))?\s*:*\s*)?[<>]?\s*-?[\d.,]+\s*$/.test(line.trim());
        if (intDigits <= 6 && (bareNumber || UNIT_AFTER.test(after) || v.isPct)) {
          // preserva qualificador de limite ("> 13,0" / "< 0,2")
          const qual = (line.trim().match(/^(?:resultado\s*(?:\([^)]*\))?\s*:*\s*)?([<>])/) || [])[1] || '';
          pushResult(pending.a, v, currentDTNow(), qual);
          pending = null;
          continue;
        }
      }
    }

    // ---- captura normal (nome e valor na mesma linha)
    let valuesOnLine = 0;
    const nameOnly = new Map(); // nomes SEM valor nesta linha
    for (const a of COMPILED) {
      for (const { rx } of a.compiled) {
        rx.lastIndex = 0;
        const current = chars.join('');
        let m;
        while ((m = rx.exec(current)) !== null) {
          const nameEnd = m.index + m[0].length;
          const v = findValue(current, nameEnd, {
            percent: a.percent,
            twoCol: a.twoCol,
          });
          // mascara o nome mesmo sem valor (evita recaptura por padrão genérico)
          maskRange(chars, m.index, nameEnd);
          if (!v) {
            nameOnly.set(a.id, a);
            continue;
          }
          valuesOnLine++;
          nameOnly.delete(a.id);
          pushResult(a, v, currentDTNow());
          // valor veio na própria linha: cancela pendência do mesmo analito
          if (pending && pending.a.id === a.id) pending = null;
          break; // um valor por analito por linha
        }
      }
    }

    // título de exame COM dígitos no nome ("25 HIDROXIVITAMINA D,SANGUE",
    // "PTH (1-84)"): exatamente um nome sem valor e nenhum valor na linha
    // -> o resultado deve vir em linha posterior
    if (valuesOnLine === 0 && nameOnly.size === 1) {
      pending = { a: [...nameOnly.values()][0], ttl: 6 };
      pendingGeneric = null;
    } else if (valuesOnLine === 0 && nameOnly.size === 0) {
      // título de exame genérico COM dígito no nome ("COMPLEMENTO C3,SANGUE")
      // ou com o valor na PRÓPRIA linha ("Anti-HBs - Anticorpo 64,6 mUI/mL",
      // "Toxoplasmose IgG Inferior a 0,2 UI/mL")
      const rawG = rawCut
        .trim()
        // "(Vide Intervalo de Referência Abaixo)" — fecha-parêntese pode ter
        // sido truncado pelo corte de referência
        .replace(/\(\s*vide[^)]*\)?\s*$/i, '')
        .replace(/\(\s*$/, '')
        .replace(/\binferior\s+a\s+(?=[\d<])/gi, '< ')
        .replace(/\bsuperior\s+a\s+(?=[\d>])/gi, '> ')
        .trim();
      const inline = rawG.match(
        /^(.{3,60}?)[\s,]+([<>]?\s?-?[\d.,]+(?:\s*\/\s*[\d.,]+)?)\s*([a-zA-Zµμ%][\w/µμ%³.-]{0,12})?\s*$/
      );
      // "Glicoproteína 1 IgA" é nome quebrado, não valor+unidade
      const unitIsIg = inline && inline[3] && /^ig[gma]$/i.test(inline[3]);
      if (inline && !unitIsIg && genericTitle(inline[1], normalize(inline[1]))) {
        // autossuficiente: captura mesmo com pendência ativa (novo exame supera)
        pushGeneric(
          genericTitle(inline[1], normalize(inline[1])),
          inline[2].replace(/\s+/g, '')
        );
        pendingGeneric = null;
      } else if (!pending && !pendingGeneric) {
        const gname = genericTitle(rawG, normalize(rawG));
        if (gname) pendingGeneric = { name: gname, ttl: 6 };
      }
    }

    // TTL não conta linhas de referência quebrada — fazem parte do mesmo bloco
    if (pending && !REF_WRAP.test(line) && --pending.ttl <= 0) pending = null;
    if (pendingGeneric && !REF_WRAP.test(line) && --pendingGeneric.ttl <= 0) {
      pendingGeneric = null;
    }
  }

  // P/C e M/C calculados a partir das dosagens urinárias quando o laudo não
  // traz a relação pronta (mesma liberação; valores já em mg/dL)
  {
    const bySort = new Map();
    for (const r of results) {
      const k = r.dt ? r.dt.sortKey : 'x';
      if (!bySort.has(k)) bySort.set(k, new Map());
      if (!bySort.get(k).has(r.id)) bySort.get(k).set(r.id, r);
    }
    for (const [, g] of bySort) {
      const cr = g.get('U-CrQ');
      if (!cr || !(cr.value > 0)) continue;
      const prot = g.get('U-ProtQ');
      const alb = g.get('U-AlbQ');
      const dt = cr.dt;
      if (prot && !g.has('PC')) {
        const v = prot.value / cr.value; // mg/mg
        results.push({
          id: 'PC', label: 'P/C', value: v,
          raw: v.toFixed(2).replace('.', ','), pct: false, dt,
        });
      }
      if (alb && !g.has('MC')) {
        const v = (alb.value / cr.value) * 1000; // mg/g
        results.push({
          id: 'MC', label: 'M/C', value: v,
          raw: (v >= 10 ? Math.round(v).toString() : v.toFixed(1)).replace('.', ','), pct: false, dt,
        });
      }
    }
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
