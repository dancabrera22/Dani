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

// ---- cálcio iônico: dois na mesma amostra -> maior = CaI (paciente),
// menor = CaM (cálcio da máquina, pós-filtro). "(x/4)" = mmol/L.
function calciumPair(entries) {
  const vals = entries.filter(Boolean);
  if (vals.length === 0) return null;
  if (vals.length === 1) return { cai: vals[0], cam: null };
  const sorted = [...vals].sort((a, b) => b.value - a.value);
  return { cai: sorted[0], cam: sorted[sorted.length - 1] };
}
function quarter(v) {
  return (v / 4).toFixed(2).replace('.', ','); // mg/dL -> mmol/L
}
function renderCalcium(pair, withQuarter) {
  if (!pair) return [];
  const out = [`CaI ${pair.cai.raw}${withQuarter ? `(${quarter(pair.cai.value)})` : ''}`];
  if (pair.cam) {
    out.push(`CaM ${pair.cam.raw}${withQuarter ? `(${quarter(pair.cam.value)})` : ''}`);
  }
  return out;
}
// componentes urinários dosados de uma coleta: "NaU 55 KU 30 ... OsmU 500"
const TUB_COMPONENTS = [
  ['U-NaQ', 'NaU'], ['U-KQ', 'KU'], ['U-ClQ', 'ClU'], ['U-CaQ', 'CaU'],
  ['U-PQ', 'PU'], ['U-ProtQ', 'ProtU'], ['U-AlbQ', 'AlbU'],
  ['U-CrQ', 'CrU'], ['U-OsmQ', 'OsmU'], ['U-VolQ', 'VU'],
  ['U-UrQ', 'UrU'], ['U-MgQ', 'MgU'], ['U-AUQ', 'AUu'], ['U-GlicQ', 'GlicU'],
];
function tubComponents(byId) {
  const parts = [];
  for (const [id, label] of TUB_COMPONENTS) {
    const r = byId.get(id);
    if (r) parts.push(`${label} ${fmtNum(r.value)}`);
  }
  return parts.length ? parts.join(' ') : null;
}
// relações já calculadas/impressas (P/C, M/C, Ca/Cr)
function tubRatios(byId) {
  const parts = [];
  for (const [id, label] of [['PC', 'P/C'], ['MC', 'M/C'], ['CACR', 'Ca/Cr'], ['ClCr', 'ClCr']]) {
    const r = byId.get(id);
    if (r) parts.push(`${label} ${r.raw}`);
  }
  return parts.length ? parts.join(' ') : null;
}

// ---- eGFR Schwartz bedside (pediátrico): 0,413 x altura(cm) / Cr.
// A constante 0,413 vale para creatinina enzimática/rastreável a IDMS.
function schwartz(byId, opts) {
  const crs = byId.get('Cr');
  const h = Number(opts && opts.height);
  if (!crs || !(crs.value > 0) || !(h > 0)) return null;
  return (0.413 * h) / crs.value;
}

// Valores derivados do paciente (para feedback imediato na tela): usa a
// creatinina mais recente do conjunto.
export function patientDerived(results, opts = {}) {
  const blocks = buildBlocks(results);
  let last = null;
  for (const b of blocks) if (b.byId.get('Cr')) last = b;
  const sc = bsa(opts.weight, opts.height);
  const eg = last ? schwartz(last.byId, opts) : null;
  return {
    bsa: sc ? sc.m2 : null,
    bsaHow: sc ? sc.how : null,
    egfr: eg,
    hasCr: !!last,
  };
}

// ---- superfície corpórea: com altura usa Mosteller (padrão-ouro);
// só com peso usa Costeff — validada em pediatria justamente nesse caso.
function bsa(weight, height) {
  const w = Number(weight);
  const h = Number(height);
  if (!(w > 0)) return null;
  if (h > 0) {
    return { m2: Math.sqrt((h * w) / 3600), how: `Mosteller √(${fmtNum(h)}x${fmtNum(w)}/3600)` };
  }
  return { m2: (4 * w + 7) / (w + 90), how: `Costeff (4x${fmtNum(w)}+7)/(${fmtNum(w)}+90)` };
}

