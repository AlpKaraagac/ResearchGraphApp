// Pan/zoom controller for the canvas. One finger (or mouse drag) pans, two
// fingers pinch-zoom, wheel zooms around the cursor. A drag is only treated
// as a drag after 6px of movement, so taps on node cards still click.

const SCALE_MIN = 0.05; // low enough that Fit can show a large map on a phone
const SCALE_MAX = 2.5;
const DRAG_THRESHOLD = 6;
const GRID = 24; // must match the canvas background-size in app.css

export function createView(canvas, viewport) {
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let tx = 0;
  let ty = 0;
  let scale = 1;
  let dragged = false;
  let animation = null;
  const pointers = new Map();

  function apply() {
    viewport.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
    canvas.style.backgroundPosition = `${tx}px ${ty}px`;
    canvas.style.backgroundSize = `${GRID * scale}px ${GRID * scale}px`;
    viewport.classList.toggle('zoomed-out', scale < 0.7);
  }

  function stopAnimation() {
    if (animation !== null) cancelAnimationFrame(animation);
    animation = null;
  }

  function zoomAt(cx, cy, factor) {
    const next = Math.min(SCALE_MAX, Math.max(SCALE_MIN, scale * factor));
    const k = next / scale;
    tx = cx - (cx - tx) * k;
    ty = cy - (cy - ty) * k;
    scale = next;
    apply();
  }

  canvas.addEventListener('wheel', (event) => {
    event.preventDefault();
    stopAnimation();
    const rect = canvas.getBoundingClientRect();
    zoomAt(event.clientX - rect.left, event.clientY - rect.top, Math.exp(-event.deltaY * 0.0015));
  }, { passive: false });

  canvas.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    stopAnimation();
    pointers.set(event.pointerId, {
      x: event.clientX, y: event.clientY,
      startX: event.clientX, startY: event.clientY,
    });
    if (pointers.size === 1) dragged = false;
  });

  canvas.addEventListener('pointermove', (event) => {
    const p = pointers.get(event.pointerId);
    if (!p) return;
    const dx = event.clientX - p.x;
    const dy = event.clientY - p.y;

    if (!dragged) {
      const moved = Math.hypot(event.clientX - p.startX, event.clientY - p.startY);
      if (moved < DRAG_THRESHOLD && pointers.size === 1) {
        p.x = event.clientX;
        p.y = event.clientY;
        // don't update tx/ty yet: below the threshold this is still a tap
        return;
      }
      dragged = true;
      canvas.classList.add('is-panning');
      try { canvas.setPointerCapture(event.pointerId); } catch { /* gone already */ }
    }

    if (pointers.size === 1) {
      tx += dx;
      ty += dy;
    } else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const prevDist = Math.hypot(a.x - b.x, a.y - b.y);
      p.x = event.clientX;
      p.y = event.clientY;
      const [a2, b2] = [...pointers.values()];
      const dist = Math.hypot(a2.x - b2.x, a2.y - b2.y);
      const rect = canvas.getBoundingClientRect();
      const midX = (a2.x + b2.x) / 2 - rect.left;
      const midY = (a2.y + b2.y) / 2 - rect.top;
      tx += dx / 2;
      ty += dy / 2;
      if (prevDist > 0) zoomAt(midX, midY, dist / prevDist);
      return; // p.x/p.y already updated
    }
    p.x = event.clientX;
    p.y = event.clientY;
    apply();
  });

  function release(event) {
    pointers.delete(event.pointerId);
    if (pointers.size === 0) canvas.classList.remove('is-panning');
  }
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);

  // Capture-phase click guard: after a real drag, swallow the click so it
  // neither selects a card nor deselects the current one.
  canvas.addEventListener('click', (event) => {
    if (dragged) {
      dragged = false;
      event.stopPropagation();
      event.preventDefault();
    }
  }, true);

  function setTransform(nextTx, nextTy, nextScale) {
    tx = nextTx;
    ty = nextTy;
    scale = nextScale;
    apply();
  }

  function animateTo(nextTx, nextTy, nextScale) {
    stopAnimation();
    if (reduceMotion.matches) {
      setTransform(nextTx, nextTy, nextScale);
      return;
    }
    const from = { tx, ty, scale };
    const start = performance.now();
    const duration = 240;
    const easing = (t) => 1 - (1 - t) ** 3;
    const frame = (now) => {
      const t = Math.min((now - start) / duration, 1);
      const k = easing(t);
      setTransform(
        from.tx + (nextTx - from.tx) * k,
        from.ty + (nextTy - from.ty) * k,
        from.scale + (nextScale - from.scale) * k,
      );
      animation = t < 1 ? requestAnimationFrame(frame) : null;
    };
    animation = requestAnimationFrame(frame);
  }

  function toWorld(screenX, screenY) {
    return { x: (screenX - tx) / scale, y: (screenY - ty) / scale };
  }

  return {
    get scale() { return scale; },
    zoomIn() { zoomAt(canvas.clientWidth / 2, canvas.clientHeight / 2, 1.35); },
    zoomOut() { zoomAt(canvas.clientWidth / 2, canvas.clientHeight / 2, 1 / 1.35); },
    toWorld,
    worldCenter() { return toWorld(canvas.clientWidth / 2, canvas.clientHeight / 2); },

    // bounds: { minX, minY, maxX, maxY } in world coordinates.
    // animate: false jumps immediately — used on load, where there is no
    // meaningful prior view to ease from.
    fit(bounds, { pad = 48, animate = true } = {}) {
      // a hidden or collapsing tab reports a zero-size canvas; fitting against
      // it would park the graph at the origin — skip and let the next Fit win
      if (canvas.clientWidth === 0 || canvas.clientHeight === 0) return;
      const w = bounds.maxX - bounds.minX;
      const h = bounds.maxY - bounds.minY;
      if (w <= 0 || h <= 0) {
        setTransform(canvas.clientWidth / 2, canvas.clientHeight / 2, 1);
        return;
      }
      const s = Math.min(
        (canvas.clientWidth - pad * 2) / w,
        (canvas.clientHeight - pad * 2) / h,
        1.1,
      );
      const clamped = Math.min(SCALE_MAX, Math.max(SCALE_MIN, s));
      const go = animate ? animateTo : setTransform;
      go(
        (canvas.clientWidth - w * clamped) / 2 - bounds.minX * clamped,
        (canvas.clientHeight - h * clamped) / 2 - bounds.minY * clamped,
        clamped,
      );
    },

    centerOn(worldX, worldY) {
      animateTo(
        canvas.clientWidth / 2 - worldX * scale,
        canvas.clientHeight / 2 - worldY * scale,
        scale,
      );
    },
  };
}
