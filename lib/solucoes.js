// Componentes de soluções parenterais e cálculos de soro.
// Concentrações conferidas contra a massa molar e validadas com a Dra.
// Danielle (ICr/HC-FMUSP) em 05/10/2026.
//
// Convenções:
//   mEq  — eletrólitos monovalentes e divalentes (carga)
//   mmol — fósforo (a valência varia com o pH, por isso nunca em mEq)
//   osm  — mOsm por mL do componente puro (soma das partículas dissociadas)

export const COMPONENTES = [
  // ---- glicose ----
  { id: 'SG5',   nome: 'SG 5%',            grupo: 'glicose', glicose: 5,  osm: 0.278 },
  { id: 'SG10',  nome: 'SG 10%',           grupo: 'glicose', glicose: 10, osm: 0.556 },
  { id: 'SG25',  nome: 'SG 25%',           grupo: 'glicose', glicose: 25, osm: 1.39 },
  { id: 'SG50',  nome: 'SG 50%',           grupo: 'glicose', glicose: 50, osm: 2.78 },
  // ---- diluentes ----
  { id: 'AD',    nome: 'Água destilada',   grupo: 'diluente', osm: 0 },
  { id: 'SF',    nome: 'SF 0,9%',          grupo: 'diluente', Na: 0.154, Cl: 0.154, osm: 0.308 },
  // ---- sódio ----
  { id: 'NaCl20', nome: 'NaCl 20%',        grupo: 'eletrolito', Na: 3.4,  Cl: 3.4,  osm: 6.84 },
  { id: 'NaCl3',  nome: 'NaCl 3%',         grupo: 'eletrolito', Na: 0.5,  Cl: 0.5,  osm: 1.03 },
  // ---- potássio ----
  { id: 'KCl191', nome: 'KCl 19,1%',       grupo: 'eletrolito', K: 2.56, Cl: 2.56, osm: 5.12 },
  { id: 'KCl10',  nome: 'KCl 10%',         grupo: 'eletrolito', K: 1.34, Cl: 1.34, osm: 2.68 },
  { id: 'FosfK',  nome: 'Fosfato de potássio', grupo: 'eletrolito', K: 2, P: 1, osm: 3 },
  // ---- cálcio ----
  { id: 'GlucCa', nome: 'Gluconato de cálcio 10%', grupo: 'eletrolito', Ca: 0.465, osm: 0.70 },
  { id: 'CaCl10', nome: 'Cloreto de cálcio 10%',   grupo: 'eletrolito', Ca: 1.36, Cl: 1.36, osm: 2.04 },
  // ---- magnésio ----
  { id: 'MgSO4_10', nome: 'Sulfato de Mg 10%', grupo: 'eletrolito', Mg: 0.8, osm: 0.81 },
  { id: 'MgSO4_20', nome: 'Sulfato de Mg 20%', grupo: 'eletrolito', Mg: 1.6, osm: 1.62 },
  { id: 'MgSO4_50', nome: 'Sulfato de Mg 50%', grupo: 'eletrolito', Mg: 4.0, osm: 4.05 },
  // ---- bicarbonato / fósforo ----
  { id: 'Bic84',  nome: 'Bicarbonato 8,4%',  grupo: 'eletrolito', Na: 1,   HCO3: 1,   osm: 2 },
  { id: 'Bic10',  nome: 'Bicarbonato 10%',   grupo: 'eletrolito', Na: 1.2, HCO3: 1.2, osm: 2.4 },
  { id: 'GliceroP', nome: 'Glicerofosfato de sódio', grupo: 'eletrolito', Na: 2, P: 1, osm: 3 },
];

export const POR_ID = new Map(COMPONENTES.map((c) => [c.id, c]));

export const IONS = ['Na', 'K', 'Cl', 'Ca', 'Mg', 'HCO3']; // em mEq
export const IONS_MMOL = ['P']; // fósforo em mmol

/** Holliday-Segar: gasto calórico diário estimado (kcal/dia). */
export function hollidaySegar(pesoKg) {
  const p = Number(pesoKg);
  if (!(p > 0)) return null;
  if (p <= 10) return 100 * p;
  if (p <= 20) return 1000 + 50 * (p - 10);
  return 1500 + 20 * (p - 20);
}

/**
 * Confere um soro já prescrito.
 * @param itens  [{ id, ml }]
 * @param opts   { peso, horas = 24, volumeTotal? }  (volumeTotal completa com AD)
 */
export function calcularSoro(itens, opts = {}) {
  const peso = Number(opts.peso);
  const horas = Number(opts.horas) > 0 ? Number(opts.horas) : 24;
  const usados = itens
    .map((i) => ({ c: POR_ID.get(i.id), ml: Number(i.ml) }))
    .filter((i) => i.c && i.ml > 0);

  const volComponentes = usados.reduce((s, i) => s + i.ml, 0);
  const volumeTotal = Number(opts.volumeTotal) > 0 ? Number(opts.volumeTotal) : volComponentes;
  const volAD = Math.max(0, volumeTotal - volComponentes); // diluente implícito

  // glicose (g) e íons
  let glicoseG = 0;
  let osmTotal = 0;
  const ions = Object.fromEntries([...IONS, ...IONS_MMOL].map((k) => [k, 0]));
  const contas = [];

  for (const { c, ml } of usados) {
    if (c.glicose) {
      const g = (c.glicose * ml) / 100;
      glicoseG += g;
      contas.push(`${c.nome}: ${fmt(ml)} mL x ${c.glicose}/100 = ${fmt(g)} g de glicose`);
    }
    for (const ion of [...IONS, ...IONS_MMOL]) {
      if (c[ion]) {
        const q = c[ion] * ml;
        ions[ion] += q;
        const un = IONS_MMOL.includes(ion) ? 'mmol' : 'mEq';
        contas.push(`${c.nome}: ${fmt(ml)} mL x ${c[ion]} = ${fmt(q)} ${un} de ${ion}`);
      }
    }
    osmTotal += (c.osm || 0) * ml;
  }

  const glicosePct = volumeTotal > 0 ? (glicoseG / volumeTotal) * 100 : 0;
  const taxa = volumeTotal / horas; // mL/h
  const vig = peso > 0 ? (glicosePct * taxa) / (6 * peso) : null; // mg/kg/min
  const osmolaridade = volumeTotal > 0 ? (osmTotal / volumeTotal) * 1000 : 0;
  const ofertaHidrica = peso > 0 ? (volumeTotal / peso) * (24 / horas) : null;

  // por kg/dia e por 100 kcal/dia
  const kcal = hollidaySegar(peso);
  const porKg = {};
  const por100kcal = {};
  for (const ion of [...IONS, ...IONS_MMOL]) {
    const totalDia = ions[ion] * (24 / horas);
    porKg[ion] = peso > 0 ? totalDia / peso : null;
    por100kcal[ion] = kcal ? (totalDia / kcal) * 100 : null;
  }

  return {
    volumeTotal, volComponentes, volAD, horas, taxa,
    glicoseG, glicosePct, vig, osmolaridade, ofertaHidrica,
    kcal, ions, porKg, por100kcal, contas,
    acessoSugerido: osmolaridade > 900 ? 'central' : 'periférico',
  };
}

function fmt(n) {
  if (n == null || Number.isNaN(n)) return '';
  const r = Math.round(n * 100) / 100;
  return String(r).replace('.', ',');
}
export { fmt };
