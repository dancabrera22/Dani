// Extrai uma tabela de PDF usando a POSIÇÃO de cada texto, não a ordem em que
// ele aparece no arquivo.
//
//   node scripts/pdf-colunas.mjs arquivo.pdf [--pagina N] [--droga NOME]
//
// Numa tabela larga, o texto plano embaralha as colunas: o valor da coluna 5
// pode sair antes do da coluna 2. Aqui cada item é colocado na coluna cujo
// intervalo de x o contém, lido do próprio cabeçalho da tabela. É a diferença
// entre ler a dose certa e ler a dose da coluna vizinha.
import { readFileSync } from 'node:fs';

const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');

const arquivo = process.argv[2];
const pagPedida = Number(valorDe('--pagina') || 0);
const drogaPedida = (valorDe('--droga') || '').toUpperCase();

function valorDe(flag) {
  const i = process.argv.indexOf(flag);
  return i > 0 ? process.argv[i + 1] : null;
}

if (!arquivo) {
  console.error('uso: node scripts/pdf-colunas.mjs arquivo.pdf [--pagina N] [--droga NOME]');
  process.exit(1);
}

// largura aproximada do texto, para saber onde a célula termina
const larguraDe = (t) => t.length * 4.2;

const doc = await pdfjs.getDocument({
  data: new Uint8Array(readFileSync(arquivo)),
  useSystemFonts: true,
}).promise;

// cabeçalho que define as colunas
const ROTULOS = [
  'CrCl > 50', 'CrCl 50', 'CrCl 29', 'CrCl < 10',
  'Peritoneal', 'Hemodialysis', 'CRRT',
];

for (let p = 1; p <= doc.numPages; p++) {
  if (pagPedida && p !== pagPedida) continue;
  const pagina = await doc.getPage(p);
  const conteudo = await pagina.getTextContent();

  // agrupa por linha (y), com tolerância
  const itens = conteudo.items
    .filter((i) => i.str.trim())
    .map((i) => ({ x: i.transform[4], y: Math.round(i.transform[5]), s: i.str.trim() }));

  const linhas = new Map();
  for (const it of itens) {
    const chave = [...linhas.keys()].find((y) => Math.abs(y - it.y) <= 3) ?? it.y;
    if (!linhas.has(chave)) linhas.set(chave, []);
    linhas.get(chave).push(it);
  }
  const ordenadas = [...linhas.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([y, its]) => ({ y, its: its.sort((a, b) => a.x - b.x) }));

  // Acha o cabeçalho desta página e agrupa os seus itens em CÉLULAS: itens
  // próximos em x são a mesma coluna; um vão maior separa colunas. O x de
  // início de cada célula vira a fronteira da coluna.
  let cortes = null;
  for (const { its } of ordenadas) {
    const texto = its.map((i) => i.s).join(' ');
    if (ROTULOS.filter((r) => texto.includes(r)).length < 4) continue;
    const celulas = [];
    for (const it of its) {
      const ultima = celulas[celulas.length - 1];
      if (ultima && it.x - ultima.fim <= 14) {
        ultima.partes.push(it.s);
        ultima.fim = it.x + larguraDe(it.s);
      } else {
        celulas.push({ x: it.x, fim: it.x + larguraDe(it.s), partes: [it.s] });
      }
    }
    const uteis = celulas.filter((c) => /CrCl|Dialysis|Peritoneal/i.test(c.partes.join(' ')));
    if (uteis.length >= 4) {
      cortes = uteis.map((c) => ({ rotulo: c.partes.join(' ').replace(/\s+/g, ' ').trim(), x: c.x }));
      // O rótulo CRRT fica na linha ACIMA do cabeçalho; sem ele, os valores
      // de CRRT caem dentro da coluna da hemodiálise — que é exatamente o
      // tipo de troca que vira erro de dose.
      const acima = ordenadas.find((l) => l.its.some((i) => /^CRRT$/i.test(i.s)));
      const crrt = acima?.its.find((i) => /^CRRT$/i.test(i.s));
      if (crrt && crrt.x > uteis[uteis.length - 1].x) {
        cortes.push({ rotulo: 'CRRT', x: crrt.x });
      }
    }
    break;
  }
  if (!cortes) continue;

  const colunaDe = (x) => {
    let idx = 0;
    for (let i = 0; i < cortes.length; i++) if (x >= cortes[i].x - 12) idx = i;
    return idx;
  };

  let imprimindo = !drogaPedida;
  for (const { its } of ordenadas) {
    const texto = its.map((i) => i.s).join(' ').trim();
    // Linha de título = o primeiro item (mais à esquerda) é o nome da droga
    // em CAIXA ALTA. O resto da linha pode ter texto normal ("Extended
    // infusion over 3 hours..."), então olhar a linha inteira não serve.
    const primeiro = its[0]?.s ?? '';
    const ehTitulo = /^[A-Z][A-Z0-9\s\-–®,()]{3,}$/.test(primeiro) && primeiro.length >= 4;
    if (drogaPedida) {
      const bate = primeiro.toUpperCase().replace(/\s+/g, ' ').includes(drogaPedida);
      if (ehTitulo && bate) imprimindo = true;
      else if (ehTitulo && imprimindo && !bate) break;
    }
    if (!imprimindo) continue;

    // distribui os itens pelas colunas
    const cols = cortes.map(() => []);
    const antes = [];
    for (const it of its) {
      if (it.x < cortes[0].x - 12) antes.push(it.s);
      else cols[colunaDe(it.x)].push(it.s);
    }
    const linha = cols.map((c) => c.join(' ').trim());
    if (!linha.some(Boolean) && !antes.length) continue;
    console.log(
      `p${p} | ${antes.join(' ').padEnd(42).slice(0, 42)} | ` +
        linha.map((c, i) => `${cortes[i].rotulo}: ${c || '—'}`).join(' | ')
    );
  }
}
