#!/usr/bin/env node
/**
 * Build Windows .ico (+ PNG) for Beta / Dev taskbar distinction.
 * No external deps — writes uncompressed 32-bit BMP entries inside ICO.
 */
const fs = require('fs');
const path = require('path');

const OUT_DIR = path.join(__dirname, '..', 'build', 'icons');

/** Teal Beta vs amber Dev so taskbar icons are obvious. */
const THEMES = {
  beta: {
    file: 'icon-beta',
    bg: [18, 92, 102],
    fg: [232, 248, 250],
    accent: [45, 183, 199],
  },
  dev: {
    file: 'icon-dev',
    bg: [92, 68, 18],
    fg: [255, 240, 210],
    accent: [201, 162, 39],
  },
};

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function pngChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(crcBuf), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function writePng(rgba, size) {
  // rgba: Buffer length size*size*4, row-major top-down
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    const rowStart = y * (size * 4 + 1);
    raw[rowStart] = 0;
    rgba.copy(raw, rowStart + 1, y * size * 4, (y + 1) * size * 4);
  }
  // zlib store (no compression) blocks
  const max = 65535;
  const chunks = [];
  let offset = 0;
  while (offset < raw.length) {
    const end = Math.min(offset + max, raw.length);
    const block = raw.subarray(offset, end);
    const isLast = end === raw.length;
    const header = Buffer.alloc(5);
    header[0] = isLast ? 1 : 0;
    header.writeUInt16LE(block.length, 1);
    header.writeUInt16LE(block.length ^ 0xffff, 3);
    chunks.push(header, block);
    offset = end;
  }
  const adler = (() => {
    let a = 1;
    let b = 0;
    for (let i = 0; i < raw.length; i++) {
      a = (a + raw[i]) % 65521;
      b = (b + a) % 65521;
    }
    return ((b << 16) | a) >>> 0;
  })();
  const zlibBody = Buffer.concat([
    Buffer.from([0x78, 0x01]),
    ...chunks,
    (() => {
      const t = Buffer.alloc(4);
      t.writeUInt32BE(adler, 0);
      return t;
    })(),
  ]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlibBody),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function fillRoundRect(rgba, size, color, radius) {
  const [r, g, b] = color;
  const rr = radius;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let inside = true;
      if (x < rr && y < rr) {
        const dx = rr - x - 0.5;
        const dy = rr - y - 0.5;
        inside = dx * dx + dy * dy <= rr * rr;
      } else if (x >= size - rr && y < rr) {
        const dx = x - (size - rr) + 0.5;
        const dy = rr - y - 0.5;
        inside = dx * dx + dy * dy <= rr * rr;
      } else if (x < rr && y >= size - rr) {
        const dx = rr - x - 0.5;
        const dy = y - (size - rr) + 0.5;
        inside = dx * dx + dy * dy <= rr * rr;
      } else if (x >= size - rr && y >= size - rr) {
        const dx = x - (size - rr) + 0.5;
        const dy = y - (size - rr) + 0.5;
        inside = dx * dx + dy * dy <= rr * rr;
      }
      const i = (y * size + x) * 4;
      if (inside) {
        rgba[i] = r;
        rgba[i + 1] = g;
        rgba[i + 2] = b;
        rgba[i + 3] = 255;
      } else {
        rgba[i] = 0;
        rgba[i + 1] = 0;
        rgba[i + 2] = 0;
        rgba[i + 3] = 0;
      }
    }
  }
}

