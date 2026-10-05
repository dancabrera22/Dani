// Auditoria de capturas: roda o parser sobre laudos já extraídos (.txt) e
// aponta tudo que merece conferência humana. Não altera nada.
//
//   node scripts/audit-captures.mjs <dir-com-txt> [--all]
//
// Sinalizadores:
//   [FAIXA]   valor fora do fisiologicamente plausível
//   [REF]     a linha de origem parece faixa de referência/legenda
//   [FRACO]   valor veio de linha solta (sem o nome do exame na linha)
//   [UNIDADE] unidade da linha incompatível com o exame (ex.: Cr em g/L)
//   [REPETE]  mesmo valor em 3+ coletas
//   [SEMNOME] nome do exame não aparece na linha de origem
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseReport, normalize } from '../lib/parse.js';
import { ANALYTES } from '../lib/analytes.js';

// padrões por id, para confirmar que o título antecede um valor "fraco"
const COMPILADO = new Map(
  ANALYTES.map((a) => [
    a.id,
    a.patterns.map((pt) => new RegExp(typeof pt === 'string' ? pt : pt.re, 'g')),
  ])
);

// faixas FISIOLÓGICAS amplas — alarme só para o impossível, não para o grave
const FAIXA = {
  Ur: [2, 400], Cr: [0.05, 25], AU: [0.3, 20],
  Na: [100, 180], K: [1.2, 9.5], Cl: [70, 140], Mg: [0.3, 6],
  Ca: [3, 18], P: [0.5, 20], CaI: [1, 10], CaI2: [1, 10],
  pH: [6.6, 7.8], pCO2: [8, 130], pO2: [10, 600], HCO3: [3, 50],
  BE: [-35, 35], SatO2: [20, 100], Lact: [0.2, 250], Glic: [10, 900],
  Hb: [2, 25], Ht: [6, 70], VCM: [45, 135], Leuco: [0.05, 300],
  Plaq: [1, 2000], Ret: [0, 30],
  N: [0, 100], L: [0, 100], M: [0, 100], E: [0, 100], B: [0, 100],
  PT: [1, 12], Alb: [0.4, 7], TGO: [1, 6000], TGP: [1, 6000],
  FA: [10, 4000], GGT: [1, 4000], BT: [0.05, 50], BD: [0.01, 40], BI: [0.01, 40],
  Amilase: [5, 4000], Lipase: [1, 4000], PCR: [0.01, 700], VHS: [1, 150],
  TSH: [0.001, 200], T4L: [0.05, 12], T3: [10, 600], PTH: [1, 4000],
  Ferro: [3, 600], Transf: [30, 700], SatTransf: [0.5, 100],
  Ferritina: [1, 20000], TIBC: [50, 900],
  CT: [40, 900], HDL: [3, 180], LDL: [5, 700], VLDL: [1, 300], Trig: [10, 4000],
  VitD: [2, 200], B12: [20, 5000], A1c: [2.5, 20], LDH: [50, 9000],
  TP: [7, 200], INR: [0.5, 20], TTPa: [12, 300], Fibr: [40, 1500],
  AntiXa: [0, 4], FK: [0.3, 60], SRL: [0.3, 60], EVR: [0.3, 60],
  Osm: [200, 420], IgG: [20, 8000], IgA: [2, 2000], IgM: [2, 2000],
  PC: [0, 40], MC: [0, 8000], CACR: [0, 10],
};

// unidade esperada (fragmento) — divergência vira alerta de material/escala
const UNIDADE = {
  Cr: /mg\/dl/, Ur: /mg\/dl/, Na: /m(eq|mol)/, K: /m(eq|mol)/, Cl: /m(eq|mol)/,
  Ca: /mg\/dl/, P: /mg\/dl/, Mg: /mg\/dl/, Glic: /mg\/dl/,
  Hb: /g\/dl/, PT: /g\/dl/, Alb: /g\/dl/,
  BT: /mg\/dl/, BD: /mg\/dl/, BI: /mg\/dl/,
};

// ids derivados que reusam os padrões de outro analito
const ALIAS = { CaI2: 'CaI' };

