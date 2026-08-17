// Dicionário de analitos: sinônimos usados por laboratórios brasileiros.
//
// Cada entrada:
//   id      — identificador interno
//   label   — como aparece no texto de saída (ex.: "Ur", "SatO2")
//   patterns— regexes (aplicadas sobre texto normalizado: minúsculas, sem acento)
//             string simples  -> nome completo; aceita separadores (.... : etc.) até o valor
//             {re, near:true} -> código curto; exige o valor IMEDIATAMENTE após (evita
//                                falsos positivos como "na coleta" -> Na)
//   percent — prefere número seguido de "%" (diferencial, saturações, Ht...)
//
// A ORDEM da lista importa: entradas mais específicas vêm antes das genéricas
// (ex.: "colesterol nao-hdl" antes de "hdl"; "calcio ionico" antes de "calcio").
// Após um match, o nome é mascarado na linha para não ser recapturado.

// Trechos que NUNCA são analitos de interesse, mas contêm nomes parecidos.
// São mascarados antes de qualquer captura.
export const IGNORE_PATTERNS = [
  'hemoglobina glicada media estimada',
  'glicemia media estimada',
  'concentracao de hemoglobina corpuscular media',
  'hemoglobina corpuscular media',
  '\\bchcm\\b',
  '\\bhcm\\b',
  '\\brdw(-?cv|-?sd)?\\b',
  'linfocitos atipicos',
  'celulas atipicas',
  'ca[\\s.-]?125',
  'ca[\\s.-]?19[\\s.-]?9',
  'ca[\\s.-]?15[\\s.-]?3',
  'ca[\\s.-]?72[\\s.-]?4',
  'volume plaquetario medio',
  '\\bvpm\\b',
  'bastonetes?',
  'mielocitos',
  'metamielocitos',
  'promielocitos',
  'plasmocitos',
];

// Início de trecho de valores de referência / rodapé — a linha é cortada aqui.
export const REF_CUT =
  /(\bv\.?\s?r\.?\s?[:.]|valor(es)?\s+de\s+referencia|intervalo\s+de\s+referencia|\breferencia\s*[:.]|\bref\.?\s*[:.]|valores\s+normais|\bdesejavel\b|\bnota\s*[:.]|\bmetodo\s*[:.]|\bobs\.?\s*[:.])/;

// Cabeçalhos que indicam seção de URINA (analitos como pH/densidade são ignorados
// até aparecer um cabeçalho de sangue/soro).
export const URINE_SECTION =
  /(urina\s+tipo|urina\s+rotina|\beas\b|urinalise|sumario\s+de\s+urina|urina\s+i\b|urina\s+24|urocultura|exame\s+de\s+urina|elementos\s+anormais)/;

export const BLOOD_SECTION =
  /(hemograma|gasometria|bioquimica|coagulograma|hormonio|imunologia|sorologia|ionograma|eletrolitos|perfil\s+lipidico|material\s*[:.]?\s*(sangue|soro|plasma)|\bsoro\b|\bplasma\b|sangue\s+(total|arterial|venoso))/;