function drawZ(rgba, size, fg, accent) {
  // Simple blocky Z scaled to canvas
  const set = (x, y, col) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
    if (rgba[i + 3] === 0) return; // stay inside rounded bg
    rgba[i] = col[0];
    rgba[i + 1] = col[1];
    rgba[i + 2] = col[2];
    rgba[i + 3] = 255;
  };
  const thick = Math.max(2, Math.round(size * 0.12));
  const pad = Math.round(size * 0.22);
  const left = pad;
  const right = size - pad - 1;
  const top = pad;
  const bottom = size - pad - 1;
  // top bar
  for (let y = top; y < top + thick; y++) {
    for (let x = left; x <= right; x++) set(x, y, fg);
  }
  // bottom bar
  for (let y = bottom - thick + 1; y <= bottom; y++) {
    for (let x = left; x <= right; x++) set(x, y, fg);
  }
  // diagonal
  const y0 = top + thick - 1;
  const y1 = bottom - thick + 1;
  for (let y = y0; y <= y1; y++) {
    const t = (y - y0) / Math.max(1, y1 - y0);
    const cx = Math.round(right - t * (right - left));
    for (let dx = -Math.floor(thick / 2); dx <= Math.ceil(thick / 2); dx++) {
      set(cx + dx, y, accent);
    }
  }
}

function makeRgba(size, theme) {
  const rgba = Buffer.alloc(size * size * 4);
  fillRoundRect(rgba, size, theme.bg, Math.round(size * 0.18));
  drawZ(rgba, size, theme.fg, theme.accent);
  return rgba;
}

function bmp32(rgba, size) {
  // ICO stores BMP bottom-up, BGRA, plus AND mask (padded)
  const rowStride = size * 4;
  const pixelBytes = rowStride * size;
  const andRow = Math.ceil(size / 32) * 4;
  const andBytes = andRow * size;
  const dib = Buffer.alloc(40 + pixelBytes + andBytes);
  dib.writeUInt32LE(40, 0);
  dib.writeInt32LE(size, 4);
  dib.writeInt32LE(size * 2, 8); // height includes AND mask
  dib.writeUInt16LE(1, 12);
  dib.writeUInt16LE(32, 14);
  dib.writeUInt32LE(0, 16);
  dib.writeUInt32LE(pixelBytes, 20);
  for (let y = 0; y < size; y++) {
    const srcY = size - 1 - y;
    for (let x = 0; x < size; x++) {
      const si = (srcY * size + x) * 4;
      const di = 40 + y * rowStride + x * 4;
      dib[di] = rgba[si + 2];
      dib[di + 1] = rgba[si + 1];
      dib[di + 2] = rgba[si];
      dib[di + 3] = rgba[si + 3];
    }
  }
  // AND mask zeros (alpha used)
  return dib;
}

function writeIco(sizes, theme) {
  const images = sizes.map((size) => {
    const rgba = makeRgba(size, theme);
    const bmp = bmp32(rgba, size);
    return { size, bmp };
  });
  const headerSize = 6 + 16 * images.length;
  let offset = headerSize;
  const entries = [];
  for (const img of images) {
    entries.push({
      size: img.size,
      bytes: img.bmp.length,
      offset,
      bmp: img.bmp,
    });
    offset += img.bmp.length;
  }
  const out = Buffer.alloc(offset);
  out.writeUInt16LE(0, 0);
  out.writeUInt16LE(1, 2);
  out.writeUInt16LE(images.length, 4);
  let o = 6;
  for (const e of entries) {
    out[o] = e.size >= 256 ? 0 : e.size;
    out[o + 1] = e.size >= 256 ? 0 : e.size;
    out[o + 2] = 0;
    out[o + 3] = 0;
    out.writeUInt16LE(1, o + 4);
    out.writeUInt16LE(32, o + 6);
    out.writeUInt32LE(e.bytes, o + 8);
    out.writeUInt32LE(e.offset, o + 12);
    o += 16;
  }
  for (const e of entries) {
    e.bmp.copy(out, e.offset);
  }
  return out;
}

fs.mkdirSync(OUT_DIR, { recursive: true });
for (const theme of Object.values(THEMES)) {
  const rgba256 = makeRgba(256, theme);
  const png = writePng(rgba256, 256);
  const ico = writeIco([16, 32, 48, 256], theme);
  fs.writeFileSync(path.join(OUT_DIR, theme.file + '.png'), png);
  fs.writeFileSync(path.join(OUT_DIR, theme.file + '.ico'), ico);
  console.log('Wrote', theme.file + '.png/.ico');
}
