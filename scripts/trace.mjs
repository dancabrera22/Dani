// Rastreia cada valor capturado até a linha de origem e imprime as saídas.
// Uso: node scripts/trace.mjs <laudo.txt> [--only Cr,CaI] [--quiet]
import { readFileSync } from 'node:fs';
import { parseReport } from '../lib/parse.js';
import { formatRotina, formatMensalao, formatPrisma } from '../lib/format.js';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--') && !args[args.indexOf(a) - 1]?.startsWith('--only'));
const onlyIdx = args.indexOf('--only');
const only = onlyIdx >= 0 ? new Set(args[onlyIdx + 1].split(',')) : null;
const quiet = args.includes('--quiet');

const p = parseReport(readFileSync(file, 'utf8'), { debug: true });
console.log('NOME:', p.patientName);
console.log('AVISOS:', p.warnings.join(' | ') || '(nenhum)');
if (!quiet) {
  for (const r of p.results) {
    if (only && !only.has(r.id)) continue;
    const dt = r.dt ? `${r.dt.date} ${r.dt.time || ''}`.trim() : 'SEM DATA';
    console.log(` ${r.id.padEnd(10)} ${String(r.raw).padEnd(10)} @${dt.padEnd(15)} <- ${r.src}`);
  }
}
console.log('\n--- ROTINA ---\n' + formatRotina(p.results));
console.log('\n--- MENSALÃO ---\n' + formatMensalao(p.results));
console.log('\n--- PRISMA ---\n' + formatPrisma(p.results));
