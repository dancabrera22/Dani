// Culturas: germe isolado, contagem e leitura do antibiograma.
//
// Vale para qualquer material — urina, sangue, líquor, líquido peritoneal,
// ponta de cateter. O prefixo muda com o material; o resto é igual.
//
//   URC negativa
//   URC: Klebsiella pneumoniae 100.000 UFC/mL — MultiS
//   HMC: Staphylococcus epidermidis — MultiR (VancoS, LinezS)
//   Cult peritoneal: Staphylococcus aureus — MultiS
//
// MultiS   = nenhum antibiótico testado veio resistente
// MultiR   = mais da metade dos testados veio resistente
// Sem rótulo quando há resistência mas não é maioria — aí só a lista.
// Os intermediários saem com sufixo I e só quando existem.

import { normalize } from './parse.js';

// Abreviaturas como se escreve na evolução. A ordem importa: o nome mais
// específico tem de ser testado antes do mais genérico (amoxicilina com
// clavulanato antes de amoxicilina).
export const ABREV = [
  [/amoxicilina.*clavulan|amoxi.*clav/, 'AmoxClav'],
  [/piperacilina.*tazobactam|pipe.*tazo/, 'Pipetazo'],
  [/ampicilina.*sulbactam/, 'AmpiSulb'],
  [/ceftazidima.*avibactam/, 'CeftaziAvi'],
  [/sulfametoxazol|trimetoprim|cotrimoxazol|bactrim/, 'SXT'],
  [/amicacina/, 'Amica'],
  [/gentamicina/, 'Genta'],
  [/tobramicina/, 'Tobra'],
  [/ceftazidima/, 'Ceftazi'],
  [/ceftriaxona/, 'Ceftriax'],
  [/cefotaxima/, 'Cefotax'],
  [/cefepima|cefepime/, 'Cefepi'],
  [/cefuroxima/, 'Cefurox'],
  [/cefalotina|cefalexina|cefazolina/, 'Cefalo'],
  [/meropenem/, 'Mero'],
  [/imipenem/, 'Imipe'],
  [/ertapenem/, 'Erta'],
  [/ciprofloxacin/, 'Cipro'],
  [/levofloxacin/, 'Levo'],
  [/norfloxacin/, 'Norflox'],
  [/nitrofurantoina/, 'Nitro'],
  [/fosfomicina/, 'Fosfo'],
  [/vancomicina/, 'Vanco'],
  [/teicoplanina/, 'Teico'],
  [/linezolida/, 'Linez'],
  [/daptomicina/, 'Dapto'],
  [/clindamicina/, 'Clinda'],
  [/eritromicina/, 'Eritro'],
  [/azitromicina/, 'Azitro'],
  [/oxacilina/, 'Oxa'],
  [/penicilina/, 'Peni'],
  [/ampicilina/, 'Ampi'],
  [/amoxicilina/, 'Amox'],
  [/aztreonam/, 'Aztreo'],
  [/polimixina|colistina/, 'Polimix'],
  [/tigeciclina/, 'Tigec'],
  [/rifampicina/, 'Rifa'],
  [/tetraciclina|doxiciclina/, 'Tetra'],
  [/cloranfenicol/, 'Clora'],
];

