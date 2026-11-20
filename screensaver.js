/* A screensaver, hidden behind three clicks on the mark: a wall of covers seen at a steep angle,
   lit from one side and lost in haze at the far end, that the camera drifts over slowly; now and
   then a cover turns over and is another book.

   Kept light on purpose. It is only loaded when asked for. The wall is laid out once, as plain
   images in columns, and every movement is a transform the browser animates on its own: the
   camera is a transition from one view to the next, the slow slide of the wall to the left and the
   light are long animations, a turning cover a short one. No drawing loop runs in script; now and
   then a column that has slid out of sight on the far side is moved to the near one. */

const STYLE = `
.ss { position: fixed; inset: 0; z-index: 9999; overflow: hidden; cursor: none; background: #07061a;
  opacity: 0; transition: opacity 1.6s ease; contain: strict; }
.ss.on { opacity: 1; }
.ss-wall { position: absolute; left: 50%; top: 50%; transform-origin: 0 0; will-change: transform;
  transition-property: transform; transition-timing-function: cubic-bezier(.42, 0, .58, 1); }
.ss-slide { position: absolute; left: 0; top: 0; will-change: transform; }
.ss-col { position: absolute; top: 0; }
.ss-wall img, .ss-flip { position: absolute; left: 0; display: block; object-fit: cover; border-radius: 2px;
  background: #1b1744; box-shadow: 0 8px 18px rgba(0, 0, 0, .55); }
.ss-flip { transform-style: preserve-3d; box-shadow: none; background: none; }
.ss-flip img { position: absolute; inset: 0; width: 100%; height: 100%; backface-visibility: hidden; }
.ss-flip img + img { transform: rotateY(180deg); }
.ss-light, .ss-haze { position: absolute; pointer-events: none; }
.ss-light { inset: -40%; animation: ss-light 70s ease-in-out infinite alternate;
  background: radial-gradient(ellipse 34% 30% at 54% 54%, rgba(255, 214, 160, .07), rgba(7, 6, 26, 0) 55%),
    radial-gradient(ellipse 48% 44% at 54% 54%, rgba(7, 6, 26, 0) 30%, rgba(7, 6, 26, .55) 70%, rgba(7, 6, 26, .92) 100%); }
.ss-haze { inset: 0;
  background: linear-gradient(to bottom right, #07061a 4%, rgba(16, 13, 42, .82) 26%, rgba(16, 13, 42, 0) 58%),
    linear-gradient(to top, rgba(7, 6, 26, .7), rgba(7, 6, 26, 0) 22%); }
@keyframes ss-light { from { transform: translate(7%, 5%); } to { transform: translate(-8%, -6%); } }
`;

const rand = (a, b) => a + Math.random() * (b - a);
const clampRatio = (r) => (r > 0 ? Math.min(1.6, Math.max(0.45, r)) : 0.66);

/**
 * Start the screensaver over the page. `covers`: [{src, ratio}] (ratio = width / height, if known).
 * `onExit` is called on the first key, click or touch (not on moving the mouse); the returned
 * function takes the screensaver away again (it may be called more than once).
 */
