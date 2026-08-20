// Formatadores dos dois modelos de saída.
// Regra: itens ausentes são OMITIDOS (sem marcadores).

import {
  ROTINA_CORE,
  DIFF_IDS,
  EXTRA_ORDER,
  MENSALAO_LINES,
  PERCENT_IDS,
  URINE_ORDER,
} from './analytes.js';
import { fmtNum } from './parse.js';

const NO_DT = { date: 'SEM DATA', time: null, sortKey: '99999999999', dayKey: 'SEM DATA' };

function dtOf(r) {
  return r.dt || NO_DT;
}

// Plaquetas: sempre em "mil". Valor bruto (ex. 289000) -> 289; já em mil -> mantém.
function plaqMil(v) {
  return v > 10000 ? v / 1000 : v;
}
// Leucócitos em mil (ROTINA): 4960 -> 4,96; 4,96 -> mantém.
function leucoMil(v) {
  return v > 100 ? v / 1000 : v;
}
// Leucócitos brutos (MENSALÃO): 4,96 -> 4960; 4960 -> mantém.
function leucoAbs(v) {
  return v < 100 ? Math.round(v * 1000) : v;
}

function renderItem(id, r) {
  const pct = PERCENT_IDS.has(id) ? '%' : '';
  return `${r.label} ${r.raw}${pct}`;
}

function renderDiff(byId) {
  const parts = [];
  for (const d of DIFF_IDS) {
    const r = byId.get(d);
    if (r) parts.push(`${d} ${r.raw}%`);
  }
  return parts.length ? `(${parts.join(' ')})` : null;
}

// sedimento urinário: "U1 pH 6,0 Dens 1012 Leuco ... Bacterias NUMEROSAS"
function renderU1(byId) {
  const uparts = [];
  for (const uid of URINE_ORDER) {
    const r = byId.get(uid);
    if (r) uparts.push(`${r.label} ${r.raw}`);
  }
  return uparts.length ? `U1 ${uparts.join(' ')}` : null;
}

// ---- exames FORA do dicionário: bloco separado, o mais compacto possível
// estilo: "18/08/26: EBV IgG NR IgM NR // FAN pontilhado fino 1/80 // anticardiolipina IgG 40"

function compactGenericName(label) {
  // acrônimo entre parênteses vence: "...(EBV)", "(FAN HEp-2)" -> "FAN"
  const par = label.match(/\(([A-Z]{2,6})(?:[\s)-]|$)/);
  if (par) return par[1];
  let n = label.replace(/\(\s*Ig[GMAE]\s*\+\s*Ig[GMAE]\s*\)/gi, ''); // "(IgM+IgG)"
  // "Anti HIV 1/2 - Anticorpos" -> "Anti HIV 1/2";
  // "Hepatite B - HBeAg (...)" -> "HBeAg" (sigla no 2º trecho vence)
  const dash = n.split(/\s+-\s+/);
  if (dash.length > 1 && dash[0].trim().length >= 3) {
    const second = dash[1].trim();
    n = /^[A-Z][a-z]*[A-Z]/.test(second)
      ? second.replace(/\s*\([^)]*\)\s*$/, '')
      : dash[0];
  }
  n = n
    .replace(/\bsorologia\s+para\b/gi, '')
    .replace(/\bpesquisa\s+de\b/gi, '')
    .replace(/\bdetec[çc][ãa]o\s+(quantitativa|qualitativa)\s+de\b/gi, '')
    .replace(/\bdosagem\s+de\b/gi, '')
    .replace(/\banticorpos?\b\s*/gi, '')
    .replace(/\bv[ií]rus\b/gi, '');
  n = n
    .replace(/citomegalov[ií]rus/gi, 'CMV')
    .replace(/epstein\s*ba+rr?/gi, 'EBV')
    .replace(/toxoplasm[oa]se?/gi, 'Toxo')
    .replace(/herpes\s*simples/gi, 'HSV');
  n = n.replace(/\s{2,}/g, ' ').replace(/^[,\s]+|[,\s]+$/g, '').trim();
  return n || label; // nunca vazio
}

function compactGenericValue(raw) {
  let v = raw
    .replace(/n[aã]o\s+reagente/gi, 'NR')
    .replace(/\breagentes?\b/gi, 'R')
    .replace(/n[aã]o\s+detectad[oa]s?/gi, 'ND')
    .replace(/\bnegativ[oa]s?\b/gi, 'Neg')
    .replace(/\bpositiv[oa]s?\b/gi, 'Pos')
    .replace(/\bpadr[ãa]o\b/gi, '')
    .replace(/\bt[ií]tulo\b/gi, '')
    .replace(/\s*\(ac-\d+\)/gi, '') // código de consenso "(AC-4)"
    .replace(/^[íi]ndice:?\s*/i, '');
  // "R, pontilhado fino 1/160" -> "pontilhado fino 1/160" (só com vírgula:
  // "R 45,2" mantém o R, que é informação)
  v = v.replace(/^R,\s*(?=\S)/, '');
  // derruba unidade colada ao número final ("39 GPL" -> "39", "0,09 Índice"
  // -> "0,09"; título 1/80 fica)
  v = v.replace(/(\d)\s+[a-zA-ZÀ-ÿµμ][\w/µμ%³.À-ÿ-]{0,10}\s*$/, '$1');
  return v.replace(/\s{2,}/g, ' ').replace(/^[,\s]+|[,\s]+$/g, '');
}

