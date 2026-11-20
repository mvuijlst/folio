/* A screensaver, hidden behind three clicks on the mark: a wall of covers seen at a steep angle,
   lit from one side and lost in haze at the far end, that the camera drifts over slowly; now and
   then a cover turns over and is another book.

   Kept light on purpose. It is only loaded when asked for. The wall is laid out once, as plain
   images in one element, and every movement is a CSS transform the browser animates on its own:
   the camera is a transition from one view to the next, the light a looping animation, a turning
   cover one small animation at a time. No drawing loop runs in script. */

const STYLE = `
.ss { position: fixed; inset: 0; z-index: 9999; overflow: hidden; cursor: none; background: #07061a;
  opacity: 0; transition: opacity 1.6s ease; contain: strict; }
.ss.on { opacity: 1; }
.ss-wall { position: absolute; left: 50%; top: 50%; transform-origin: 0 0; will-change: transform;
  transition-property: transform; transition-timing-function: cubic-bezier(.42, 0, .58, 1); }
.ss-wall img, .ss-flip { position: absolute; display: block; object-fit: cover; border-radius: 2px;
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
 * `onExit` is called on the first key, click, touch or real movement of the mouse; the returned
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

  // Covers in a shuffled order, dealt again from the top once all have been used.
  let deck = [];
  const deal = () => {
    if (!deck.length) {
      deck = covers.slice();
      for (let i = deck.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [deck[i], deck[j]] = [deck[j], deck[i]]; }
    }
    return deck.pop();
  };

  // The wall: columns of covers at their own height, as on a masonry wall, just large enough to
  // fill the screen however the camera stands. It leans away to the top left, so most of it lies
  // that way from where the camera looks; what is far off there is lost in the haze.
  const vw = innerWidth, vh = innerHeight;
  const side = Math.max(vw, vh);
  const col = Math.round(Math.max(96, Math.min(170, side / 11)));
  const gap = Math.round(col / 14);
  // Where the camera may look: a stretch of the wall with room enough around it on every side
  // (measured at the steepest angles and farthest distance a view can have).
  const left = 1.4 * vw + 0.15 * side, right = 0.75 * vw + 0.05 * side;
  const top = 1.3 * vh + 0.05 * side, bottom = 0.7 * vh + 0.1 * side;
  const roamX = 0.3 * side, roamY = 0.15 * side;
  const W = Math.round(left + roamX + right), H = Math.round(top + roamY + bottom);
  const tiles = [];
  for (let x = 0; x + col <= W; x += col + gap) {
    let y = -rand(0, col);   // columns start out of step
    while (y < H) {
      const cover = deal();
      const ratio = clampRatio(cover.ratio);
      const height = Math.round(col / ratio);
      const img = new Image();
      img.alt = '';
      img.decoding = 'async';
      Object.assign(img.style, { left: `${x}px`, top: `${Math.round(y)}px`, width: `${col}px`, height: `${height}px` });
      let tries = 0;
      img.onerror = () => { if (++tries < 4) img.src = deal().src; else img.style.visibility = 'hidden'; };
      // Open Library answers a missing cover with a 1×1 pixel image.
      img.onload = () => { if (img.naturalWidth < 8) img.onerror(); };
      img.src = cover.src;
      wall.append(img);
      tiles.push({ img, ratio, x, y, height });
      y += height + gap;
    }
  }
  Object.assign(wall.style, { width: `${W}px`, height: `${H}px` });

  // The camera: a view is the point of the wall in the middle of the screen, how far it leans
  // back and away, and how near it is. It drifts from one view to the next, half a minute each.
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const perspective = Math.round(Math.max(700, side * 0.75));
  root.style.perspective = `${perspective}px`;
  const view = () => {
    const x = left + rand(0, roamX), y = top + rand(0, roamY);
    return `translateZ(${rand(-perspective * 0.25, perspective * 0.12).toFixed(0)}px) rotateX(${rand(20, 32).toFixed(1)}deg) rotateY(${rand(-32, -22).toFixed(1)}deg) rotateZ(${rand(2, 9).toFixed(1)}deg) translate(${-x.toFixed(0)}px, ${-y.toFixed(0)}px)`;
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
  // Shown once the first covers have had a moment to arrive; the first drift starts with it.
  later(() => { root.classList.add('on'); if (!reduced) drift(); }, 350);

  // Now and then a cover in sight turns over and is another one, of much the same shape.
  const inSight = (el) => {
    const r = el.getBoundingClientRect();
    return r.width > 24 && r.left > vw * 0.08 && r.right < vw * 0.92 && r.top > vh * 0.12 && r.bottom < vh * 0.9;
  };
  const flip = async () => {
    let tile = null;
    for (let i = 0; i < 16 && !tile; i++) {
      const t = tiles[Math.floor(Math.random() * tiles.length)];
      if (t.img.style.visibility !== 'hidden' && inSight(t.img)) tile = t;
    }
    if (tile) {
      let next = deal();
      for (let i = 0; i < 24 && Math.abs(clampRatio(next.ratio) - tile.ratio) > 0.08; i++) next = deal();
      const back = new Image();
      back.alt = '';
      back.src = next.src;
      try {
        await back.decode();
        if (back.naturalWidth >= 8 && root.isConnected) await turn(tile, back);
      } catch {}
    }
    if (root.isConnected) later(flip, rand(1800, 4200));
  };
  const turn = (tile, back) => {
    const card = document.createElement('div');
    card.className = 'ss-flip';
    const front = tile.img.cloneNode();
    Object.assign(card.style, { left: tile.img.style.left, top: tile.img.style.top, width: tile.img.style.width, height: tile.img.style.height });
    front.removeAttribute('style');
    card.append(front, back);
    wall.append(card);
    tile.img.style.visibility = 'hidden';
    const lift = Math.round(tile.height * 0.35);
    const turning = card.animate([
      { transform: 'perspective(600px) translateZ(0) rotateY(0deg)', filter: 'brightness(1)' },
      { transform: `perspective(600px) translateZ(${lift}px) rotateY(90deg)`, filter: 'brightness(1.5)', offset: 0.5 },
      { transform: 'perspective(600px) translateZ(0) rotateY(180deg)', filter: 'brightness(1)' },
    ], { duration: 1500, easing: 'cubic-bezier(.45, 0, .3, 1)' });
    return turning.finished.then(() => {
      tile.img.src = back.src;
      tile.img.style.visibility = '';
      card.remove();
    });
  };
  later(flip, 2600);

  // Any key, click or touch ends it, and so does moving the mouse more than a nudge (but not in
  // the first moment, while the hand that clicked three times is still on it).
  const began = performance.now();
  let from = null;
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
  const move = (e) => {
    if (e.pointerType !== 'mouse' || performance.now() - began < 900) return;
    if (!from) { from = [e.clientX, e.clientY]; return; }
    if (Math.hypot(e.clientX - from[0], e.clientY - from[1]) > 30) exit(null);
  };
  const fullscreen = () => { if (!document.fullscreenElement) exit(null); };
  addEventListener('pointerdown', exit, true);
  addEventListener('keydown', exit, true);
  addEventListener('wheel', exit, { capture: true, passive: true });
  addEventListener('pointermove', move, true);
  document.addEventListener('fullscreenchange', fullscreen);

  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    timers.forEach(clearTimeout);
    removeEventListener('pointerdown', exit, true);
    removeEventListener('keydown', exit, true);
    removeEventListener('wheel', exit, true);
    removeEventListener('pointermove', move, true);
    document.removeEventListener('fullscreenchange', fullscreen);
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    root.remove();
    style.remove();
  };
}