const REF_SINAIS =
  /(homens|mulheres|adultos?|criancas?|lactentes?|prematuros?|recem|normal\s*:|desejav|otimo|limitrofe|inferior a|superior a|maior que|menor que|a partir de|valores? de referencia|intervalo|ate\s+\d|\b\d+\s+a\s+\d)/;

function alerta(flags, tag, msg) {
  flags.push(`[${tag}] ${msg}`);
}

const dir = process.argv[2];
const mostrarTudo = process.argv.includes('--all');
if (!dir) {
  console.error('uso: node scripts/audit-captures.mjs <dir-com-txt>');
  process.exit(1);
}

let totalArquivos = 0;
let totalCapturas = 0;
let totalAlertas = 0;

for (const f of readdirSync(dir).filter((x) => x.endsWith('.txt')).sort()) {
  const texto = readFileSync(join(dir, f), 'utf8');
  const p = parseReport(texto, { debug: true });
  const linhasTexto = texto.split(/\r?\n/);
  totalArquivos++;
  const linhas = [];

  // repetição do mesmo valor em 3+ coletas
  const porId = new Map();
  for (const r of p.results) {
    if (!r.dt || r.id.startsWith('GEN:')) continue;
    if (!porId.has(r.id)) porId.set(r.id, new Map());
    const m = porId.get(r.id);
    m.set(r.raw, (m.get(r.raw) || 0) + 1);
  }

  for (const r of p.results) {
    totalCapturas++;
    const flags = [];
    const src = r.src || '';
    const nsrc = normalize(src);
    const num = Number(String(r.value));

    const faixa = FAIXA[r.id];
    if (faixa && Number.isFinite(num)) {
      let v = num;
      if (r.id === 'Leuco') v = v > 100 ? v / 1000 : v; // mil
      if (r.id === 'Plaq') v = v > 10000 ? v / 1000 : v;
      if (v < faixa[0] || v > faixa[1]) {
        alerta(flags, 'FAIXA', `${v} fora de ${faixa[0]}–${faixa[1]}`);
      }
    }

    if (r.weak) {
      // valor de linha solta: o título do exame tem de estar logo acima.
      // Se não estiver, a pendência pode ter vazado de outro exame — foi
      // assim que a bilirrubina e a glicose saíram erradas.
      const idx = linhasTexto.findIndex((l) => l.trim().slice(0, 92) === src);
      let achouTitulo = false;
      if (idx > 0) {
        const alvo = COMPILADO.get(r.id) || COMPILADO.get(ALIAS[r.id]);
        for (let k = Math.max(0, idx - 10); k < idx; k++) {
          const ln = normalize(linhasTexto[k]);
          if (alvo && alvo.some((rx) => { rx.lastIndex = 0; return rx.test(ln); })) {
            achouTitulo = true;
            break;
          }
        }
      }
      if (!achouTitulo) alerta(flags, 'ÓRFÃO', 'título do exame não aparece nas 10 linhas acima');
    }

    if (src && REF_SINAIS.test(nsrc) && !r.id.startsWith('U-')) {
      alerta(flags, 'REF', 'linha de origem tem cara de referência');
    }

    const uni = UNIDADE[r.id];
    if (uni && src && /[a-z]\/[a-z]/.test(nsrc) && !uni.test(nsrc)) {
      alerta(flags, 'UNIDADE', 'unidade incompatível na linha');
    }

    const rep = porId.get(r.id)?.get(r.raw);
    if (rep >= 3) alerta(flags, 'REPETE', `${rep} coletas com o mesmo valor`);

    if (flags.length || mostrarTudo) {
      totalAlertas += flags.length ? 1 : 0;
      linhas.push(
        `  ${r.id.padEnd(9)} ${String(r.raw).padEnd(10)} @${r.dt?.date || 'SEM DATA'} ` +
          `${flags.join(' ')}\n      ↳ ${src.slice(0, 92)}`
      );
    }
  }

  if (linhas.length) {
    console.log(`\n=== ${f}  (${p.patientName || 'sem nome'})`);
    console.log(linhas.join('\n'));
  }
}

console.log(
  `\n--- ${totalArquivos} laudos, ${totalCapturas} capturas, ${totalAlertas} com alerta ---`
);
