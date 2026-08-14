// Force-directed layout with no dependencies and no randomness: nodes start
// on a golden-angle spiral (deterministic, well spread), then pairwise
// repulsion, springs along edges, soft collision and a weak centring pull
// settle them. settle() runs to completion synchronously — the same graph
// always produces the same arrangement.

const GOLDEN_ANGLE = 2.399963229728653;
const SPIRAL_SPACING = 130;
const REPULSION = 52000;
const SPRING = 0.03;
const SPRING_REST = 280; // > two card radii, so connected cards never overlap
const COLLIDE_PUSH = 0.35;
const CENTER_PULL = 0.0025;
const DAMPING = 0.82;
const ALPHA_DECAY = 0.98;
const ALPHA_MIN = 0.02;
const MAX_SPEED = 30; // per-tick displacement cap: keeps collision spikes from ejecting nodes

// ids: node ids in render order. edges: { from, to } (unknown ids skipped).
// radii: optional Map(id → collision radius) from measured card sizes.
// sizes: optional Map(id → {w, h}) enabling the exact de-overlap pass —
// the forces spread the graph, but only rectangle separation can guarantee
// that no two cards overlap once the simulation cools.
export function createLayout(ids, edges, { radii, sizes } = {}) {
  const count = ids.length;
  const index = new Map(ids.map((id, i) => [id, i]));
  const px = new Float64Array(count);
  const py = new Float64Array(count);
  const vx = new Float64Array(count);
  const vy = new Float64Array(count);
  const radius = new Float64Array(count);
  const halfW = new Float64Array(count);
  const halfH = new Float64Array(count);

  for (let i = 0; i < count; i++) {
    const angle = i * GOLDEN_ANGLE;
    const r = SPIRAL_SPACING * Math.sqrt(i + 0.5);
    px[i] = Math.cos(angle) * r;
    py[i] = Math.sin(angle) * r;
    radius[i] = radii?.get(ids[i]) ?? 70;
    const size = sizes?.get(ids[i]);
    halfW[i] = (size?.w ?? radius[i] * 2) / 2;
    halfH[i] = (size?.h ?? radius[i]) / 2;
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

  // Exact de-overlap: repeatedly push the members of each overlapping card
  // pair apart along the axis of least overlap, until no pair overlaps or the
  // iteration cap is hit. Runs after the forces have settled, so it only nudges
  // a locally-crowded arrangement rather than fighting the springs.
  const OVERLAP_PAD = 14;
  function resolveOverlaps() {
    for (let iter = 0; iter < 300; iter++) {
      let moved = false;
      for (let i = 0; i < count; i++) {
        for (let j = i + 1; j < count; j++) {
          let dx = px[j] - px[i];
          let dy = py[j] - py[i];
          if (dx === 0 && dy === 0) { dx = (i - j) * 0.17; dy = 0.19; }
          const overlapX = halfW[i] + halfW[j] + OVERLAP_PAD - Math.abs(dx);
          const overlapY = halfH[i] + halfH[j] + OVERLAP_PAD - Math.abs(dy);
          if (overlapX <= 0 || overlapY <= 0) continue;
          moved = true;
          if (overlapX < overlapY) {
            const shift = (dx >= 0 ? 1 : -1) * (overlapX / 2 + 0.5);
            px[i] -= shift;
            px[j] += shift;
          } else {
            const shift = (dy >= 0 ? 1 : -1) * (overlapY / 2 + 0.5);
            py[i] -= shift;
            py[j] += shift;
          }
        }
      }
      if (!moved) break;
    }
  }

  return {
    settle() {
      let guard = 2000;
      while (alpha > 0 && guard-- > 0) tick();
      resolveOverlaps();
    },
    positions() {
      const out = new Map();
      ids.forEach((id, i) => out.set(id, { x: px[i], y: py[i] }));
      return out;
    },
  };
}
