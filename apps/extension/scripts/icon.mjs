/**
 * Draws the extension icon from geometry and writes every size the manifest
 * declares, plus the site's favicon.
 *
 * Why not a PNG from a design tool: the mark has to survive 16px, where a
 * diagonal one-and-a-half-pixel stroke dissolves into the pixel grid. Keeping
 * it as geometry means the small size is re-cut rather than downscaled, and a
 * palette change is an edit here instead of a re-export in five sizes.
 *
 * Run: node apps/extension/scripts/icon.mjs
 */
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const SS = 4; // supersampling per axis

// ── palette ────────────────────────────────────────────────────────────────
const PAPER_A = [0xfd, 0xfb, 0xf6]; // lit from the top-left
const PAPER_B = [0xe7, 0xda, 0xc4];
const SHADOW = [0xa9, 0x97, 0x7c];
const INK = [0x17, 0x1a, 0x20]; // the key
const BEVEL = [0x41, 0x48, 0x55]; // upper-left edge of the key, one pixel
const STREAK = [0x2f, 0x7c, 0xf6]; // the light travelling down the shaft

// ── geometry, in a unit square ─────────────────────────────────────────────
const BASE = {
  bx: 0.368, // bow (ring) centre
  by: 0.628,
  theta: (-32 * Math.PI) / 180, // shaft points up-right
  R: 0.166, // bow outer radius
  thick: 0.059, // ring thickness
  gap: 0.42, // half-angle of the opening in the ring
  gapAt: (225 * Math.PI) / 180, // the opening faces upper-left
  w: 0.029, // shaft half-width
  len: 0.5, // shaft length from the bow centre
  teeth: [
    // [uStart, uEnd, depth], on one side of the shaft
    [0.322, 0.38, 0.094],
    [0.416, 0.468, 0.06],
  ],
  core: [0.208, 0.492, 0.0115, 0.0015], // streak: uStart, uEnd, half-width ends
};
const T = structuredClone(BASE);

/**
 * Optical sizes: 32 and below lose the thin strokes, so the mark is redrawn
 * bolder; at 16 the diagonal is dropped entirely, because nothing thinner than
 * two pixels survives it.
 */
function hint(size) {
  Object.assign(T, BASE);
  if (size > 32) return;
  T.w = 0.037;
  T.thick = 0.069;
  T.R = 0.174;
  T.len = 0.492;
  T.teeth = [[0.305, 0.398, 0.1]];
  T.core = [0, 0, 0, 0];
  if (size <= 16) {
    T.theta = 0;
    T.bx = 0.275;
    T.by = 0.5;
    T.R = 0.185;
    T.thick = T.R;
    T.gap = 0.0001;
    T.w = 0.058;
    T.len = 0.585;
    T.teeth = [
      [0.315, 0.415, 0.125],
      [0.455, 0.515, 0.088],
    ];
  }
}

const R_CORNER = 0.235;
const inSquircle = (x, y) => {
  const d = Math.max(R_CORNER - x, 0, x - (1 - R_CORNER));
  const e = Math.max(R_CORNER - y, 0, y - (1 - R_CORNER));
  return (d === 0 && e === 0) || d * d + e * e <= R_CORNER * R_CORNER;
};

/** Point in shaft-local coordinates: u along the shaft, v across it. */
function local(x, y) {
  const px = x - T.bx;
  const py = y - T.by;
  const c = Math.cos(T.theta);
  const s = Math.sin(T.theta);
  return [px * c + py * s, -px * s + py * c];
}

const angle = (a, b) => {
  let d = a - b;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return Math.abs(d);
};

function inKey(x, y) {
  const [u, v] = local(x, y);
  const dist = Math.hypot(u, v);

  if (dist <= T.R && dist >= T.R - T.thick) {
    if (angle(Math.atan2(v, u), T.gapAt) > T.gap) return true;
  }
  // The bow's hole stays empty — a shaft crossing it reads as a lollipop stick.
  if (dist < T.R - T.thick) return false;

  if (u >= 0 && u <= T.len && Math.abs(v) <= T.w) return true;
  if (u > T.len && Math.hypot(u - T.len, v) <= T.w) return true;

  for (const [u0, u1, depth] of T.teeth) {
    if (u >= u0 && u <= u1 && v >= T.w * 0.5 && v <= T.w + depth) return true;
  }
  return false;
}

/** 0..1 coverage of the streak: fades in at the ring, tapers out at the tip. */
function streak(x, y) {
  const [u, v] = local(x, y);
  if (u < T.core[0] || u > T.core[1]) return 0;
  const t = (u - T.core[0]) / (T.core[1] - T.core[0]);
  const hw = T.core[2] + (T.core[3] - T.core[2]) * t;
  if (Math.abs(v) > hw) return 0;
  return Math.min(1, t / 0.22) * Math.pow(Math.min(1, (1 - t) / 0.3), 0.6);
}

const lerp = (a, b, t) => a + (b - a) * t;
const blend = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

function render(size) {
  hint(size);
  const px = Buffer.alloc(size * size * 4);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;

      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const ux = (x + (sx + 0.5) / SS) / size;
          const uy = (y + (sy + 0.5) / SS) / size;
          if (!inSquircle(ux, uy)) continue;

          // paper, lit from the top-left, with the lower-right corner sinking
          let c = blend(PAPER_A, PAPER_B, clamp01(0.62 * ux + 0.38 * uy));
          const vignette = clamp01((Math.hypot(ux - 0.15, uy - 0.1) - 0.55) * 0.9);
          c = c.map((v) => v * (1 - 0.1 * vignette));

          if (inKey(ux - 0.01, uy - 0.014)) c = blend(c, SHADOW, 0.3);
          if (inKey(ux, uy)) {
            const edge = !inKey(ux - 0.0045, uy - 0.0055);
            const s = streak(ux, uy);
            c = s > 0 ? blend(edge ? BEVEL : INK, STREAK, s) : edge ? BEVEL : INK;
          }

          r += c[0];
          g += c[1];
          b += c[2];
          n++;
        }
      }

      const o = (y * size + x) * 4;
      if (n > 0) {
        px[o] = Math.round(r / n);
        px[o + 1] = Math.round(g / n);
        px[o + 2] = Math.round(b / n);
        px[o + 3] = Math.round((n / (SS * SS)) * 255);
      }
    }
  }
  return px;
}

// ── PNG ────────────────────────────────────────────────────────────────────
const CRC = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};

function toPng(rgba, w, h) {
  const stride = w * 4;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // truecolour + alpha
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ── output ─────────────────────────────────────────────────────────────────
const iconDir = join(ROOT, "apps/extension/public/icon");
mkdirSync(iconDir, { recursive: true });

for (const size of [16, 32, 48, 96, 128]) {
  writeFileSync(join(iconDir, `${size}.png`), toPng(render(size), size, size));
}
// Next reads `app/icon.png` as the favicon for every route.
writeFileSync(join(ROOT, "apps/website/app/icon.png"), toPng(render(128), 128, 128));

console.log(`icons written → ${iconDir}`);
