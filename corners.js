/* Where the book is in a photograph of its cover: its four corners, found by itself, so that
   Straighten starts with the frame on the book and a pile of photos can be straightened at once.

   Straight edges, not colours: a cover is held in a hand in front of a bookcase as often as it
   lies on a plain table. The strongest straight lines of a small copy of the photo are found
   (a Hough transform over its edges, each edge voting only for lines that run along it), and of
   those, the two near-horizontal and two near-vertical ones that make the frame best backed by
   real edges along its whole length. A frame larger than the book loses on the stretches where
   nothing backs it; one inside the book (a picture on the cover) loses to the larger one that is
   backed as well. Tried on photos of comics on a table and books held up in front of shelves. */

const SMALL = 360;     // longest side of the copy the lines are looked for in
const TILT = 35;       // how far from upright (in degrees) a side may lean
const BEYOND = 2;      // what an edge that carries on past a corner costs, per pixel (see findCover)

/** The picture (RGBA) at most `side` pixels on its longest side, by averaging: {rgb, w, h, k}. */
function shrink({ data, width, height }, side) {
  const k = Math.min(1, side / Math.max(width, height));
  const w = Math.max(1, Math.round(width * k)), h = Math.max(1, Math.round(height * k));
  const out = new Float32Array(w * h * 3);
  const fx = width / w, fy = height / h;
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor(y * fy), y1 = Math.max(y0 + 1, Math.floor((y + 1) * fy));
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor(x * fx), x1 = Math.max(x0 + 1, Math.floor((x + 1) * fx));
      let r = 0, g = 0, b = 0, n = 0;
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          const i = (yy * width + xx) * 4;
          r += data[i]; g += data[i + 1]; b += data[i + 2]; n++;
        }
      }
      const o = (y * w + x) * 3;
      out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n;
    }
  }
  return { rgb: out, w, h, k: w / width };
}

/** A light blur, then how strongly and which way the colour changes at each pixel. */
function gradients({ rgb, w, h }) {
  const tmp = new Float32Array(rgb.length), blur = new Float32Array(rgb.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const l = Math.max(0, x - 1), r = Math.min(w - 1, x + 1);
      for (let c = 0; c < 3; c++) tmp[(y * w + x) * 3 + c] = (rgb[(y * w + l) * 3 + c] + 2 * rgb[(y * w + x) * 3 + c] + rgb[(y * w + r) * 3 + c]) / 4;
    }
  }
  for (let y = 0; y < h; y++) {
    const u = Math.max(0, y - 1), d = Math.min(h - 1, y + 1);
    for (let x = 0; x < w; x++) {
      for (let c = 0; c < 3; c++) blur[(y * w + x) * 3 + c] = (tmp[(u * w + x) * 3 + c] + 2 * tmp[(y * w + x) * 3 + c] + tmp[(d * w + x) * 3 + c]) / 4;
    }
  }
  const mag = new Float32Array(w * h), gx = new Float32Array(w * h), gy = new Float32Array(w * h);
  const at = (x, y, c) => blur[(y * w + x) * 3 + c];
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      // The three channels together (Di Zenzo): a pale green cover on grey stone shows, though no one channel changes much.
      let xx = 0, yy = 0, xy = 0;
      for (let c = 0; c < 3; c++) {
        const sx = (at(x + 1, y - 1, c) + 2 * at(x + 1, y, c) + at(x + 1, y + 1, c) - at(x - 1, y - 1, c) - 2 * at(x - 1, y, c) - at(x - 1, y + 1, c)) / 4;
        const sy = (at(x - 1, y + 1, c) + 2 * at(x, y + 1, c) + at(x + 1, y + 1, c) - at(x - 1, y - 1, c) - 2 * at(x, y - 1, c) - at(x + 1, y - 1, c)) / 4;
        xx += sx * sx; yy += sy * sy; xy += sx * sy;
      }
      const m = Math.sqrt(Math.max(0, 0.5 * (xx + yy + Math.sqrt((xx - yy) ** 2 + 4 * xy * xy))));
      const theta = 0.5 * Math.atan2(2 * xy, xx - yy);
      const i = y * w + x;
      mag[i] = m; gx[i] = m * Math.cos(theta); gy[i] = m * Math.sin(theta);
    }
  }
  return { mag, gx, gy, w, h };
}