export function start(covers, { onExit }) {
  const style = document.createElement('style');
  style.textContent = STYLE;
  const root = document.createElement('div');
  root.className = 'ss';
  root.setAttribute('aria-hidden', 'true');
  const wall = document.createElement('div');
  wall.className = 'ss-wall';
  const light = document.createElement('div');
  light.className = 'ss-light';
  const haze = document.createElement('div');
  haze.className = 'ss-haze';
  root.append(wall, light, haze);
  document.head.append(style);
  document.body.append(root);

  // Covers in a shuffled order, dealt again from the top once all have been used: with only a few
  // they come round again and again, in another order each time. `not`: a cover not to deal now
  // (the one just above, or the one turning), when there is any other.
  let deck = [];
  const deal = (not) => {
    for (let i = 0; ; i++) {
      if (!deck.length) {
        deck = covers.slice();
        for (let k = deck.length - 1; k > 0; k--) { const j = Math.floor(Math.random() * (k + 1)); [deck[k], deck[j]] = [deck[j], deck[k]]; }
      }
      const cover = deck.pop();
      if (cover.src !== not || covers.length < 2 || i > 4) return cover;
    }
  };

  // The wall: columns of covers at their own height, as on a masonry wall, just large enough to
  // fill the screen however the camera stands. It is seen like a floor from above, turned a little,
  // its far side at the top; most of it lies that way from where the camera looks.
  const vw = innerWidth, vh = innerHeight;
  const side = Math.max(vw, vh);
  const col = Math.round(Math.max(96, Math.min(170, side / 11)));
  const gap = Math.round(col / 14);
  // Where the camera may look: a stretch of the wall with room enough around it on every side.
  // Worked out by projecting the screen back onto the wall at the steepest angles and farthest
  // distance a view can have, on a phone, a laptop and a wide screen, with a little to spare.
  const spare = 0.03 * side;
  const left = 0.4 * vw + 0.55 * vh + spare, right = 0.55 * vw + 0.2 * vh + spare;
  const top = Math.max(0.5 * vw + 1.1 * vh, 1.9 * vh) + spare, bottom = 0.25 * vw + 0.6 * vh + spare;
  const roamX = 0.3 * side, roamY = 0.15 * side;
  const W = Math.round(left + roamX + right), H = Math.round(top + roamY + bottom);
  // The columns sit on a slide that moves slowly to the left; one column more than the wall is
  // wide, so the near side stays covered while a column goes round.
  const slide = document.createElement('div');
  slide.className = 'ss-slide';
  wall.append(slide);
  const step = col + gap;
  const tiles = [];
  const columns = [];
  for (let x = 0; x < W + step; x += step) {
    const column = document.createElement('div');
    column.className = 'ss-col';
    column.style.left = `${x}px`;
    let y = -rand(0, col);   // columns start out of step
    let above = null;
    while (y < H) {
      const cover = deal(above);
      above = cover.src;
      const ratio = clampRatio(cover.ratio);
      const height = Math.round(col / ratio);
      const img = new Image();
      img.alt = '';
      img.decoding = 'async';
      Object.assign(img.style, { top: `${Math.round(y)}px`, width: `${col}px`, height: `${height}px` });
      let tries = 0;
      img.onerror = () => { if (++tries < 4) img.src = deal().src; else img.style.visibility = 'hidden'; };
      // Open Library answers a missing cover with a 1×1 pixel image.
      img.onload = () => { if (img.naturalWidth < 8) img.onerror(); };
      img.src = cover.src;
      column.append(img);
      tiles.push({ img, ratio, height, busy: false });
      y += height + gap;
    }
    slide.append(column);
    columns.push({ el: column, x });
  }
  const span = columns.length * step;
  Object.assign(wall.style, { width: `${W}px`, height: `${H}px` });
  // A layer of its own needs a size of its own, or the browser may not draw it at all.
  Object.assign(slide.style, { width: `${span}px`, height: `${H}px` });
  for (const c of columns) Object.assign(c.el.style, { width: `${col}px`, height: `${H}px` });

  // The camera: a view is the point of the wall in the middle of the screen, how far it lies back
  // (about 45°), how far it is turned (about 15°, clockwise) and how near it is. The lens is a long
  // one, so the far side narrows only gently. It drifts from one view to the next, half a minute each.
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const perspective = Math.round(Math.max(700, side * 1.3));
  root.style.perspective = `${perspective}px`;
  const view = () => {
    const x = left + rand(0, roamX), y = top + rand(0, roamY);
    return `translateZ(${rand(-perspective * 0.2, perspective * 0.12).toFixed(0)}px) rotateX(${rand(42, 50).toFixed(1)}deg) rotateZ(${rand(12, 20).toFixed(1)}deg) translate(${-x.toFixed(0)}px, ${-y.toFixed(0)}px)`;
  };
  wall.style.transform = view();
  const timers = new Set();
  const later = (fn, ms) => { const id = setTimeout(() => { timers.delete(id); fn(); }, ms); timers.add(id); };
  const drift = () => {
    const ms = Math.round(rand(24000, 34000));
    wall.style.transitionDuration = `${ms}ms`;
    wall.style.transform = view();
    later(drift, ms);
  };
  // Meanwhile the wall slides to the left, a cover's width in some twenty seconds. A column that
  // has gone past the far edge is moved round to the near one.
  const speed = side / 170;   // px a second
  const far = 1e6;
  const sliding = reduced ? null : slide.animate([{ transform: 'translateX(0)' }, { transform: `translateX(${-far}px)` }],
    { duration: (far / speed) * 1000, easing: 'linear', fill: 'forwards' });
  const goRound = () => {
    const offset = (sliding.currentTime / 1000) * speed;
    for (const c of columns) {
      if (c.x - offset < -step) { c.x += span; c.el.style.left = `${c.x}px`; }
    }
    later(goRound, 1000);
  };
  if (sliding) later(goRound, 1000);
  // Shown once the first covers have had a moment to arrive; the first drift starts with it.
  later(() => { root.classList.add('on'); if (!reduced) drift(); }, 350);

  // Every second or so a cover in sight turns over, some slowly, some quickly, and is another one
  // of much the same shape, which was on its back all along.
  const inSight = (el) => {
    const r = el.getBoundingClientRect();
    return r.width > 24 && r.left > vw * 0.06 && r.right < vw * 0.94 && r.top > vh * 0.08 && r.bottom < vh * 0.94;
  };
  const picture = (src) => { const img = new Image(); img.alt = ''; img.src = src; return img.decode().then(() => img); };
  const flip = async () => {
    let tile = null;
    for (let i = 0; i < 16 && !tile; i++) {
      const t = tiles[Math.floor(Math.random() * tiles.length)];
      if (!t.busy && t.img.style.visibility !== 'hidden' && inSight(t.img)) tile = t;
    }
    if (!tile) return;
    tile.busy = true;
    const now = tile.img.src;
    let next = deal(now);
    for (let i = 0; i < 24 && Math.abs(clampRatio(next.ratio) - tile.ratio) > 0.08; i++) next = deal(now);
    if (next.src === now) { tile.busy = false; return; }   // only one cover: nothing to turn into
    try {
      const [front, back] = await Promise.all([picture(tile.img.src), picture(next.src)]);
      if (back.naturalWidth >= 8 && root.isConnected) await turn(tile, front, back);
    } catch {}
    tile.busy = false;
  };
  const flips = () => { flip(); if (root.isConnected) later(flips, rand(500, 1900)); };
  const turn = async (tile, front, back) => {
    // The card turns in 3D of its own. Nothing on the card itself may flatten it (a filter would,
    // and show the front from behind), so the light that catches it is put on each face.
    const card = document.createElement('div');
    card.className = 'ss-flip';
    Object.assign(card.style, { top: tile.img.style.top, width: tile.img.style.width, height: tile.img.style.height });
    card.append(front, back);
    tile.img.parentNode.append(card);
    tile.img.style.visibility = 'hidden';
    const duration = rand(700, 2600);
    const easing = 'cubic-bezier(.45, 0, .3, 1)';
    const lift = Math.round(tile.height * rand(0.2, 0.45));
    const turning = card.animate([
      { transform: 'perspective(600px) translateZ(0) rotateY(0deg)' },
      { transform: `perspective(600px) translateZ(${lift}px) rotateY(90deg)`, offset: 0.5 },
      { transform: 'perspective(600px) translateZ(0) rotateY(180deg)' },
    ], { duration, easing, fill: 'forwards' });
    front.animate([{ filter: 'brightness(1)' }, { filter: 'brightness(1.6)' }], { duration: duration / 2, easing: 'ease-in', fill: 'forwards' });
    back.animate([{ filter: 'brightness(1.6)' }, { filter: 'brightness(1)' }], { duration: duration / 2, delay: duration / 2, easing: 'ease-out', fill: 'backwards' });
    await turning.finished;
    // The cover on the wall becomes the new one before the card goes, so nothing flashes.
    tile.img.src = back.src;
    await tile.img.decode().catch(() => {});
    tile.img.style.visibility = '';
    card.remove();
  };
  later(flips, 1600);

  // Only a key, a click or a touch ends it: the mouse may move, and the wheel turn, while it runs.
  // (Escape in full screen leaves full screen first, which ends it too.)
  // What ends it does nothing else: the key or click doesn't reach the page underneath.
  const swallow = (e) => { e.preventDefault(); e.stopPropagation(); };
  const exit = (e) => {
    if (e?.type === 'keydown' || e?.type === 'pointerdown') {
      swallow(e);
      addEventListener('click', swallow, { capture: true, once: true });
      setTimeout(() => removeEventListener('click', swallow, true), 700);
    }
    onExit();
  };
  const fullscreen = () => { if (!document.fullscreenElement) exit(null); };
  addEventListener('pointerdown', exit, true);
  addEventListener('keydown', exit, true);
  document.addEventListener('fullscreenchange', fullscreen);

  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    timers.forEach(clearTimeout);
    removeEventListener('pointerdown', exit, true);
    removeEventListener('keydown', exit, true);
    document.removeEventListener('fullscreenchange', fullscreen);
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    root.remove();
    style.remove();
  };
}