// ânion gap + índices tubulares com a conta armada, por coleta
function agLines(results, opts = {}) {
  const out = [];
  for (const { dt, byId } of buildBlocks(results)) {
    const segs = [];
    const na = byId.get('Na');
    const cl = byId.get('Cl');
    const hco3 = byId.get('HCO3');
    if (na && cl && hco3) {
      const ag = na.value - cl.value - hco3.value;
      let s = `AG ${na.raw}-(${cl.raw}+${hco3.raw}) = ${fmtNum(Math.round(ag * 10) / 10)}`;
      const alb = byId.get('Alb');
      if (alb && alb.value < 4) {
        const agc = ag + 2.5 * (4 - alb.value);
        s += ` (corr Alb ${alb.raw} = ${fmtNum(Math.round(agc * 10) / 10)})`;
      }
      segs.push(s);
    }
    const nau = byId.get('U-NaQ');
    const ku = byId.get('U-KQ');
    const clu = byId.get('U-ClQ');
    const agu = byId.get('AGU');
    if (nau && ku && clu && agu) {
      segs.push(`AGu (${nau.raw}+${ku.raw})-${clu.raw} = ${agu.raw}`);
    }

    // índices tubulares (componentes urinários normalizados p/ mg/dL)
    const f1 = (v) => fmtNum(Math.round(v * 10) / 10);
    const ps = byId.get('P');
    const crs = byId.get('Cr');
    const ks = byId.get('K');
    const pu = byId.get('U-PQ');
    const cru = byId.get('U-CrQ');
    if (ps && crs && pu && cru && ps.value > 0 && cru.value > 0) {
      const trp = (1 - (pu.value * crs.value) / (ps.value * cru.value)) * 100;
      segs.push(
        `TRP 1-(PU ${fmtNum(pu.value)}xCr ${crs.raw})/(P ${ps.raw}xCrU ${fmtNum(cru.value)}) = ${f1(trp)}%`
      );
    }
    if (ks && crs && ku && cru && ks.value > 0 && cru.value > 0) {
      const fek = ((ku.value * crs.value) / (ks.value * cru.value)) * 100;
      segs.push(
        `FEK (KU ${fmtNum(ku.value)}xCr ${crs.raw})/(K ${ks.raw}xCrU ${fmtNum(cru.value)}) = ${f1(fek)}%`
      );
    }
    if (na && crs && nau && cru && na.value > 0 && cru.value > 0) {
      const fena = ((nau.value * crs.value) / (na.value * cru.value)) * 100;
      segs.push(
        `FENa (NaU ${fmtNum(nau.value)}xCr ${crs.raw})/(Na ${na.raw}xCrU ${fmtNum(cru.value)}) = ${f1(fena)}%`
      );
    }
    // ---- cálcio e fósforo
    const cas = byId.get('Ca');
    const alb2 = byId.get('Alb');
    if (cas && alb2 && alb2.value < 4) {
      segs.push(
        `Ca corrigido ${cas.raw}+0,8x(4-Alb ${alb2.raw}) = ${f1(cas.value + 0.8 * (4 - alb2.value))} mg/dL`
      );
    }
    if (cas && ps) {
      segs.push(`CaxP ${cas.raw}x${ps.raw} = ${f1(cas.value * ps.value)} mg²/dL²`);
    }
    // TmP/GFR (Bijvoet) e FEP — a partir do TRP
    if (ps && crs && pu && cru && ps.value > 0 && cru.value > 0) {
      const trpF = 1 - (pu.value * crs.value) / (ps.value * cru.value);
      const tmp =
        trpF <= 0.86 ? trpF * ps.value : ((0.3 * trpF) / (1 - 0.8 * trpF)) * ps.value;
      segs.push(
        `TmP/GFR ${trpF <= 0.86 ? `TRP ${f1(trpF * 100)}%x` : `(0,3xTRP)/(1-0,8xTRP)x`}P ${ps.raw} = ${f1(tmp)} mg/dL`
      );
      segs.push(`FEP 100-TRP ${f1(trpF * 100)} = ${f1(100 - trpF * 100)}%`);
    }
    // excreções fracionadas adicionais
    const feLine = (label, uComp, sComp, uLbl, sLbl, factor = 1) => {
      if (!uComp || !sComp || !crs || !cru) return;
      if (!(sComp.value > 0) || !(cru.value > 0)) return;
      const fe = ((uComp.value * crs.value) / (factor * sComp.value * cru.value)) * 100;
      segs.push(
        `${label} (${uLbl} ${fmtNum(uComp.value)}xCr ${crs.raw})/(${factor !== 1 ? `${String(factor).replace('.', ',')}x` : ''}${sLbl} ${sComp.raw}xCrU ${fmtNum(cru.value)}) = ${f1(fe)}%`
      );
    };
    feLine('FECa', byId.get('U-CaQ'), cas, 'CaU', 'Ca');
    feLine('FEUr', byId.get('U-UrQ'), byId.get('Ur'), 'UrU', 'Ur');
    feLine('FEMg', byId.get('U-MgQ'), byId.get('Mg'), 'MgU', 'Mg', 0.7);
    feLine('FEUA', byId.get('U-AUQ'), byId.get('AU'), 'AUu', 'AU');

    // ---- ácido-base
    const pco2 = byId.get('pCO2');
    if (hco3 && pco2) {
      const exp = 1.5 * hco3.value + 8;
      segs.push(
        `Winter pCO2 esperado 1,5x${hco3.raw}+8 = ${f1(exp)} (±2) — medido ${pco2.raw}`
      );
    }
    if (na && cl && hco3) {
      const ag2 = na.value - cl.value - hco3.value;
      if (ag2 > 12 && hco3.value < 24) {
        segs.push(
          `Delta gap (AG ${f1(ag2)}-12)/(24-HCO3 ${hco3.raw}) = ${f1((ag2 - 12) / (24 - hco3.value))}`
        );
      }
    }
    // Na corrigido pela glicemia
    const glic2 = byId.get('Glic');
    if (na && glic2 && glic2.value > 100) {
      segs.push(
        `Na corrigido ${na.raw}+0,024x(Glic ${glic2.raw}-100) = ${f1(na.value + 0.024 * (glic2.value - 100))} mEq/L`
      );
    }
    // ---- razões urina/plasma
    if (cru && crs && crs.value > 0) {
      segs.push(`U/P Cr ${fmtNum(cru.value)}/${crs.raw} = ${f1(cru.value / crs.value)}`);
    }

    // osmolaridade sérica calculada: 2×Na + Glic/18 + Ur/6
    const glic = byId.get('Glic');
    const ur = byId.get('Ur');
    const osmsM = byId.get('Osm');
    if (na && glic && ur) {
      const oc = 2 * na.value + glic.value / 18 + ur.value / 6;
      let s = `OsmCalc 2x${na.raw}+${glic.raw}/18+${ur.raw}/6 = ${f1(oc)}`;
      if (osmsM) s += ` (medida ${osmsM.raw}, gap ${f1(osmsM.value - oc)})`;
      segs.push(s);
    }

    const osms = byId.get('Osm');
    const osmu = byId.get('U-OsmQ');
    if (ks && ku && osms && osmu && osms.value > 0 && osmu.value > osms.value) {
      const ttkg = (ku.value / ks.value) / (osmu.value / osms.value);
      segs.push(
        `TTKG (KU ${fmtNum(ku.value)}/K ${ks.raw})/(OsmU ${fmtNum(osmu.value)}/Osm ${osms.raw}) = ${f1(ttkg)}`
      );
    }
    if (osms && osmu && osms.value > 0) {
      segs.push(`U/P Osm ${fmtNum(osmu.value)}/${osms.raw} = ${f1(osmu.value / osms.value)}`);
    }
    // NH4+ estimado pelo gap osmolar urinário (mais confiável que o AGu)
    const uru = byId.get('U-UrQ');
    if (osmu && nau && ku && uru) {
      const glicu = byId.get('U-GlicQ');
      const calc =
        2 * (nau.value + ku.value) + uru.value / 6 + (glicu ? glicu.value / 18 : 0);
      const nh4 = (osmu.value - calc) / 2;
      segs.push(
        `NH4 estimado [OsmU ${fmtNum(osmu.value)}-(2x(NaU ${fmtNum(nau.value)}+KU ${fmtNum(ku.value)})+UrU ${fmtNum(uru.value)}/6${glicu ? `+GlicU ${fmtNum(glicu.value)}/18` : ''})]/2 = ${f1(nh4)} mmol/L`
      );
    }
    // clearance de água livre de eletrólitos (precisa do volume)
    const volW = byId.get('U-VolQ');
    if (volW && volW.value > 0 && nau && ku && na && na.value > 0) {
      const cw = volW.value * (1 - (nau.value + ku.value) / na.value);
      segs.push(
        `ClH2O elet VU ${fmtNum(volW.value)}x[1-(NaU ${fmtNum(nau.value)}+KU ${fmtNum(ku.value)})/Na ${na.raw}] = ${f1(cw)} mL`
      );
    }
    // clearance impresso pelo laboratório: corrige por superfície corpórea
    const clLab = byId.get('ClCr');
    if (clLab && clLab.value > 0) {
      const sc = bsa(opts.weight, opts.height);
      if (sc) {
        segs.push(
          `ClCr corrigido ${clLab.raw}x1,73/SC ${sc.m2.toFixed(2).replace('.', ',')} = ${f1((clLab.value * 1.73) / sc.m2)} mL/min/1,73m² [SC ${sc.how}]`
        );
      }
    }

    // eGFR Schwartz (pediátrico) quando há altura
    if (crs && crs.value > 0 && Number(opts.height) > 0) {
      const eg = (0.413 * Number(opts.height)) / crs.value;
      segs.push(
        `eGFR Schwartz 0,413x${fmtNum(Number(opts.height))}/Cr ${crs.raw} = ${f1(eg)} mL/min/1,73m²`
      );
    }

    // urina de 24 horas: derivados = concentração × volume (componentes
    // marcados .h24 — nunca mistura amostra isolada com volume de 24h)
    const vol = byId.get('U-VolQ');
    if (vol && vol.value > 0) {
      const vmL = vol.value;
      const protU = byId.get('U-ProtQ');
      if (protU && protU.h24) {
        segs.push(
          `Prot24h ProtU ${fmtNum(protU.value)}xVU ${fmtNum(vmL)}/100 = ${f1((protU.value * vmL) / 100)} mg/24h`
        );
      }
      const cau24 = byId.get('U-CaQ');
      if (cau24 && cau24.h24) {
        segs.push(
          `Ca24h CaU ${fmtNum(cau24.value)}xVU ${fmtNum(vmL)}/100 = ${f1((cau24.value * vmL) / 100)} mg/24h`
        );
      }
      if (nau && nau.h24) {
        segs.push(`Na24h NaU ${fmtNum(nau.value)}xVU ${fmtNum(vmL)}/1000 = ${f1((nau.value * vmL) / 1000)} mEq/24h`);
      }
      if (ku && ku.h24) {
        segs.push(`K24h KU ${fmtNum(ku.value)}xVU ${fmtNum(vmL)}/1000 = ${f1((ku.value * vmL) / 1000)} mEq/24h`);
      }
      // excreção de creatinina por kg: valida a completude da coleta de 24 h
      if (cru && cru.h24 && Number(opts.weight) > 0) {
        const w = Number(opts.weight);
        const mg24 = (cru.value * vmL) / 100;
        segs.push(
          `Cr24h/kg (CrU ${fmtNum(cru.value)}xVU ${fmtNum(vmL)}/100)/Peso ${fmtNum(w)} = ${f1(mg24 / w)} mg/kg/24h [coleta adequada ~15-25]`
        );
      }
      if (cru && cru.h24 && crs && crs.value > 0 && !byId.has('ClCr')) {
        const cl = (cru.value * vmL) / (crs.value * 1440);
        segs.push(
          `ClCr (CrU ${fmtNum(cru.value)}xVU ${fmtNum(vmL)})/(Cr ${crs.raw}x1440) = ${f1(cl)} mL/min`
        );
        const sc = bsa(opts.weight, opts.height);
        if (sc) {
          segs.push(
            `ClCr corrigido ${f1(cl)}x1,73/SC ${sc.m2.toFixed(2).replace('.', ',')} = ${f1((cl * 1.73) / sc.m2)} mL/min/1,73m² [SC ${sc.how}]`
          );
        }
      }
    }

    // uma continha por linha, cada uma com a data — legibilidade
    for (let i = 0; i < segs.length; i++) {
      out.push({ sort: `${dt.sortKey}.${i}`, line: `${dt.date}: ${segs[i]}` });
    }
  }
  return out;
}

