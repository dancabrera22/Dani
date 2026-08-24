// Regressão com o laudo sintético embutido na UI (app/page.js, const SAMPLE)
// + casos sintéticos de sorologia/urina. Nunca usa dados reais.
// Uso: node scripts/regression.mjs
import { readFileSync } from 'node:fs';
import { parseReport } from '../lib/parse.js';
import { formatRotina, formatMensalao, formatPrisma } from '../lib/format.js';
import { parseImagingConclusions, formatImaging } from '../lib/imaging.js';

const page = readFileSync(new URL('../app/page.js', import.meta.url), 'utf8');
const SAMPLE = page.match(/const SAMPLE = `([\s\S]*?)`;/)[1];

function run(title, text) {
  const p = parseReport(text);
  console.log(`\n========== ${title} ==========`);
  console.log('NOME:', p.patientName, '| avisos:', p.warnings.length);
  console.log('--- ROTINA ---\n' + formatRotina(p.results));
  console.log('--- MENSALÃO ---\n' + formatMensalao(p.results));
  const prisma = formatPrisma(p.results);
  if (prisma) console.log('--- PRISMA ---\n' + prisma);
  const img = parseImagingConclusions(text);
  if (img.items.length) console.log('--- IMAGEM ---\n' + formatImaging(img.items));
}

run('SAMPLE (UI)', SAMPLE);

run(
  'P/C e M/C CALCULADOS dos componentes',
  `Paciente: TESTE CALCULO
Coletado em: 20/08/2026 às 07:00
Proteína Urinária 30 mg/dL
Creatinina Urinária 0,60 g/L
Microalbuminúria 18 mg/L
Tacrolimus (FK506) 7,2 ng/mL`
);

run(
  'SOROLOGIAS + URINA + PRISMA',
  `Paciente: TESTE REGRESSAO
Coletado em: 18/08/2026 às 08:00
GASOMETRIA, ELETRÓLITOS E METABÓLITOS (VENOSO)
pH 7,32 7,35 7,45
pCO2 44 mmHg
HCO3 21,8 mmol/L
Sódio 131 mEq/L
Potássio 5,9 mEq/L
Cloro 99 mEq/L
Cálcio iônico 1,10 mg/dL
Lactato 12 mg/dL
Solicitcação: 1 Liberado em: 18/08/2026 09:10:00
SÓDIO E POTÁSSIO (SORO)
SODIO (SORO)
138 mEq/L 136 145
POTASSIO (SORO)
4,2 mEq/L 3,5 5,1
CÁLCIO IÔNICO SANGUE TOTAL
4,89 mg/dL 4,89 5,49
CALCIO (SORO)
RESULTADO: 10,4 mg/dL 8,40 10,20
TACROLIMUS,SANGUE
Método: CMIA
RESULTADO: 6,8 ng/mL 5 15
URINA I CARACTERES FÍSICOS E BIOQUIMICOS, URINA ISOLADA
pH 6,0 4,50 7,80
Densidade 1.015 1003 1029
Nitrito NEGATIVO 0 0
Proteínas POSITIVO + 0 0
Glicose NEGATIVO 0 0
Sangue POSITIVO +++ 0 0
Bactérias NUMEROSAS 0 0
Leveduras AUSENTE 0 0
Células epiteliais RARAS 0 0
URINA I SEDIMENTO QUANTITATIVO
Leucócitos 12000 mL 0 7000
Eritrócitos 800 mL 0 3000
RELAÇÃO PROTEÍNA/CREATININA, URINA ISOLADA
Método: Cálculo
RESULTADO: 0,45 mg/mg
FAN, SANGUE
Resultado: Reagente, padrão nuclear pontilhado fino 1/80
EBV IgG,SANGUE
Resultado: NÃO REAGENTE
EBV IgM,SANGUE
Resultado: NÃO REAGENTE
HEMOGRAMA COMPLETO
Hemoglobina: 11,0 g/dL 13 16`
);