/** The strongest straight lines, as x·cos θ + y·sin θ = ρ (θ in whole degrees, 0–179), strongest first. */
function lines({ mag, gx, gy, w, h }, threshold) {
  const D = Math.ceil(Math.hypot(w, h)), R = 2 * D + 1;
  const acc = new Float32Array(180 * R);
  const cos = [], sin = [];
  for (let t = 0; t < 180; t++) { cos[t] = Math.cos(t * Math.PI / 180); sin[t] = Math.sin(t * Math.PI / 180); }
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x, m = mag[i];
      if (m < threshold) continue;
      const phi = ((Math.round(Math.atan2(gy[i], gx[i]) * 180 / Math.PI) % 180) + 180) % 180;   // across the edge
      for (let d = -3; d <= 3; d++) {
        const t = (phi + d + 180) % 180;
        acc[t * R + Math.round(x * cos[t] + y * sin[t]) + D] += Math.min(m, 4 * threshold);
      }
    }
  }
  const peaks = [];
  for (let t = 0; t < 180; t++) {
    for (let r = 2; r < R - 2; r++) {
      const v = acc[t * R + r];
      if (v < threshold * 12) continue;
      let top = true;
      for (let dt = -2; dt <= 2 && top; dt++) {
        for (let dr = -2; dr <= 2; dr++) {
          if (!dt && !dr) continue;
          let tt = t + dt, rr = r;
          if (tt < 0 || tt >= 180) { tt = (tt + 180) % 180; rr = R - 1 - r; }   // θ wraps round with ρ turned over
          if (acc[tt * R + rr + dr] > v) { top = false; break; }
        }
      }
      if (top) peaks.push({ t, rho: r - D, v });
    }
  }
  peaks.sort((a, b) => b.v - a.v);
  const kept = [];
  const near = (a, b) => {
    let dt = Math.abs(a.t - b.t), rb = b.rho;
    if (dt > 90) { dt = 180 - dt; rb = -rb; }
    return dt <= 4 && Math.abs(a.rho - rb) <= 5;
  };
  for (const p of peaks) {
    if (kept.length >= 60) break;
    if (!kept.some((q) => near(p, q))) kept.push(p);
  }
  return kept.map((p) => ({ ...p, c: cos[p.t], s: sin[p.t] }));
}

function meet(a, b) {
  const det = a.c * b.s - a.s * b.c;
  if (Math.abs(det) < 1e-6) return null;
  return [(a.rho * b.s - a.s * b.rho) / det, (a.c * b.rho - a.rho * b.c) / det];
}

/** How much of the side from p to q runs along a real edge that goes the same way. → [backed, total] */
function backing({ mag, gx, gy, w, h }, p, q, support) {
  const L = Math.hypot(q[0] - p[0], q[1] - p[1]);
  const n = Math.max(2, Math.round(L));
  const nx = -(q[1] - p[1]) / L, ny = (q[0] - p[0]) / L;
  let backed = 0, total = 0;
  for (let k = 0; k <= n; k++) {
    const x = p[0] + (q[0] - p[0]) * k / n, y = p[1] + (q[1] - p[1]) * k / n;
    if (x < 1 || y < 1 || x >= w - 1 || y >= h - 1) continue;   // off the picture: neither for nor against
    total++;
    for (let d = -2; d <= 2; d++) {
      const xi = Math.round(x + nx * d), yi = Math.round(y + ny * d);
      if (xi < 1 || yi < 1 || xi >= w - 1 || yi >= h - 1) continue;
      const i = yi * w + xi, m = mag[i];
      if (m >= support && Math.abs(gx[i] * nx + gy[i] * ny) / m > 0.85) { backed++; break; }
    }
  }
  return [backed, total];
}

/**
 * The cover in a photo. `image` is an ImageData (or anything with RGBA `data`, `width`, `height`).
 * → {quad, sure} or null when nothing looks like a book: `quad` its corners in the photo's
 * pixels, [x, y] clockwise from top left; `sure` when every side follows a real edge for most
 * of its length (then the frame can be trusted without looking; otherwise it is a guess).
 */