// relação cálcio total / cálcio iônico do paciente (acúmulo de citrato)
function renderRatio(byId, pair) {
  const ca = byId.get('Ca');
  if (!ca || !pair || !pair.cai.value) return null;
  const ratio = (ca.value / pair.cai.value).toFixed(3).replace('.', ',');
  return `R CaT/CaI ${ca.raw}/${pair.cai.raw} = ${ratio}`;
}

// ---- blocos por coleta (ROTINA/PRISMA): agrupa por data+hora e funde
// liberações vizinhas (≤2 h, mesmo dia) sob a PRIMEIRA liberação. Analito
// repetido mantém blocos separados — exceto CaI (gasometria + laboratório
// da mesma amostra viram o par CaI/CaM).
const MERGE_MIN = 120;
function buildBlocks(results) {
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
  const merged = [];
  for (const g of ordered) {
    const prev = merged[merged.length - 1];
    if (prev && prev.dt.dayKey === g.dt.dayKey && g.dt.time && prev.dt.time) {
      const t1 = parseInt(prev.dt.sortKey.slice(8), 10);
      const t2 = parseInt(g.dt.sortKey.slice(8), 10);
      const diffMin =
        (Math.floor(t2 / 100) - Math.floor(t1 / 100)) * 60 + ((t2 % 100) - (t1 % 100));
      const conflict = [...g.byId.keys()].some(
        (id) => prev.byId.has(id) && id !== 'CaI' && id !== 'CaI2'
      );
      if (diffMin >= 0 && diffMin <= MERGE_MIN && !conflict) {
        for (const [id, r] of g.byId) {
          if (id === 'CaI' || id === 'CaI2') {
            if (!prev.byId.has('CaI')) prev.byId.set('CaI', r);
            else if (!prev.byId.has('CaI2')) prev.byId.set('CaI2', r);
            continue;
          }
          if (!prev.byId.has(id)) prev.byId.set(id, r);
        }
        continue;
      }
    }
    merged.push({ dt: g.dt, byId: new Map(g.byId) });
  }
  return merged;
}

