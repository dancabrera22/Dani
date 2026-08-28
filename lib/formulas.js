// Catálogo das fórmulas calculadas pelo app — usado na seção de consulta.
// `req` são ids de analitos; `extra` são dados digitados pela usuária.

export const EXTRA_LABELS = {
  peso: 'peso',
  altura: 'altura',
  hdTime: 'tempo de sessão',
  hdPre: 'peso pré',
  hdPos: 'peso pós',
  prePos: 'ureia pré e pós no mesmo dia',
  h24: 'coleta de 24 h (volume urinário)',
};

export const ID_LABELS = {
  Na: 'Na', K: 'K', Cl: 'Cl', HCO3: 'HCO3', pCO2: 'pCO2', Ca: 'Ca', P: 'P',
  Mg: 'Mg', Cr: 'Cr', Ur: 'Ur', AU: 'AU', Alb: 'Alb', Glic: 'Glic', Osm: 'Osm',
  'U-NaQ': 'NaU', 'U-KQ': 'KU', 'U-ClQ': 'ClU', 'U-CaQ': 'CaU', 'U-PQ': 'PU',
  'U-MgQ': 'MgU', 'U-AUQ': 'AUu', 'U-UrQ': 'UrU', 'U-CrQ': 'CrU',
  'U-OsmQ': 'OsmU', 'U-ProtQ': 'ProtU', 'U-AlbQ': 'AlbU', 'U-VolQ': 'VU',
};

