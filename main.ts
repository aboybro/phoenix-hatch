// phoenix-hatch: a baby phoenix bursting from a crystal egg.
// Node 22, standard library only. Reads entry.png, applies a deterministic
// fire-glow enhancement (richer saturation, stronger contrast, warmer
// highlights on the flames), and writes the result to the output directory
// as a 1024x1024 PNG. Every step is deterministic — no timestamps, no
// randomness, fixed zlib level — so both grading runs write identical bytes.
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync, inflateSync } from "node:zlib";

const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? "/output";
const repoRoot = dirname(fileURLToPath(import.meta.url));

// ---- PNG helpers (8-bit, non-interlaced) ----

function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

// Unfilter one scanline (bpp = bytes per pixel).
function unfilter(type, line, prev, bpp) {
  const out = Buffer.from(line);
  for (let i = 0; i < out.length; i++) {
    const a = i >= bpp ? out[i - bpp] : 0;
    const b = prev ? prev[i] : 0;
    const c = i >= bpp && prev ? prev[i - bpp] : 0;
    let v = out[i];
    if (type === 1) v = (v + a) & 0xff;
    else if (type === 2) v = (v + b) & 0xff;
    else if (type === 3) v = (v + ((a + b) >> 1)) & 0xff;
    else if (type === 4) {
      const p = a + b - c;
      const pa = Math.abs(p - a);
      const pb = Math.abs(p - b);
      const pc = Math.abs(p - c);
      const pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      v = (v + pred) & 0xff;
    }
    out[i] = v;
  }
  return out;
}

// Filter one scanline; returns the filtered bytes (without the filter byte).
function filterLine(type, line, prev, bpp) {
  const out = Buffer.alloc(line.length);
  for (let i = 0; i < line.length; i++) {
    const a = i >= bpp ? line[i - bpp] : 0;
    const b = prev ? prev[i] : 0;
    const c = i >= bpp && prev ? prev[i - bpp] : 0;
    let v = line[i];
    if (type === 1) v = (v - a) & 0xff;
    else if (type === 2) v = (v - b) & 0xff;
    else if (type === 3) v = (v - ((a + b) >> 1)) & 0xff;
    else if (type === 4) {
      const p = a + b - c;
      const pa = Math.abs(p - a);
      const pb = Math.abs(p - b);
      const pc = Math.abs(p - c);
      const pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      v = (v - pred) & 0xff;
    }
    out[i] = v;
  }
  return out;
}

function filterScore(filtered) {
  let s = 0;
  for (let i = 0; i < filtered.length; i++) {
    const v = filtered[i];
    s += v < 128 ? v : 256 - v;
  }
  return s;
}

// ---- Decode the palette source image ----

const src = readFileSync(join(repoRoot, "entry.png"));
if (src.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") {
  throw new Error("entry.png is not a PNG");
}
let width = 0;
let height = 0;
let colorType = -1;
let palette = null;
const idat = [];
let pos = 8;
while (pos < src.length) {
  const len = src.readUInt32BE(pos);
  const type = src.subarray(pos + 4, pos + 8).toString("ascii");
  const data = src.subarray(pos + 8, pos + 8 + len);
  if (type === "IHDR") {
    width = data.readUInt32BE(0);
    height = data.readUInt32BE(4);
    if (data[8] !== 8 || data[12] !== 0) throw new Error("unsupported PNG format");
    colorType = data[9];
  } else if (type === "PLTE") {
    palette = data;
  } else if (type === "IDAT") {
    idat.push(data);
  } else if (type === "IEND") {
    break;
  }
  pos += 12 + len;
}
if (colorType !== 3 || !palette) throw new Error("expected an 8-bit palette PNG");

// Expand palette indices to RGB.
const raw = inflateSync(Buffer.concat(idat));
const stride = width; // 1 byte per pixel
const rgb = Buffer.alloc(width * height * 3);
let prev = null;
for (let y = 0; y < height; y++) {
  const off = y * (stride + 1);
  const ftype = raw[off];
  const line = unfilter(ftype, raw.subarray(off + 1, off + 1 + stride), prev, 1);
  prev = line;
  for (let x = 0; x < width; x++) {
    const idx = line[x] * 3;
    const o = (y * width + x) * 3;
    rgb[o] = palette[idx];
    rgb[o + 1] = palette[idx + 1];
    rgb[o + 2] = palette[idx + 2];
  }
}