function renderBlock(dt, byId, { withQuarter = false, withRatio = false, opts = {} } = {}) {
  const parts = [];
  const pair = calciumPair([byId.get('CaI'), byId.get('CaI2')]);
  for (const id of ROTINA_CORE) {
    if (id === 'CaI') {
      parts.push(...renderCalcium(pair, withQuarter));
      continue;
    }
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
  const eg = schwartz(byId, opts);
  if (eg) parts.push(`eGFR ${fmtNum(Math.round(eg * 10) / 10)}`);
  if (withRatio) {
    const ratio = renderRatio(byId, pair);
    if (ratio) parts.push(ratio);
  }
  if (parts.length === 0) return null;
  const header = dt.time ? `${dt.date} (${dt.time}):` : `${dt.date}:`;
  return `${header} ${parts.join(' ')}`;
}

function renderDiff(byId) {
  const parts = [];
  for (const d of DIFF_IDS) {
    const r = byId.get(d);
    if (r) parts.push(`${d} ${r.raw}%`);
  }
  return parts.length ? `(${parts.join(' ')})` : null;
}

// sedimento urinário: sempre pH/Dens/Leuco/Erit/Nitrito; os demais SÓ se
// alterados (positivo/numerosas...). Cruzes viram notação clínica: "+/4+".
const U1_ALWAYS = new Set(['U-pH', 'U-Dens', 'U-Leuco', 'U-Erit', 'U-Nitr']);
const U1_NEGATIVE =
  /^(negativos?|ausentes?|normal|n[ãa]o\s+reagentes?|rar[ao]s|raeras|escass[ao]s)$/i;

function u1Value(raw) {
  let v = raw.trim();
  const plus = v.match(/^positivos?\s*(\+{1,4})$/i) || v.match(/^(\+{1,4})$/);
  if (plus) return `${plus[1]}/4+`;
  if (/^positivos?$/i.test(v)) return 'Pos';
  if (/^negativos?$/i.test(v)) return 'Neg';
  if (/^ausentes?$/i.test(v)) return 'Aus';
  return v;
}

function renderU1(byId) {
  const uparts = [];
  for (const uid of URINE_ORDER) {
    const r = byId.get(uid);
    if (!r) continue;
    if (!U1_ALWAYS.has(uid) && U1_NEGATIVE.test(String(r.raw).trim())) continue;
    uparts.push(`${r.label} ${u1Value(String(r.raw))}`);
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

// Seção TUBULOPATIAS: nasce quando a coleta tem dosagens urinárias
// (eletrólitos, calciúria, fosfatúria...) — componentes, relações e as
// continhas dos gradientes ficam aqui.
export function formatTubulopatias(results, opts = {}) {
  const lines = [];
  let hasUrinary = false;
  const ags = new Map(agLines(results, opts).map((a) => [a.sort, a.line]));
  for (const { dt, byId } of buildBlocks(results)) {
    const comps = tubComponents(byId);
    const ratios = tubRatios(byId);
    if (comps || ratios || byId.has('AGU')) hasUrinary = true;
    if (ags.size) hasUrinary = true;
    const head = [comps, ratios].filter(Boolean).join(' ');
    if (head) lines.push(`${dt.date}: ${head}`);
    for (const [k, line] of ags) {
      if (k.startsWith(dt.sortKey + '.')) lines.push(line);
    }
  }
  if (!hasUrinary || lines.length === 0) return '';
  return lines.join('\n');
}

function renderGenerics(results, withAG) {
  const ags = withAG ? agLines(results) : [];
  const gen = results
    .filter((r) => r.id.startsWith('GEN:'))
    .sort((a, b) => dtOf(a).sortKey.localeCompare(dtOf(b).sortKey));
  if (gen.length === 0 && ags.length === 0) return null;
  if (gen.length === 0) {
    return (
      'DEMAIS EXAMES:\n' +
      ags.sort((a, b) => a.sort.localeCompare(b.sort)).map((a) => a.line).join('\n')
    );
  }

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
  for (const a of ags.sort((x, y) => x.sort.localeCompare(y.sort))) {
    lines.push(a.line);
  }
  return lines.join('\n');
}

// ---------- MODELO ROTINA ----------

export function formatRotina(results, opts = {}) {
  const blocks = [];
  for (const { dt, byId } of buildBlocks(results)) {
    const b = renderBlock(dt, byId, { opts });
    if (b) blocks.push(b);
  }
  const generics = renderGenerics(results, false);
  if (generics) blocks.push(generics);
  return blocks.join('\n\n');
}

// ---------- MODELO PRISMA (terapia contínua com citrato) ----------
// Igual à ROTINA, com os cálcios iônicos em mmol/L entre parênteses (x/4),
// o menor como CaM (cálcio da máquina) e, ao final de cada coleta, a
// relação CaT/CaI (cálcio total / cálcio iônico do paciente).
export function formatPrisma(results, opts = {}) {
  const blocks = [];
  for (const { dt, byId } of buildBlocks(results)) {
    const b = renderBlock(dt, byId, { withQuarter: true, withRatio: true, opts });
    if (b) blocks.push(b);
  }
  const generics = renderGenerics(results, false);
  if (generics) blocks.push(generics);
  return blocks.join('\n\n');
}

// ---------- MODELO MENSALÃO ----------

export function formatMensalao(results, opts = {}) {
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
      ? `${latest.date} (${latest.time}):`
      : `${latest.date}:`
    : 'SEM DATA:';

  // par CaI/CaM do dia: cálcios iônicos (CaI/CaI2) da PRIMEIRA amostra do dia
  // (liberações até 2 h após o primeiro)
  function dayCalcium(dayKey) {
    const all = byDayAll.get(dayKey);
    const list = [...(all.get('CaI') || []), ...(all.get('CaI2') || [])].sort((a, b) =>
      dtOf(a).sortKey.localeCompare(dtOf(b).sortKey)
    );
    if (list.length === 0) return null;
    const t0 = parseInt(dtOf(list[0]).sortKey.slice(8), 10);
    const cluster = list.filter((r) => {
      const t = parseInt(dtOf(r).sortKey.slice(8), 10);
      const diff = (Math.floor(t / 100) - Math.floor(t0 / 100)) * 60 + ((t % 100) - (t0 % 100));
      return diff <= MERGE_MIN;
    });
    return calciumPair(cluster);
  }

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
        // URR: redução de ureia na sessão de diálise
        if (urs.length > 1 && urs[0].value > 0) {
          const last = urs[urs.length - 1];
          const urr = ((urs[0].value - last.value) / urs[0].value) * 100;
          lines.push(
            `${dt.date}: URR (${urs[0].raw}-${last.raw})/${urs[0].raw} = ${fmtNum(Math.round(urr * 10) / 10)}%`
          );
        }
        // Kt/V (Daugirdas 2ª geração) + semanal (stdKt/V, FHN/Daugirdas)
        if (urs.length > 1 && urs[0].value > 0) {
          const R = urs[urs.length - 1].value / urs[0].value;
          const tmin = Number(opts.hdTime);
          const w = Number(opts.weight);
          const uf = Number(opts.hdUF); // mL
          if (tmin > 0 && w > 0) {
            const th = tmin / 60;
            const ufL = uf > 0 ? uf / 1000 : 0;
            const sp = -Math.log(R - 0.008 * th) + (4 - 3.5 * R) * (ufL / w);
            if (Number.isFinite(sp) && sp > 0) {
              const f2 = (v) => fmtNum(Math.round(v * 100) / 100);
              lines.push(
                `${dt.date}: Kt/V -ln(${f2(R)}-0,008x${f2(th)})+(4-3,5x${f2(R)})x${f2(ufL)}/${fmtNum(w)} = ${f2(sp)}`
              );
              const e = sp * (tmin / (tmin + 35)); // eKt/V (Tattersall, acesso AV)
              const N = Number(opts.hdSessions) > 0 ? Number(opts.hdSessions) : 3;
              const x = 1 - Math.exp(-e);
              const std = ((10080 * x) / tmin) / (x / e + 10080 / (N * tmin) - 1);
              if (Number.isFinite(std) && std > 0) {
                lines.push(
                  `${dt.date}: stdKt/V semanal (eKt/V ${f2(e)}, ${N}x/sem, ${fmtNum(tmin)} min) = ${f2(std)}`
                );
              }
            }
          }
        }
        const eg = schwartz(byDay.get(dt.dayKey).byId, opts);
        if (eg) {
          lines.push(
            `${dt.date}: eGFR ${fmtNum(Math.round(eg * 10) / 10)} mL/min/1,73m²`
          );
        }
        used.add(`${dt.dayKey}|Ur`);
        used.add(`${dt.dayKey}|Cr`);
      }
      continue;
    }
    for (const { dt, byId } of days) {
      const parts = [];
      for (const id of lineIds) {
        if (id === 'CaI') {
          const pair = dayCalcium(dt.dayKey);
          if (pair) {
            parts.push(...renderCalcium(pair, false));
            used.add(`${dt.dayKey}|CaI`);
            used.add(`${dt.dayKey}|CaI2`);
          }
          continue;
        }
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

  const generics = renderGenerics(results, false);
  if (generics) {
    lines.push('');
    lines.push(generics);
  }

  return lines.join('\n');
}
