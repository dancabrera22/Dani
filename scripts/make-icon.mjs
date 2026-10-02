// Gera o favicon do app: "T" branco sobre quadrado arredondado teal.
// Sem dependências — desenha em memória (supersampling 4x) e grava PNG.
// Uso: node scripts/make-icon.mjs            (escreve app/icon.png e app/apple-icon.png)
//      node scripts/make-icon.mjs --preview  (escreve só em /tmp para conferir)
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

const TEAL = [0x2e, 0x8b, 0x84]; // --teal do globals.css
const WHITE = [0xff, 0xff, 0xff];

// ---- desenho (coordenadas em um quadrado 512, depois escalado) ----
const BASE = 512;
const RADIUS = 96; // cantos arredondados
const BAR = { x0: 108, x1: 404, y0: 120, y1: 196 }; // travessão do T
const STEM = { x0: 218, x1: 294, y0: 120, y1: 392 }; // haste do T

function insideRoundedSquare(x, y) {
  if (x < 0 || y < 0 || x > BASE || y > BASE) return false;
  const cx = Math.min(Math.max(x, RADIUS), BASE - RADIUS);
  const cy = Math.min(Math.max(y, RADIUS), BASE - RADIUS);
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= RADIUS * RADIUS;
}
const inRect = (r, x, y) => x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1;

/** cor de um ponto: [r,g,b,a] */
function sample(x, y) {
  if (!insideRoundedSquare(x, y)) return [0, 0, 0, 0]; // fora: transparente
  if (inRect(BAR, x, y) || inRect(STEM, x, y)) return [...WHITE, 255];
  return [...TEAL, 255];
}

/** renderiza com supersampling SS×SS por pixel */
function render(size, ss = 4) {
  const buf = Buffer.alloc(size * size * 4);
  const scale = BASE / size;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const x = (px + (sx + 0.5) / ss) * scale;
          const y = (py + (sy + 0.5) / ss) * scale;
          const c = sample(x, y);
          r += c[0] * c[3]; g += c[1] * c[3]; b += c[2] * c[3]; a += c[3];
        }
      }
      const i = (py * size + px) * 4;
      if (a > 0) {
        buf[i] = Math.round(r / a);
        buf[i + 1] = Math.round(g / a);
        buf[i + 2] = Math.round(b / a);
      }
      buf[i + 3] = Math.round(a / (ss * ss));
    }
  }
  return buf;
}

// ---- codificador PNG mínimo (RGBA, sem filtro) ----
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = -1;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function png(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filtro "none"
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const preview = process.argv.includes('--preview');
const dir = preview ? process.env.TMPDIR || '/tmp' : new URL('../app/', import.meta.url).pathname;
for (const [name, size] of [['icon.png', 512], ['apple-icon.png', 180]]) {
  const out = dir.replace(/\/?$/, '/') + name;
  writeFileSync(out, png(size, render(size)));
  console.log('escrito', out);
}
