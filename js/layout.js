// Force-directed layout with no dependencies and no randomness: nodes start
// on a golden-angle spiral (deterministic, well spread), then pairwise
// repulsion, springs along edges, soft rectangle-ish collision and a weak
// centring pull settle them. The caller chooses whether to animate the
// settling (step a few ticks per frame) or run it to completion synchronously
// for prefers-reduced-motion.

const GOLDEN_ANGLE = 2.399963229728653;
const SPIRAL_SPACING = 110;
const REPULSION = 32000;
const SPRING = 0.03;
const SPRING_REST = 210;
const COLLIDE_PUSH = 0.25;
const CENTER_PULL = 0.004;
const DAMPING = 0.82;
const ALPHA_DECAY = 0.98;
const ALPHA_MIN = 0.02;
const MAX_SPEED = 30; // per-tick displacement cap: keeps collision spikes from ejecting nodes

// ids: node ids in render order. edges: { from, to } (unknown ids skipped).
// radii: optional Map(id → collision radius) from measured card sizes.
export function createLayout(ids, edges, { radii } = {}) {
  const count = ids.length;
  const index = new Map(ids.map((id, i) => [id, i]));
  const px = new Float64Array(count);
  const py = new Float64Array(count);
  const vx = new Float64Array(count);
  const vy = new Float64Array(count);
  const radius = new Float64Array(count);

  for (let i = 0; i < count; i++) {
    const angle = i * GOLDEN_ANGLE;
    const r = SPIRAL_SPACING * Math.sqrt(i + 0.5);
    px[i] = Math.cos(angle) * r;
    py[i] = Math.sin(angle) * r;
    radius[i] = radii?.get(ids[i]) ?? 70;
  }

  const springs = [];
  for (const edge of edges) {
    const a = index.get(edge.from);
    const b = index.get(edge.to);
    if (a !== undefined && b !== undefined && a !== b) springs.push([a, b]);
  }

  let alpha = count > 1 ? 1 : 0;

  function tick() {
    for (let i = 0; i < count; i++) {
      for (let j = i + 1; j < count; j++) {
        let dx = px[i] - px[j];
        let dy = py[i] - py[j];
        // coincident nodes get a deterministic nudge so forces have a direction
        if (dx === 0 && dy === 0) { dx = (i - j) * 0.11; dy = 0.13; }
        const d2 = Math.max(dx * dx + dy * dy, 64);
        const d = Math.sqrt(d2);
        let f = (REPULSION * alpha) / d2;
        const minGap = radius[i] + radius[j];
        if (d < minGap) f += ((minGap - d) / d) * COLLIDE_PUSH * minGap * alpha;
        const fx = (dx / d) * f;
        const fy = (dy / d) * f;
        vx[i] += fx; vy[i] += fy;
        vx[j] -= fx; vy[j] -= fy;
      }
    }
    for (const [a, b] of springs) {
      const dx = px[b] - px[a];
      const dy = py[b] - py[a];
      const d = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
      const f = SPRING * alpha * (d - SPRING_REST);
      const fx = (dx / d) * f;
      const fy = (dy / d) * f;
      vx[a] += fx; vy[a] += fy;
      vx[b] -= fx; vy[b] -= fy;
    }
    for (let i = 0; i < count; i++) {
      vx[i] -= px[i] * CENTER_PULL * alpha;
      vy[i] -= py[i] * CENTER_PULL * alpha;
      vx[i] *= DAMPING;
      vy[i] *= DAMPING;
      const speed = Math.hypot(vx[i], vy[i]);
      if (speed > MAX_SPEED) {
        vx[i] *= MAX_SPEED / speed;
        vy[i] *= MAX_SPEED / speed;
      }
      px[i] += vx[i];
      py[i] += vy[i];
    }
    alpha *= ALPHA_DECAY;
    if (alpha < ALPHA_MIN) alpha = 0;
  }

  return {
    get running() {
      return alpha > 0;
    },
    step(ticks = 1) {
      for (let t = 0; t < ticks && alpha > 0; t++) tick();
      return alpha > 0;
    },
    settle() {
      let guard = 2000;
      while (alpha > 0 && guard-- > 0) tick();
    },
    positions() {
      const out = new Map();
      ids.forEach((id, i) => out.set(id, { x: px[i], y: py[i] }));
      return out;
    },
  };
}