export const ANALYTES = [
  // ---- ignorados “capturáveis” que precisam vir antes (mascarar) ----
  { id: 'A1c',   label: 'HbA1c',   percent: true,  patterns: ['hemoglobina glicada', 'hb\\s?a1c', '\\ba1c\\b', 'glicohemoglobina'] },
  { id: 'LDH',   label: 'LDH',     patterns: ['desidrogenase\\s+latica', '\\bldh\\b', '\\bdhl\\b'] },
  { id: 'CKMB',  label: 'CKMB',    patterns: ['ck[\\s-]?mb', 'cpk[\\s-]?mb'] },
  { id: 'CK',    label: 'CPK',     patterns: ['creatino\\s?fosfo\\s?quinase', 'creatino\\s?quinase', '\\bcpk\\b', { re: 'ck', near: true }] },

  // ---- lipídios (específicos antes dos genéricos) ----
  { id: 'NaoHDL', label: 'Não-HDL', patterns: ['colesterol\\s+nao[\\s-]?hdl', 'nao[\\s-]?hdl', 'n[\\s-]?hdl'] },
  { id: 'VLDL',  label: 'VLDL',    patterns: ['vldl[\\s-]?colesterol', 'colesterol\\s+vldl', '\\bvldl\\b'] },
  { id: 'HDL',   label: 'HDL',     patterns: ['hdl[\\s-]?colesterol', 'colesterol\\s+hdl', '\\bhdl\\b'] },
  { id: 'LDL',   label: 'LDL',     patterns: ['ldl[\\s-]?colesterol', 'colesterol\\s+ldl', '\\bldl\\b'] },
  { id: 'CT',    label: 'CT',      patterns: ['colesterol\\s+total', 'colesterol'] },
  { id: 'Trig',  label: 'Trig',    patterns: ['triglicerid?e?o?s?', 'triglicerides', '\\btg\\b'] },

  // ---- ferro / anemia (específicos antes) ----
  { id: 'SatTransf', label: 'SatTransf', percent: true, patterns: ['indice\\s+de\\s+saturacao\\s+d?[ea]?\\s*transferrina', 'saturacao\\s+d?[ea]?\\s*transferrina', 'sat\\.?\\s*transferrina', 'sat\\s?fe', '\\bist\\b'] },
  { id: 'TIBC',  label: 'TIBC',    patterns: ['capacidade\\s+total\\s+de\\s+(ligacao|fixacao)\\s+d?[oe]?\\s*ferro', 'capacidade\\s+de\\s+(ligacao|fixacao)\\s+d?[oe]?\\s*ferro', '\\bctlf?e?\\b', '\\btibc\\b'] },
  { id: 'Ferritina', label: 'Ferritina', patterns: ['ferritina'] },
  { id: 'Transf', label: 'Transf', patterns: ['transferrina'] },
  { id: 'Ferro', label: 'Ferro',   patterns: ['ferro\\s+serico', '\\bferro\\b', { re: 'fe', near: true }] },

  // ---- hormônios ----
  { id: 'TSH',   label: 'TSH',     patterns: ['hormonio\\s+tireo?estimulante', '\\btsh\\b'] },
  { id: 'T4L',   label: 'T4L',     patterns: ['t4\\s+livre', 'tiroxina\\s+livre', '\\bt4l\\b'] },
  { id: 'T3',    label: 'T3',      patterns: ['t3\\s+(total|livre)', '\\bt3\\b'] },
  { id: 'PTH',   label: 'PTH',     patterns: ['paratormonio', 'pth\\s*(intacto|molecula\\s+intacta)?'] },

  // ---- vitaminas ----
  { id: 'VitD',  label: 'VitD',    patterns: ['25[\\s-]?hidroxi[\\s-]?vitamina\\s?d3?', 'hidroxivitamina\\s?d3?', 'vitamina\\s?d3?\\b', 'vit\\.?\\s?d3?\\b', '25[\\s-]?oh'] },
  { id: 'B12',   label: 'B12',     patterns: ['vitamina\\s?b\\s?12', 'cianocobalamina', '\\bb12\\b'] },
  { id: 'AcFol', label: 'ÁcFólico', patterns: ['acido\\s+folico', 'folato'] },

  // ---- função renal / metabólico ----
  { id: 'Ur',    label: 'Ur',      patterns: ['\\bureia\\b', { re: 'ur', near: true }] },
  { id: 'Cr',    label: 'Cr',      patterns: ['creatinina', { re: 'cr', near: true }] },
  { id: 'AU',    label: 'AU',      patterns: ['acido\\s+urico', '\\burato\\b', { re: 'au', near: true }] },

  // ---- gasometria (SatO2 antes de pO2) ----
  { id: 'SatO2', label: 'SatO2',   percent: true, patterns: ['saturacao\\s+de\\s+o2', 'saturacao\\s+de\\s+oxigenio', 'sat\\.?\\s?o2', '\\bso2\\b', 'o2\\s?sat'] },
  { id: 'pCO2',  label: 'pCO2',    patterns: ['\\bpa?co2\\b', 'pressao\\s+parcial\\s+de\\s+(gas\\s+carbonico|co2)'] },
  { id: 'pO2',   label: 'pO2',     patterns: ['\\bpa?o2\\b', 'pressao\\s+parcial\\s+de\\s+(oxigenio|o2)'] },
  { id: 'HCO3',  label: 'HCO3',    patterns: ['\\bhco3-?\\b', 'bicarbonato', { re: 'bic', near: true }] },
  { id: 'BE',    label: 'BE',      patterns: ['excesso\\s+de\\s+bases?', '\\bs?be(b|ecf)?\\b'] },
  { id: 'pH',    label: 'pH',      patterns: [{ re: 'ph', near: true }] },
  { id: 'Lact',  label: 'Lact',    patterns: ['lactato', 'acido\\s+latico', { re: 'lac', near: true }] },
  { id: 'Glic',  label: 'Glic',    patterns: ['glicose(\\s+em\\s+jejum)?', 'glicemia(\\s+de\\s+jejum)?', { re: 'glic', near: true }] },

  // ---- eletrólitos (específicos antes; códigos curtos exigem valor adjacente) ----
  { id: 'CaI',   label: 'CaI',     patterns: ['calcio\\s+ion(ico|izado)', 'ca\\s+ionico', { re: 'cai', near: true }, { re: 'ca\\+\\+', near: true }] },
  { id: 'Ca',    label: 'Ca',      patterns: ['calcio(\\s+total)?', { re: 'cat', near: true }, { re: 'ca', near: true }] },
  { id: 'P',     label: 'P',       patterns: ['\\bfosforo\\b', '\\bfosfato\\b', { re: 'p', near: true }] },
  { id: 'Na',    label: 'Na',      patterns: ['\\bsodio\\b', { re: 'na\\+?', near: true }] },
  { id: 'K',     label: 'K',       patterns: ['\\bpotassio\\b', { re: 'k\\+?', near: true }] },
  { id: 'Mg',    label: 'Mg',      patterns: ['\\bmagnesio\\b', { re: 'mg\\+?\\+?', near: true }] },
  { id: 'Cl',    label: 'Cl',      patterns: ['\\bcloro\\b', '\\bcloretos?\\b', { re: 'cl-?', near: true }] },

  // ---- hemograma ----
  { id: 'Hb',    label: 'Hb',      patterns: ['hemoglobina', { re: 'hb', near: true }, { re: 'hgb', near: true }] },
  { id: 'Ht',    label: 'Ht',      percent: true, patterns: ['hematocrito', { re: 'ht', near: true }, { re: 'hct', near: true }] },
  { id: 'VCM',   label: 'VCM',     patterns: ['volume\\s+corpuscular\\s+medio', '\\bvcm\\b'] },
  { id: 'Plaq',  label: 'Plaq',    patterns: ['(contagem\\s+de\\s+)?plaquetas', '\\bplaq\\b', '\\bplt\\b'] },
  { id: 'Leuco', label: 'Leuco',   patterns: ['leucocitos(\\s+totais)?', 'globulos\\s+brancos', '\\bleuco\\b', '\\bwbc\\b'] },
  { id: 'N',     label: 'N',       percent: true, patterns: ['neutrofilos\\s+segmentados', 'segmentados', 'neutrofilos'] },
  { id: 'L',     label: 'L',       percent: true, patterns: ['linfocitos(\\s+tipicos)?'] },
  { id: 'M',     label: 'M',       percent: true, patterns: ['monocitos'] },
  { id: 'E',     label: 'E',       percent: true, patterns: ['eosinofilos'] },
  { id: 'B',     label: 'B',       percent: true, patterns: ['basofilos'] },
  { id: 'Ret',   label: 'Ret',     percent: true, patterns: ['reticulocitos', { re: 'ret', near: true }] },

  // ---- proteínas / hepático ----
  { id: 'PT',    label: 'PT',      patterns: ['proteinas?\\s+tota(is|l)', 'prot\\.?\\s+tota(is|l)', { re: 'pt', near: true }] },
  { id: 'Alb',   label: 'Alb',     patterns: ['albumina', { re: 'alb', near: true }] },
  { id: 'TGO',   label: 'TGO',     patterns: ['transaminase\\s+glutamico[\\s-]?oxalacetica', 'aspartato\\s+amino\\s?transferase', '\\btgo\\b', '\\bast\\b', '\\bgot\\b'] },
  { id: 'TGP',   label: 'TGP',     patterns: ['transaminase\\s+glutamico[\\s-]?piruvica', 'alanina\\s+amino\\s?transferase', '\\btgp\\b', '\\balt\\b', '\\bgpt\\b'] },
  { id: 'GGT',   label: 'GGT',     patterns: ['gama[\\s-]?glutamil[\\s-]?transferase', 'gama[\\s-]?gt', '\\bggt\\b'] },
  { id: 'FA',    label: 'FA',      patterns: ['fosfatase\\s+alcalina', { re: 'fal', near: true }, { re: 'fa', near: true }] },
  { id: 'BT',    label: 'BT',      patterns: ['bilirrubina\\s+total', { re: 'bt', near: true }] },
  { id: 'BD',    label: 'BD',      patterns: ['bilirrubina\\s+direta', { re: 'bd', near: true }] },
  { id: 'BI',    label: 'BI',      patterns: ['bilirrubina\\s+indireta', { re: 'bi', near: true }] },
  { id: 'Amilase', label: 'Amilase', patterns: ['\\bamilase\\b'] },
  { id: 'Lipase', label: 'Lipase', patterns: ['\\blipase\\b'] },

  // ---- inflamação / coagulação ----
  { id: 'PCR',   label: 'PCR',     patterns: ['proteina\\s+c[\\s-]?reativa', '\\bpcr\\b'] },
  { id: 'VHS',   label: 'VHS',     patterns: ['velocidade\\s+de\\s+hemossedimentacao', '\\bvhs\\b'] },
  { id: 'INR',   label: 'INR',     patterns: ['\\binr\\b', '\\brni\\b'] },
  { id: 'TTPa',  label: 'TTPa',    patterns: ['tempo\\s+de\\s+tromboplastina', '\\bttpa?\\b', '\\bkttp\\b', '\\bkptt\\b'] },
  { id: 'Fibr',  label: 'Fibrinogênio', patterns: ['fibrinogenio'] },
];

