// Formatadores dos dois modelos de saída.
// Regra: itens ausentes são OMITIDOS (sem marcadores).

import {
  ROTINA_CORE,
  DIFF_IDS,
  EXTRA_ORDER,
  MENSALAO_LINES,
  PERCENT_IDS,
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

  const blocks = [];
  for (const { dt, byId } of ordered) {
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
    if (parts.length === 0) continue;
    const header = dt.time
      ? `MODELO ROTINA ${dt.date} (${dt.time}):`
      : `MODELO ROTINA ${dt.date}:`;
    blocks.push(`${header} ${parts.join(' ')}`);
  }
  return blocks.join('\n\n');
}

// ---------- MODELO MENSALÃO ----------

export function formatMensalao(results) {
  if (results.length === 0) return '';

  // por dia (mensalão agrupa por data; hora só no cabeçalho)
  const byDay = new Map(); // dayKey -> Map(id -> r)
  let latest = null;
  for (const r of results) {
    const dt = dtOf(r);
    if (!byDay.has(dt.dayKey)) byDay.set(dt.dayKey, { dt, byId: new Map() });
    const g = byDay.get(dt.dayKey);
    if (!g.byId.has(r.id)) g.byId.set(r.id, r);
    if (dt.sortKey !== NO_DT.sortKey && (!latest || dt.sortKey > latest.sortKey)) {
      latest = dt;
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
  }

  return lines.join('\n');
}