export function findCover(image) {
  const small = shrink(image, SMALL);
  const g = gradients(small);
  const { w, h } = g;
  // How strong an edge has to be: by this photo's own edges, within limits.
  const sorted = Float32Array.from(g.mag).sort();
  const threshold = Math.max(6, Math.min(18, sorted[Math.floor(sorted.length * 0.9)] * 0.8));
  const support = threshold * 0.6;
  const found = lines(g, threshold);
  const across = found.filter((l) => Math.abs(l.t - 90) <= TILT).slice(0, 14);          // top and bottom
  const upright = found.filter((l) => l.t <= TILT || l.t >= 180 - TILT).slice(0, 14);   // left and right
  const yAt = (l) => (l.rho - (w / 2) * l.c) / l.s;   // where a near-horizontal line crosses the middle
  const xAt = (l) => (l.rho - (h / 2) * l.s) / l.c;   // where a near-vertical one does
  const angle = (a, b) => { const d = Math.abs(a.t - b.t); return d > 90 ? 180 - d : d; };
  const sides = new Map();
  const side = (p, q, key) => {
    if (!sides.has(key)) sides.set(key, backing(g, p, q, support));
    return sides.get(key);
  };
  let best = null;
  for (let i = 0; i < across.length; i++) {
    for (let j = 0; j < across.length; j++) {
      const top = across[i], bottom = across[j];
      if (yAt(bottom) - yAt(top) < h * 0.25 || angle(top, bottom) > 20) continue;
      for (let a = 0; a < upright.length; a++) {
        for (let b = 0; b < upright.length; b++) {
          const left = upright[a], right = upright[b];
          if (xAt(right) - xAt(left) < w * 0.2 || angle(left, right) > 20) continue;
          const quad = [meet(top, left), meet(top, right), meet(bottom, right), meet(bottom, left)];
          if (quad.some((p) => !p || p[0] < -w * 0.05 || p[1] < -h * 0.05 || p[0] > w * 1.05 || p[1] > h * 1.05)) continue;
          let turn = 0, convex = true, area = 0;
          for (let k = 0; k < 4; k++) {
            const [p, q, r] = [quad[k], quad[(k + 1) % 4], quad[(k + 2) % 4]];
            const cross = Math.sign((q[0] - p[0]) * (r[1] - q[1]) - (q[1] - p[1]) * (r[0] - q[0]));
            if (!turn) turn = cross; else if (cross !== turn) convex = false;
            area += p[0] * q[1] - q[0] * p[1];
          }
          if (!convex || Math.abs(area) / 2 < w * h * 0.12) continue;
          const len = (k) => Math.hypot(quad[(k + 1) % 4][0] - quad[k][0], quad[(k + 1) % 4][1] - quad[k][1]);
          const ratio = (len(0) + len(2)) / (len(1) + len(3));
          if (ratio < 0.4 || ratio > 1.9) continue;   // wider than a landscape picture book, narrower than a pocket diary
          const keys = [`t${i}:${a}:${b}`, `r${b}:${i}:${j}`, `b${j}:${a}:${b}`, `l${a}:${i}:${j}`];
          const backed = [0, 1, 2, 3].map((k) => side(quad[k], quad[(k + 1) % 4], keys[k]));
          if (backed.some(([, total]) => total < 10)) continue;
          const cover = backed.map(([yes, total]) => yes / total);
          if (Math.min(...cover) < 0.3) continue;
          // Backed length counts for the frame, unbacked length against it. And a book's corner is where
          // its edges stop: a side whose edge carries on past a corner is not the book's (a shelf's edge
          // running on beyond it, or the book's own side running on past a picture on the cover).
          let score = backed.reduce((s, [yes, total]) => s + yes - (total - yes), 0);
          for (let k = 0; k < 4; k++) {
            const p = quad[k], q = quad[(k + 1) % 4];
            const L = len(k), reach = Math.min(25, L * 0.15);
            const ux = (q[0] - p[0]) / L, uy = (q[1] - p[1]) / L;
            const ends = [
              side([p[0] - ux * 2, p[1] - uy * 2], [p[0] - ux * reach, p[1] - uy * reach], `${keys[k]}<`),
              side([q[0] + ux * 2, q[1] + uy * 2], [q[0] + ux * reach, q[1] + uy * reach], `${keys[k]}>`),
            ];
            for (const [yes] of ends) score -= BEYOND * yes;
          }
          if (!best || score > best.score) best = { quad, cover, score };
        }
      }
    }
  }
  if (!best) return null;
  const mean = best.cover.reduce((s, c) => s + c, 0) / 4;
  return {
    quad: best.quad.map(([x, y]) => [
      Math.min(image.width, Math.max(0, x / small.k)),
      Math.min(image.height, Math.max(0, y / small.k)),
    ]),
    sure: mean >= 0.75 && Math.min(...best.cover) >= 0.6,
  };
}