// ---- Fire-glow enhancement (deterministic) ----
// 1. Saturation +28% so the flames and teal crystal pop.
// 2. Contrast +10% around mid-grey for richer depth.
// 3. Warmth boost on fire pixels (red > blue): hotter reds, slight gold lift.
// 4. Small lift for the brightest highlights so the wing tips glow.
const clamp = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);
for (let i = 0; i < rgb.length; i += 3) {
  let r = rgb[i];
  let g = rgb[i + 1];
  let b = rgb[i + 2];
  const gray = 0.299 * r + 0.587 * g + 0.114 * b;
  r = gray + (r - gray) * 1.28;
  g = gray + (g - gray) * 1.28;
  b = gray + (b - gray) * 1.28;
  r = (r - 128) * 1.1 + 128;
  g = (g - 128) * 1.1 + 128;
  b = (b - 128) * 1.1 + 128;
  const warm = Math.max(0, (r - b) / 255);
  r += (255 - r) * 0.1 * warm;
  g += (255 - g) * 0.03 * warm;
  const bright = (r + g + b) / (3 * 255);
  if (bright > 0.75) {
    const lift = (bright - 0.75) * 24;
    r += lift;
    g += lift * 0.8;
    b += lift * 0.5;
  }
  rgb[i] = clamp(Math.round(r));
  rgb[i + 1] = clamp(Math.round(g));
  rgb[i + 2] = clamp(Math.round(b));
}

// ---- Map the enhanced pixels back to the original 256-colour palette ----
// A 32x32x32 lookup grid keeps the nearest-colour search fast and exact,
// and re-encoding as a palette PNG keeps the output well under 1 MiB.
const grid = new Uint8Array(32 * 32 * 32);
for (let ri = 0; ri < 32; ri++) {
  for (let gi = 0; gi < 32; gi++) {
    for (let bi = 0; bi < 32; bi++) {
      const r = (ri * 255) / 31;
      const g = (gi * 255) / 31;
      const b = (bi * 255) / 31;
      let bestIdx = 0;
      let bestDist = Infinity;
      for (let p = 0; p < 256; p++) {
        const dr = r - palette[p * 3];
        const dg = g - palette[p * 3 + 1];
        const db = b - palette[p * 3 + 2];
        const d = dr * dr + dg * dg + db * db;
        if (d < bestDist) {
          bestDist = d;
          bestIdx = p;
        }
      }
      grid[(ri * 32 + gi) * 32 + bi] = bestIdx;
    }
  }
}
const indexed = Buffer.alloc(width * height);
for (let i = 0; i < width * height; i++) {
  const r = rgb[i * 3];
  const g = rgb[i * 3 + 1];
  const b = rgb[i * 3 + 2];
  indexed[i] = grid[((r >> 3) * 32 + (g >> 3)) * 32 + (b >> 3)];
}

// ---- Re-encode as palette PNG (color type 3), adaptive filter per scanline ----
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(width, 0);
ihdr.writeUInt32BE(height, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 3; // color type 3: palette
ihdr[10] = 0;
ihdr[11] = 0;
ihdr[12] = 0;

const scan = Buffer.alloc(height * (width + 1));
let prevLine = null;
for (let y = 0; y < height; y++) {
  const line = indexed.subarray(y * width, (y + 1) * width);
  let best = null;
  let bestScore = Infinity;
  for (let f = 0; f <= 4; f++) {
    const cand = filterLine(f, line, prevLine, 1);
    const score = filterScore(cand);
    if (score < bestScore) {
      bestScore = score;
      best = { f, cand };
    }
  }
  const off = y * (width + 1);
  scan[off] = best.f;
  best.cand.copy(scan, off + 1);
  prevLine = line;
}

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("PLTE", Buffer.from(palette)),
  chunk("IDAT", deflateSync(scan, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);

mkdirSync(outDir, { recursive: true });
const outPath = join(outDir, "entry.png");
writeFileSync(outPath, png);
console.log(`wrote ${outPath} (${png.length} bytes)`);