function renderGenerics(results) {
  const gen = results
    .filter((r) => r.id.startsWith('GEN:'))
    .sort((a, b) => dtOf(a).sortKey.localeCompare(dtOf(b).sortKey));
  if (gen.length === 0) return null;

  // agrupa por dia e por nome-base (IgG/IgM do mesmo exame juntos)
  const byDay = new Map();
  for (const r of gen) {
    const dt = dtOf(r);
    if (!byDay.has(dt.dayKey)) {
      byDay.set(dt.dayKey, { date: dt.date, sort: dt.sortKey, items: new Map() });
    }
    const g = byDay.get(dt.dayKey);
    let name = compactGenericName(r.label);
    let frac = null;
    const fm = name.match(/\b(Ig[GMAE])\b/i);
    if (fm) {
      frac = 'Ig' + fm[1].slice(2).toUpperCase();
      name = (name.slice(0, fm.index) + name.slice(fm.index + fm[0].length))
        .replace(/\s{2,}/g, ' ')
        .trim();
    }
    if (!g.items.has(name)) g.items.set(name, []);
    g.items.get(name).push({ frac, val: compactGenericValue(r.raw) });
  }

  const lines = ['DEMAIS EXAMES:'];
  for (const g of [...byDay.values()].sort((a, b) => a.sort.localeCompare(b.sort))) {
    const segs = [];
    for (const [name, parts] of g.items) {
      const body = parts.map((p) => (p.frac ? `${p.frac} ${p.val}` : p.val)).join(' ');
      segs.push(`${name} ${body}`.trim());
    }
    lines.push(`${g.date}: ${segs.join(' // ')}`);
  }
  return lines.join('\n');
}

// ---------- MODELO ROTINA ----------

export function formatRotina(results) {
  // agrupa por data+hora
  const groups = new Map();
  for (const r of results) {
    const dt = dtOf(r);
    if (!groups.has(dt.sortKey)) groups.set(dt.sortKey, { dt, byId: new Map() });
    const g = groups.get(dt.sortKey);
    if (!g.byId.has(r.id)) g.byId.set(r.id, r);
  }

  const ordered = [...groups.values()].sort((a, b) =>
    a.dt.sortKey.localeCompare(b.dt.sortKey)
  );

  // funde blocos vizinhos (≤45 min, mesmo dia) SEM analitos em comum: são o
  // mesmo painel liberado em lotes. Analito repetido (pré/pós) mantém blocos
  // separados.
  const mergedBlocks = [];
  for (const g of ordered) {
    const prev = mergedBlocks[mergedBlocks.length - 1];
    if (prev && prev.dt.dayKey === g.dt.dayKey && g.dt.time && prev.dt.time) {
      const t1 = parseInt(prev.dt.sortKey.slice(8), 10);
      const t2 = parseInt(g.dt.sortKey.slice(8), 10);
      const diffMin =
        (Math.floor(t2 / 100) - Math.floor(t1 / 100)) * 60 + ((t2 % 100) - (t1 % 100));
      const conflict = [...g.byId.keys()].some((id) => prev.byId.has(id));
      if (diffMin >= 0 && diffMin <= 45 && !conflict) {
        for (const [id, r] of g.byId) prev.byId.set(id, r);
        continue;
      }
    }
    mergedBlocks.push({ dt: g.dt, byId: new Map(g.byId) });
  }

  const blocks = [];
  for (const { dt, byId } of mergedBlocks) {
    const parts = [];
    for (const id of ROTINA_CORE) {
      const r = byId.get(id);
      if (!r) continue;
      if (id === 'Plaq') {
        parts.push(`Plaq ${fmtNum(plaqMil(r.value))}mil`);
      } else if (id === 'Leuco') {
        parts.push(`Leuco ${fmtNum(leucoMil(r.value))}mil`);
        const diff = renderDiff(byId);
        if (diff) parts.push(diff);
      } else {
        parts.push(renderItem(id, r));
      }
    }
    for (const id of EXTRA_ORDER) {
      const r = byId.get(id);
      if (r) parts.push(renderItem(id, r));
    }
    const u1 = renderU1(byId);
    if (u1) parts.push(u1);
    if (parts.length === 0) continue;
    const header = dt.time
      ? `MODELO ROTINA ${dt.date} (${dt.time}):`
      : `MODELO ROTINA ${dt.date}:`;
    blocks.push(`${header} ${parts.join(' ')}`);
  }
  const generics = renderGenerics(results);
  if (generics) blocks.push(generics);
  return blocks.join('\n\n');
}

