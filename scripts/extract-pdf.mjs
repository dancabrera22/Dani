// Extrai o texto de PDFs com a MESMA reconstrução de linhas do app
// (itens agrupados por Y arredondado, ordenados por X).
// Uso: node scripts/extract-pdf.mjs <arquivo.pdf> [...] [--out <dir>]
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');

export async function extractPdfText(data) {
  const doc = await pdfjs.getDocument({ data, useSystemFonts: true }).promise;
  const pages = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    const rows = new Map();
    for (const it of tc.items) {
      if (!it.str || !it.str.trim()) continue;
      const y = Math.round(it.transform[5] / 3) * 3;
      if (!rows.has(y)) rows.set(y, []);
      rows.get(y).push({ x: it.transform[4], str: it.str });
    }
    pages.push(
      [...rows.entries()]
        .sort((a, b) => b[0] - a[0])
        .map(([, items]) => items.sort((a, b) => a.x - b.x).map((i) => i.str).join(' '))
        .join('\n')
    );
  }
  return pages.join('\n\n');
}

const args = process.argv.slice(2);
const outIdx = args.indexOf('--out');
const outDir = outIdx >= 0 ? args[outIdx + 1] : '.';
const files = args.filter((a, i) => a !== '--out' && i !== outIdx + 1);
for (const f of files) {
  const text = await extractPdfText(new Uint8Array(readFileSync(f)));
  const out = join(outDir, basename(f).replace(/\.pdf$/i, '.txt'));
  writeFileSync(out, text);
  console.log('ok', out);
}
