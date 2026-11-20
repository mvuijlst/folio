// corners.js finds a book's corners in a photo. Real photos aren't kept here; these draw a
// book (a tilted, lightly perspective quadrilateral with a picture on it) on backgrounds like
// the ones covers are photographed on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findCover, coverRatio } from '../corners.js';

/** A seeded random number generator, so a failure can be seen again. */
function random(seed) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
}

const inside = (quad, x, y) => quad.every((p, i) => {
  const q = quad[(i + 1) % 4];
  return (q[0] - p[0]) * (y - p[1]) - (q[1] - p[1]) * (x - p[0]) >= 0;
});

/** A width × height picture: `background(x, y)` everywhere, the book (`cover(x, y)`) inside `quad`. */
function picture(width, height, background, quad, cover) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = quad && inside(quad, x + 0.5, y + 0.5) ? cover(x, y) : background(x, y);
      const i = (y * width + x) * 4;
      data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
    }
  }
  return { data, width, height };
}

const near = (found, quad, tolerance) => found.quad.every(([x, y], i) => Math.hypot(x - quad[i][0], y - quad[i][1]) <= tolerance);

// A cover with a picture on it: a frame of its own inside, which must not be taken for the book.
const comic = (x, y) => {
  const framed = x > 180 && x < 520 && y > 300 && y < 760;
  return framed ? [(x * 7) % 200 + 40, (y * 3) % 180 + 50, 120] : [225, 60, 40];
};

test('a comic lying on a dark mottled table', () => {
  const rnd = random(1);
  const quad = [[130, 140], [580, 120], [600, 830], [110, 850]];
  const found = findCover(picture(720, 1000, () => { const v = 40 + rnd() * 30; return [v, v, v + 5]; }, quad, comic));
  assert.ok(found, 'found');
  assert.ok(found.sure, 'sure');
  assert.ok(near(found, quad, 8), JSON.stringify(found.quad));
});

test('a pale green book on grey stone (little contrast in any one channel)', () => {
  const rnd = random(2);
  const quad = [[90, 300], [640, 290], [660, 760], [70, 770]];   // a landscape picture book
  const found = findCover(picture(720, 1000, () => { const v = 178 + rnd() * 10; return [v, v, v - 4]; }, quad, () => [176, 206, 150]));
  assert.ok(found?.sure, 'sure');
  assert.ok(near(found, quad, 8), JSON.stringify(found?.quad));
});

test('a book held up, tilted, in front of shelves of spines', () => {
  const rnd = random(3);
  // Four shelves of spines of all widths (as books are), each shelf with a wooden edge along its top.
  const shelves = [0, 1, 2, 3].map(() => {
    const edges = [0];
    while (edges.at(-1) < 720) edges.push(edges.at(-1) + 14 + Math.floor(rnd() * 34));
    return edges.map(() => Math.floor(rnd() * 255));
  });
  const widths = [0, 1, 2, 3].map(() => []);
  const spineAt = (shelf, x) => {
    const w = widths[shelf];
    if (!w.length) { let at = 0; const r = random(10 + shelf); while (at < 720) { at += 14 + Math.floor(r() * 34); w.push(at); } }
    return w.findIndex((edge) => x < edge);
  };
  const spines = (x, y) => {
    const shelf = Math.min(3, Math.floor(y / 250));
    if (y % 250 < 14) return [120, 80, 40];
    const k = shelves[shelf][spineAt(shelf, x)] ?? 128;
    return [k, (k * 3) % 255, (k * 7) % 255].map((v) => v * 0.8 + rnd() * 20);
  };
  const quad = [[170, 170], [600, 230], [540, 900], [100, 840]];
  const found = findCover(picture(720, 1000, spines, quad, (x, y) => [235 - (y % 90 < 4 ? 120 : 0), 232, 215]));
  assert.ok(found?.sure, 'sure');
  assert.ok(near(found, quad, 10), JSON.stringify(found?.quad));
});

test('a worn pale cover on pale stone, with a strong dark banner near its top', () => {
  // Its own edges are faint; the banner's are strong, and so are the lines of the title and the
  // drawing below it, shorter than the cover is wide. The frame must not stop at the banner.
  const rnd = random(5);
  const quad = [[60, 90], [660, 100], [672, 960], [52, 966]];
  const cover = (x, y) => {
    if (y > 180 && y < 215) return [40, 40, 45];                                       // the banner
    const row = Math.floor((y - 250) / 60);   // title and drawing: bands of different widths
    if (y > 250 && y < 900 && (y - 250) % 60 < 22 && x > 120 + (row * 37) % 90 && x < 600 - (row * 53) % 110) return [50, 60, 120];
    return [160 + rnd() * 8, 175 + rnd() * 8, 186 + rnd() * 8];   // a little darker than the stone, as in the photo
  };
  const found = findCover(picture(720, 1050, () => { const v = 186 + rnd() * 14; return [v, v, v - 3]; }, quad, cover));
  assert.ok(found?.sure, 'sure');
  assert.ok(near(found, quad, 10), JSON.stringify(found?.quad));
});

test('no book: plain stone, or only shelves, is never a sure frame', () => {
  const rnd = random(4);
  const stone = findCover(picture(600, 800, () => { const v = 170 + rnd() * 25; return [v, v, v]; }));
  assert.ok(!stone || !stone.sure, JSON.stringify(stone));
  const stripes = findCover(picture(600, 800, (x) => (Math.floor(x / 40) % 2 ? [200, 60, 60] : [40, 40, 120])));
  assert.ok(!stripes || !stripes.sure, JSON.stringify(stripes));
});

/** The corners of a w × h rectangle in a photo of W × H pixels, turned `tilt` degrees away at the top and `turn` degrees sideways, `distance` off. */
function photographed(w, h, { W = 1200, H = 1500, tilt = 0, turn = 0, distance = 3 } = {}) {
  const f = Math.max(W, H), a = tilt * Math.PI / 180, b = turn * Math.PI / 180;
  return [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]].map(([x, y]) => {
    const y1 = y * Math.cos(a), z1 = y * Math.sin(a) * -1;                 // the top leans away
    const x2 = x * Math.cos(b) + z1 * Math.sin(b), z2 = -x * Math.sin(b) + z1 * Math.cos(b);
    const z = z2 + distance;
    return [W / 2 + f * x2 / z, H / 2 + f * y1 / z];
  });
}

test('coverRatio: a book photographed straight on keeps its shape', () => {
  assert.ok(Math.abs(coverRatio(photographed(0.11, 0.178, { distance: 0.3 }), 1200, 1500) - 0.11 / 0.178) < 0.005);
});

test('coverRatio: a slanted photo gives the book its real shape, not the shape it was drawn', () => {
  for (const [tilt, turn] of [[35, 0], [25, 12], [-30, 0], [0, 30], [40, -15]]) {
    const quad = photographed(0.11, 0.178, { tilt, turn, distance: 0.3 });
    assert.ok(Math.abs(coverRatio(quad, 1200, 1500) - 0.11 / 0.178) < 0.005, `tilt ${tilt}, turn ${turn}`);
  }
});

test('coverRatio: a paperback photographed from below its bottom edge (They came and ate us) is not made too wide', () => {
  // The frame as it was dragged onto a photo where the drawn sides make it 0.78 wide for its height; the book is 0.62.
  const r = coverRatio([[222, 58], [668, 52], [815, 856], [175, 877]], 930, 944);
  assert.ok(r > 0.57 && r < 0.66, String(r));
});