export const FORMULA_GROUPS = [
  {
    grupo: 'Função renal',
    itens: [
      { nome: 'eGFR Schwartz', formula: '0,413 × altura(cm) / Cr', req: ['Cr'], extra: ['altura'], onde: 'ROTINA, MENSALÃO, PRISMA, TUBULOPATIAS' },
      { nome: 'ClCr 24 h', formula: '(CrU × VU) / (Cr × 1440)', req: ['Cr', 'U-CrQ', 'U-VolQ'], extra: ['h24'], onde: 'TUBULOPATIAS' },
      { nome: 'ClCr corrigido', formula: 'ClCr × 1,73 / SC', req: ['Cr', 'U-CrQ', 'U-VolQ'], extra: ['h24', 'peso'], onde: 'TUBULOPATIAS' },
      { nome: 'Superfície corpórea', formula: 'Costeff (4P+7)/(P+90); Mosteller √(A×P/3600) com altura', req: [], extra: ['peso'], onde: 'seção 2 e TUBULOPATIAS' },
      { nome: 'Cr24h/kg (adequação da coleta)', formula: '(CrU × VU / 100) / peso — esperado ~15-25 mg/kg/24h', req: ['U-CrQ', 'U-VolQ'], extra: ['h24', 'peso'], onde: 'TUBULOPATIAS' },
    ],
  },
  {
    grupo: 'Tubular',
    itens: [
      { nome: 'FENa', formula: '(NaU × Cr) / (Na × CrU) × 100', req: ['Na', 'Cr', 'U-NaQ', 'U-CrQ'], onde: 'TUBULOPATIAS' },
      { nome: 'FEK', formula: '(KU × Cr) / (K × CrU) × 100', req: ['K', 'Cr', 'U-KQ', 'U-CrQ'], onde: 'TUBULOPATIAS' },
      { nome: 'FECa', formula: '(CaU × Cr) / (Ca × CrU) × 100', req: ['Ca', 'Cr', 'U-CaQ', 'U-CrQ'], onde: 'TUBULOPATIAS' },
      { nome: 'FEUr', formula: '(UrU × Cr) / (Ur × CrU) × 100', req: ['Ur', 'Cr', 'U-UrQ', 'U-CrQ'], onde: 'TUBULOPATIAS' },
      { nome: 'FEMg', formula: '(MgU × Cr) / (0,7 × Mg × CrU) × 100', req: ['Mg', 'Cr', 'U-MgQ', 'U-CrQ'], onde: 'TUBULOPATIAS' },
      { nome: 'FEUA', formula: '(AUu × Cr) / (AU × CrU) × 100', req: ['AU', 'Cr', 'U-AUQ', 'U-CrQ'], onde: 'TUBULOPATIAS' },
      { nome: 'TRP', formula: '1 − (PU × Cr) / (P × CrU)', req: ['P', 'Cr', 'U-PQ', 'U-CrQ'], onde: 'TUBULOPATIAS' },
      { nome: 'FEP', formula: '100 − TRP', req: ['P', 'Cr', 'U-PQ', 'U-CrQ'], onde: 'TUBULOPATIAS' },
      { nome: 'TmP/GFR (Bijvoet)', formula: 'TRP × P; se TRP > 0,86: (0,3×TRP)/(1−0,8×TRP) × P', req: ['P', 'Cr', 'U-PQ', 'U-CrQ'], onde: 'TUBULOPATIAS' },
      { nome: 'TTKG', formula: '(KU/K) / (OsmU/Osm) — exige OsmU > Osm', req: ['K', 'U-KQ', 'Osm', 'U-OsmQ'], onde: 'TUBULOPATIAS' },
      { nome: 'P/C', formula: 'ProtU / CrU (mg/mg)', req: ['U-ProtQ', 'U-CrQ'], onde: 'TUBULOPATIAS' },
      { nome: 'M/C', formula: 'AlbU / CrU × 1000 (mg/g)', req: ['U-AlbQ', 'U-CrQ'], onde: 'TUBULOPATIAS' },
      { nome: 'Ca/Cr', formula: 'CaU / CrU (mg/mg)', req: ['U-CaQ', 'U-CrQ'], onde: 'TUBULOPATIAS' },
      { nome: 'U/P creatinina', formula: 'CrU / Cr', req: ['Cr', 'U-CrQ'], onde: 'TUBULOPATIAS' },
      { nome: 'U/P osmolaridade', formula: 'OsmU / Osm', req: ['Osm', 'U-OsmQ'], onde: 'TUBULOPATIAS' },
      { nome: 'Clearance de água livre de eletrólitos', formula: 'VU × [1 − (NaU + KU)/Na]', req: ['Na', 'U-NaQ', 'U-KQ', 'U-VolQ'], onde: 'TUBULOPATIAS' },
    ],
  },
  {
    grupo: 'Ácido-base e osmolaridade',
    itens: [
      { nome: 'Ânion gap', formula: 'Na − (Cl + HCO3); corrigido + 2,5×(4−Alb) se Alb < 4', req: ['Na', 'Cl', 'HCO3'], onde: 'TUBULOPATIAS' },
      { nome: 'Ânion gap urinário', formula: '(NaU + KU) − ClU', req: ['U-NaQ', 'U-KQ', 'U-ClQ'], onde: 'TUBULOPATIAS' },
      { nome: 'NH4+ estimado (gap osmolar urinário)', formula: '[OsmU − (2×(NaU+KU) + UrU/6 + GlicU/18)] / 2', req: ['U-OsmQ', 'U-NaQ', 'U-KQ', 'U-UrQ'], onde: 'TUBULOPATIAS' },
      { nome: 'Winter (compensação)', formula: 'pCO2 esperado = 1,5×HCO3 + 8 (±2)', req: ['HCO3', 'pCO2'], onde: 'TUBULOPATIAS' },
      { nome: 'Delta gap', formula: '(AG − 12) / (24 − HCO3) — quando AG > 12', req: ['Na', 'Cl', 'HCO3'], onde: 'TUBULOPATIAS' },
      { nome: 'Osmolaridade calculada + gap', formula: '2×Na + Glic/18 + Ur/6; gap = medida − calculada', req: ['Na', 'Glic', 'Ur'], onde: 'TUBULOPATIAS' },
      { nome: 'Na corrigido pela glicemia', formula: 'Na + 0,024 × (Glic − 100) — quando Glic > 100', req: ['Na', 'Glic'], onde: 'TUBULOPATIAS' },
    ],
  },
  {
    grupo: 'Cálcio e fósforo',
    itens: [
      { nome: 'Ca corrigido pela albumina', formula: 'Ca + 0,8 × (4 − Alb) — quando Alb < 4', req: ['Ca', 'Alb'], onde: 'TUBULOPATIAS' },
      { nome: 'Produto Ca × P', formula: 'Ca × P', req: ['Ca', 'P'], onde: 'TUBULOPATIAS' },
      { nome: 'R CaT/CaI (citrato)', formula: 'Ca total / cálcio iônico do paciente', req: ['Ca', 'CaI'], onde: 'PRISMA' },
      { nome: 'CaI e CaM em mmol/L', formula: 'valor / 4 (maior = paciente, menor = máquina)', req: ['CaI'], onde: 'PRISMA' },
    ],
  },
  {
    grupo: 'Urina de 24 horas',
    itens: [
      { nome: 'Proteinúria 24 h', formula: 'ProtU × VU / 100 (mg/24h)', req: ['U-ProtQ', 'U-VolQ'], extra: ['h24'], onde: 'TUBULOPATIAS' },
      { nome: 'Calciúria 24 h', formula: 'CaU × VU / 100 (mg/24h)', req: ['U-CaQ', 'U-VolQ'], extra: ['h24'], onde: 'TUBULOPATIAS' },
      { nome: 'Natriurese 24 h', formula: 'NaU × VU / 1000 (mEq/24h)', req: ['U-NaQ', 'U-VolQ'], extra: ['h24'], onde: 'TUBULOPATIAS' },
      { nome: 'Caliurese 24 h', formula: 'KU × VU / 1000 (mEq/24h)', req: ['U-KQ', 'U-VolQ'], extra: ['h24'], onde: 'TUBULOPATIAS' },
    ],
  },
  {
    grupo: 'Diálise',
    itens: [
      { nome: 'URR', formula: '(Ur pré − Ur pós) / Ur pré × 100', req: [], extra: ['prePos'], onde: 'MENSALÃO' },
      { nome: 'Kt/V da sessão (Daugirdas 2ª geração)', formula: '−ln(R − 0,008×t) + (4 − 3,5×R) × UF/peso pós, R = pós/pré', req: [], extra: ['prePos', 'hdTime', 'hdPos'], onde: 'MENSALÃO' },
      { nome: 'stdKt/V semanal (Daugirdas/FHN)', formula: 'a partir do eKt/V = Kt/V × t/(t+35) e do nº de sessões', req: [], extra: ['prePos', 'hdTime', 'hdPos'], onde: 'MENSALÃO' },
    ],
  },
];

/** Estado de cada fórmula para o conjunto de exames e dados carregados. */
export function formulaStatus(item, availableIds, extras) {
  const faltando = [];
  for (const id of item.req || []) {
    if (!availableIds.has(id)) faltando.push(ID_LABELS[id] || id);
  }
  for (const e of item.extra || []) {
    if (!extras[e]) faltando.push(EXTRA_LABELS[e] || e);
  }
  return { ok: faltando.length === 0, faltando };
}