// ---------- MODELO MENSALÃO ----------

export function formatMensalao(results) {
  if (results.length === 0) return '';

  // por dia (mensalão agrupa por data; hora só no cabeçalho)
  const byDay = new Map(); // dayKey -> Map(id -> r)  (primeira dosagem do dia)
  const byDayAll = new Map(); // dayKey -> Map(id -> [r...])  (todas, p/ pré/pós)
  let latest = null;
  for (const r of results) {
    const dt = dtOf(r);
    if (!byDay.has(dt.dayKey)) {
      byDay.set(dt.dayKey, { dt, byId: new Map() });
      byDayAll.set(dt.dayKey, new Map());
    }
    const g = byDay.get(dt.dayKey);
    const all = byDayAll.get(dt.dayKey);
    if (!all.has(r.id)) all.set(r.id, []);
    all.get(r.id).push(r);
    if (dt.sortKey !== NO_DT.sortKey && (!latest || dt.sortKey > latest.sortKey)) {
      latest = dt;
    }
  }
  // ordena cada lista por horário e define a "primeira do dia"
  for (const [dayKey, all] of byDayAll) {
    const g = byDay.get(dayKey);
    for (const [id, arr] of all) {
      arr.sort((a, b) => dtOf(a).sortKey.localeCompare(dtOf(b).sortKey));
      g.byId.set(id, arr[0]);
    }
  }

  const days = [...byDay.values()].sort((a, b) =>
    a.dt.sortKey.localeCompare(b.dt.sortKey)
  );

  const header = latest
    ? latest.time
      ? `MODELO MENSALÃO ${latest.date} (${latest.time}):`
      : `MODELO MENSALÃO ${latest.date}:`
    : 'MODELO MENSALÃO:';

  const lines = [header];
  const used = new Set(); // ids já impressos, por dia

  for (const lineIds of MENSALAO_LINES) {
    // Ur/Cr: duas dosagens no mesmo dia em horários diferentes -> a primeira
    // sai normal e a última sai em linha própria com o prefixo "Pós"
    if (lineIds[0] === 'Ur' && lineIds[1] === 'Cr') {
      for (const { dt } of days) {
        const all = byDayAll.get(dt.dayKey);
        const urs = all.get('Ur') || [];
        const crs = all.get('Cr') || [];
        const pre = [];
        if (urs[0]) pre.push(`Ur ${urs[0].raw}`);
        if (crs[0]) pre.push(`Cr ${crs[0].raw}`);
        if (pre.length) lines.push(`${dt.date}: ${pre.join(' ')}`);
        const pos = [];
        if (urs.length > 1) pos.push(`Ur ${urs[urs.length - 1].raw}`);
        if (crs.length > 1) pos.push(`Cr ${crs[crs.length - 1].raw}`);
        if (pos.length) lines.push(`${dt.date}: Pós ${pos.join(' ')}`);
        used.add(`${dt.dayKey}|Ur`);
        used.add(`${dt.dayKey}|Cr`);
      }
      continue;
    }
    for (const { dt, byId } of days) {
      const parts = [];
      for (const id of lineIds) {
        const r = byId.get(id);
        if (!r) continue;
        used.add(`${dt.dayKey}|${id}`);
        if (id === 'Plaq') {
          parts.push(`Plaq ${fmtNum(plaqMil(r.value))}mil`);
        } else if (id === 'Leuco') {
          parts.push(`Leuco ${fmtNum(leucoAbs(r.value))}`);
          const diff = renderDiff(byId);
          if (diff) {
            parts.push(diff);
            for (const d of DIFF_IDS) used.add(`${dt.dayKey}|${d}`);
          }
        } else {
          parts.push(renderItem(id, r));
        }
      }
      if (parts.length > 0) {
        lines.push(`${dt.date}: ${parts.join(' ')}`);
      }
    }
  }

  // demais exames (mesmo estilo), agrupados por dia
  const mensIds = new Set(MENSALAO_LINES.flat().concat(DIFF_IDS));
  for (const { dt, byId } of days) {
    const parts = [];
    for (const id of EXTRA_ORDER) {
      if (mensIds.has(id)) continue;
      if (used.has(`${dt.dayKey}|${id}`)) continue;
      const r = byId.get(id);
      if (r) parts.push(renderItem(id, r));
    }
    if (parts.length > 0) lines.push(`${dt.date}: ${parts.join(' ')}`);
    const u1 = renderU1(byId);
    if (u1) lines.push(`${dt.date}: ${u1}`);
  }

  const generics = renderGenerics(results);
  if (generics) {
    lines.push('');
    lines.push(generics);
  }

  return lines.join('\n');
}
