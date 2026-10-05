// Verificação da matemática de soros — valores conferidos à mão.
import { calcularSoro, hollidaySegar, fmt } from '../lib/solucoes.js';

let falhas = 0;
function checa(nome, obtido, esperado, tol = 0.05) {
  const ok = Math.abs(obtido - esperado) <= tol;
  if (!ok) falhas++;
  console.log(`${ok ? '✓' : '✗'} ${nome}: ${fmt(obtido)} (esperado ~${esperado})`);
}

console.log('--- Holliday-Segar ---');
checa('5 kg', hollidaySegar(5), 500);
checa('10 kg', hollidaySegar(10), 1000);
checa('15 kg', hollidaySegar(15), 1250);
checa('30 kg', hollidaySegar(30), 1700);

console.log('\n--- Soro de manutenção (10 kg, 24 h) ---');
const r = calcularSoro(
  [
    { id: 'SG10', ml: 500 },
    { id: 'NaCl20', ml: 10 },
    { id: 'KCl191', ml: 6 },
    { id: 'MgSO4_10', ml: 2 },
  ],
  { peso: 10, horas: 24 }
);
checa('volume total', r.volumeTotal, 518);
checa('oferta hídrica mL/kg/dia', r.ofertaHidrica, 51.8);
checa('taxa mL/h', r.taxa, 21.58, 0.02);
checa('glicose final %', r.glicosePct, 9.65, 0.02);
checa('VIG mg/kg/min', r.vig, 3.47, 0.02);
checa('Na mEq/kg/dia', r.porKg.Na, 3.4);
checa('K mEq/kg/dia', r.porKg.K, 1.54, 0.02);
checa('Mg mEq/kg/dia', r.porKg.Mg, 0.16);
checa('osmolaridade mOsm/L', r.osmolaridade, 731, 2);
console.log('  acesso sugerido:', r.acessoSugerido);
console.log('  Na por 100 kcal:', fmt(r.por100kcal.Na));

console.log('\n--- Diluição com volume total declarado (completa com AD) ---');
const r2 = calcularSoro(
  [{ id: 'SG50', ml: 20 }, { id: 'NaCl20', ml: 3 }],
  { peso: 3, horas: 24, volumeTotal: 100 }
);
checa('AD implícita', r2.volAD, 77);
checa('glicose final %', r2.glicosePct, 10);
checa('Na mEq/kg/dia', r2.porKg.Na, 3.4);
checa('VIG mg/kg/min', r2.vig, 2.31, 0.02);

console.log('\n--- Fósforo em mmol (nunca mEq) ---');
const r3 = calcularSoro([{ id: 'FosfK', ml: 4 }], { peso: 8, volumeTotal: 100 });
checa('P mmol total', r3.ions.P, 4);
checa('K mEq total', r3.ions.K, 8);

console.log(falhas === 0 ? '\nTODOS OS TESTES PASSARAM' : `\n${falhas} FALHA(S)`);
process.exit(falhas ? 1 : 0);