export function abreviar(nome) {
  const n = normalize(nome);
  for (const [re, curto] of ABREV) if (re.test(n)) return curto;
  // sem abreviatura conhecida: primeira palavra capitalizada, cortada
  const primeira = nome.trim().split(/[\s,(]/)[0];
  return primeira.charAt(0).toUpperCase() + primeira.slice(1, 8).toLowerCase();
}

// "Amicacina .......... R" / "Ceftazidima: Sensível" / "GENTAMICINA S"
const LINHA_ATB =
  /^([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\s\-/.()+]{2,45}?)[\s.:\-]+(S|I|R|sensivel|sensível|intermediario|intermediário|resistente)\s*$/i;

const CRESCIMENTO_NEG =
  /(ausencia\s+de\s+crescimento|nao\s+houve\s+crescimento|cultura\s+negativa|negativa?\b|menor\s+que\s+(10\.?000|1\.?000)|<\s*(10\.?000|1\.?000))/;

/** "100.000 UFC/mL", "≥ 100000 ufc/ml", "10^5 UFC/mL" */
const UFC = /([<>≥≤]?\s*[\d.,]+(\s*x\s*10\^?\d+)?)\s*(ufc|col[oô]nias?)\s*\/\s*m?l/i;

function classe(bruto) {
  const n = normalize(bruto);
  if (/^s$|sensivel/.test(n)) return 'S';
  if (/^i$|intermediario/.test(n)) return 'I';
  if (/^r$|resistente/.test(n)) return 'R';
  return null;
}

// Prefixo por material. A ordem importa: "líquido peritoneal" vem antes de
// "secreção" genérica, e hemocultura antes de sangue.
export const MATERIAIS = [
  [/urocultura|urina/, 'URC'],
  [/hemocultura|frasco\\s+(aerobio|anaerobio)|sangue/, 'HMC'],
  [/liquor|cefalorraquidian|\\blcr\\b/, 'LCR'],
  [/peritoneal|ascit|dialisato|efluente/, 'Cult peritoneal'],
  [/ponta\\s+de\\s+cateter|cateter/, 'Cult cateter'],
  [/traqueal|lavado\\s+bronco|\\blba\\b|escarro/, 'Cult traqueal'],
  [/coprocultura|fezes/, 'Coprocultura'],
  [/ferida|secrecao/, 'Cult secreção'],
];

export function prefixoDe(linhas) {
  const n = normalize(linhas.join(' '));
  for (const [re, p] of MATERIAIS) if (re.test(n)) return p;
  return 'Cultura';
}

/**
 * Lê um bloco de cultura já isolado do laudo.
 * @param linhas array de linhas do bloco
 * @returns null quando não parece cultura
 */
export function lerCultura(linhas) {
  const texto = linhas.join('\n');
  const norm = normalize(texto);

  const prefixo = prefixoDe(linhas);
  const sensiveis = [];
  const intermediarios = [];
  const resistentes = [];
  for (const l of linhas) {
    const m = l.trim().match(LINHA_ATB);
    if (!m) continue;
    const c = classe(m[2]);
    if (!c) continue;
    const nome = abreviar(m[1]);
    if (c === 'S') sensiveis.push(nome);
    else if (c === 'I') intermediarios.push(nome);
    else resistentes.push(nome);
  }

  const testados = sensiveis.length + intermediarios.length + resistentes.length;

  // negativa: sem antibiograma e com frase de ausência de crescimento
  if (testados === 0) {
    return CRESCIMENTO_NEG.test(norm)
      ? { negativa: true, prefixo, texto: `${prefixo} negativa` }
      : null;
  }

  const germe = acharGerme(linhas);
  const mUfc = texto.match(UFC);
  const ufc = mUfc ? `${mUfc[1].replace(/\s+/g, '')} UFC/mL` : '';

  let rotulo = '';
  if (resistentes.length === 0) rotulo = 'MultiS';
  else if (resistentes.length > testados / 2) rotulo = 'MultiR';

  const partes = [];
  if (germe) partes.push(germe);
  if (ufc) partes.push(ufc);
  const cabeca = partes.join(' ');

  const detalhe = [];
  // Quando é MultiS, listar os sensíveis seria repetir o rótulo.
  if (rotulo !== 'MultiS') {
    detalhe.push(...sensiveis.map((n) => `${n}S`));
    detalhe.push(...intermediarios.map((n) => `${n}I`));
  }

  const cauda = [rotulo, detalhe.length ? `(${detalhe.join(', ')})` : '']
    .filter(Boolean)
    .join(' ');

  return {
    negativa: false, prefixo, germe, ufc, sensiveis, intermediarios, resistentes, testados, rotulo,
    texto: `${prefixo}: ${[cabeca, cauda].filter(Boolean).join(' — ')}`,
  };
}

// nomes de gênero mais comuns em urocultura; o laudo escreve "Escherichia
// coli", "Klebsiella pneumoniae", "Proteus mirabilis"...
const GENEROS =
  /(escherichia|klebsiella|proteus|pseudomonas|enterococcus|enterobacter|staphylococcus|streptococcus|serratia|citrobacter|morganella|providencia|acinetobacter|candida|stenotrophomonas|burkholderia)\s+[a-z]+/i;

function acharGerme(linhas) {
  for (const l of linhas) {
    const m = l.match(GENEROS);
    if (m) {
      return m[0]
        .split(/\s+/)
        .map((p, i) => (i === 0 ? p.charAt(0).toUpperCase() + p.slice(1).toLowerCase() : p.toLowerCase()))
        .join(' ');
    }
  }
  return '';
}
