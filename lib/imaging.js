// Laudos de exames de IMAGEM (US, TC, RM, RX, eco, EDA...):
// extrai a(s) seção(ões) de conclusão e a data do exame.
// Saída no formato: "DD/MM/AA: [conclusão]".

import { normalize } from './parse.js';

const DATE_RE = /(\d{2})\/(\d{2})\/(\d{2,4})/;
const DATE_RE_G = /(\d{2})\/(\d{2})\/(\d{2,4})/g;

function toDT(dm) {
  let [, d, mo, y] = dm;
  if (y.length === 4) y = y.slice(2);
  return {
    date: `${d}/${mo}/${y}`,
    time: null,
    sortKey: `20${y}${mo}${d}0000`,
    dayKey: `${d}/${mo}/${y}`,
  };
}

// cabeçalho de conclusão (sobre o texto ORIGINAL, preservando o restante da linha)
const CONCLUSION_HEAD =
  /^\s*(?:conclus[õoó]es?|conclus[ãa]o|impress[ãa]o(?:\s+diagn[óo]stica)?|opini[ãa]o|hip[óo]teses?\s+diagn[óo]sticas?|coment[áa]rios\s+e\s+conclus[õo]es|interpreta[çc][ãa]o)\s*[:.\-]*\s*(.*)$/i;

// fim da conclusão: assinaturas, rodapés, nova seção
const TERMINATOR =
  /(dr\.|dra\.|\bcrm\b|\bcrbm\b|assinad|eletronicamente|digitalmente|impresso\s+em|responsav|\bpagina\b|www\.|http|telefone|tel\s*[:.]|\bcep\b|resultado de exames|atenciosamente)/;

const NEXT_SECTION =
  /^\s*(tecnica|metodo|metodologia|achados|analise|relatorio|descricao|indicacao|equipamento|protocolo|historia\s+clinica)\s*[:.]?\s*$/;

// datas que NUNCA são a data do exame
const DATE_IGNORE = /(nascimento|\bnasc\b|\bdn\b|\bidade\b|impress)/;
// datas fortes (data do próprio exame) e médias (coleta/liberação/genérica)
const DATE_STRONG = /(data\s+d[oe]\s+exame|realizad|data\s+da\s+realizacao|efetuado\s+em|exame\s+em)/;
const DATE_MED = /(colet|liberad|receb|\bdata\b)/;

/**
 * @returns {{ items: Array<{dt, text}>, warnings: string[] }}
 */
export function parseImagingConclusions(text) {
  const lines = text.split(/\r?\n/);
  const items = [];
  const warnings = [];

  let blockBest = null; // melhor data do bloco atual {rank, dt}
  let lastAny = null; // última data plausível vista no documento

  for (let idx = 0; idx < lines.length; idx++) {
    const raw = lines[idx];
    const norm = normalize(raw);

    // classifica CADA data da linha pelo rótulo imediatamente anterior
    // (uma linha pode ter "Data do exame: X ... Impresso em: Y")
    DATE_RE_G.lastIndex = 0;
    let dg;
    while ((dg = DATE_RE_G.exec(norm)) !== null) {
      const ctx = norm.slice(Math.max(0, dg.index - 32), dg.index);
      if (DATE_IGNORE.test(ctx)) continue;
      const rank = DATE_STRONG.test(ctx) ? 3 : DATE_MED.test(ctx) ? 2 : 1;
      const dt = toDT(dg);
      if (!blockBest || rank >= blockBest.rank) blockBest = { rank, dt };
      lastAny = { rank, dt };
    }

    const h = raw.match(CONCLUSION_HEAD);
    if (!h) continue;

    // coleta o texto da conclusão: resto da linha + linhas seguintes
    const buf = [];
    if (h[1] && h[1].trim()) buf.push(h[1].trim());
    let blanks = 0;
    let j = idx + 1;
    for (; j < lines.length && j < idx + 30; j++) {
      const r2 = lines[j];
      const n2 = normalize(r2);
      if (!r2.trim()) {
        blanks++;
        if (blanks >= 2 && buf.length) break;
        continue;
      }
      blanks = 0;
      if (TERMINATOR.test(n2) || NEXT_SECTION.test(n2) || CONCLUSION_HEAD.test(r2)) {
        break;
      }
      buf.push(r2.trim());
    }

    const out = buf.join(' ').replace(/\s+/g, ' ').trim().slice(0, 2000);
    if (out) {
      const dt = (blockBest || lastAny)?.dt ?? null;
      items.push({ dt, text: out });
      if (!dt) {
        warnings.push(
          'Conclusão de exame de imagem sem data identificada — agrupada como "SEM DATA".'
        );
      }
      blockBest = null; // próximo laudo do documento tem a própria data
    }
    idx = j - 1;
  }

  return { items, warnings };
}

/** "DD/MM/AA: [conclusão]", uma linha por laudo, em ordem cronológica */
export function formatImaging(items) {
  const sorted = [...items].sort((a, b) =>
    (a.dt ? a.dt.sortKey : '9').localeCompare(b.dt ? b.dt.sortKey : '9')
  );
  return sorted
    .map((i) => `${i.dt ? i.dt.date : 'SEM DATA'}: ${i.text}`)
    .join('\n');
}

/** dedup entre fontes: mesma data + mesmo início de texto */
export function mergeImaging(sources) {
  const seen = new Set();
  const merged = [];
  for (const src of sources) {
    for (const it of src) {
      const key = `${it.dt ? it.dt.dayKey : 'x'}|${normalize(it.text).slice(0, 80)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(it);
    }
  }
  return merged;
}