// Ordem do bloco principal do MODELO ROTINA (uma linha por data/hora)
export const ROTINA_CORE = [
  'Ur', 'Cr', 'AU', 'pH', 'pCO2', 'pO2', 'HCO3', 'BE', 'SatO2', 'Lact', 'Glic',
  'Na', 'K', 'Mg', 'Cl', 'Ca', 'P', 'CaI', 'Hb', 'Ht', 'Plaq', 'Leuco',
];

export const DIFF_IDS = ['N', 'L', 'M', 'E', 'B'];

// “demais exames com mesmo estilo”, na ordem em que são anexados
export const EXTRA_ORDER = [
  'PT', 'Alb', 'TGO', 'TGP', 'FA', 'GGT', 'BT', 'BD', 'BI', 'Amilase', 'Lipase',
  'PCR', 'VHS', 'VCM', 'Ret', 'TSH', 'T4L', 'T3', 'PTH',
  'Ferro', 'Transf', 'SatTransf', 'Ferritina', 'TIBC',
  'CT', 'HDL', 'LDL', 'VLDL', 'NaoHDL', 'Trig',
  'VitD', 'B12', 'AcFol', 'A1c', 'LDH', 'CK', 'CKMB',
  'INR', 'TTPa', 'Fibr',
];

// Linhas do MODELO MENSALÃO, na ordem do modelo
export const MENSALAO_LINES = [
  ['TSH', 'T4L', 'PTH'],
  ['Ferro', 'Transf', 'SatTransf', 'Ferritina', 'TIBC'],
  ['CT', 'HDL', 'LDL', 'VLDL', 'NaoHDL', 'Trig'],
  ['Ur', 'Cr'],
  ['PCR'],
  ['TGO', 'TGP'],
  ['PT', 'Alb'],
  ['pH', 'pCO2', 'pO2', 'HCO3', 'BE', 'SatO2', 'Lact', 'Glic'],
  ['Na', 'K', 'Mg', 'Cl'],
  ['Ca', 'P', 'CaI'],
  ['Hb', 'Ht', 'VCM'],
  ['Leuco', 'Plaq'], // diferencial entra entre Leuco e Plaq
  ['Ret'],
];

// Sufixos de unidade usados na saída
export const PERCENT_IDS = new Set(['Ht', 'SatO2', 'SatTransf', 'Ret', 'N', 'L', 'M', 'E', 'B', 'A1c']);
