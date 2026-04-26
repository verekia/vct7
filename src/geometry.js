export function dist(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

export function fmt(n) {
  return Number.isFinite(n) ? +n.toFixed(3) : 0;
}

function normalizeAngle(a) {
  return ((a % 360) + 360) % 360;
}

// Snap `to` along a ray from `from` at the nearest allowed angle (degrees).
// Returns { x, y, angle } projected so its length is the perpendicular foot.
export function snapToAngle(from, to, angles) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy);
  if (!angles || angles.length === 0 || len < 0.0001) {
    return { x: to.x, y: to.y, angle: null };
  }
  const cur = normalizeAngle((Math.atan2(dy, dx) * 180) / Math.PI);
  let bestAngle = null;
  let bestDiff = Infinity;
  for (const a of angles) {
    const an = normalizeAngle(a);
    const raw = Math.abs(an - cur);
    const diff = Math.min(raw, 360 - raw);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestAngle = an;
    }
  }
  const rad = (bestAngle * Math.PI) / 180;
  // Perpendicular foot of `to` on the ray (always non-negative length here).
  const projLen = len * Math.cos((bestDiff * Math.PI) / 180);
  return {
    x: from.x + projLen * Math.cos(rad),
    y: from.y + projLen * Math.sin(rad),
    angle: bestAngle,
  };
}

// Render polyline points to an SVG path `d` attribute, with rounded corners
// controlled by `bezier` ∈ [0, 1]. 0 = straight line corners; 1 = max round.
export function pointsToPath(points, closed, bezier) {
  if (!points || points.length === 0) return "";
  if (points.length === 1) {
    const [x, y] = points[0];
    return `M ${fmt(x)} ${fmt(y)}`;
  }

  const t = Math.max(0, Math.min(1, bezier || 0));
  const n = points.length;

  if (t <= 0) {
    let d = `M ${fmt(points[0][0])} ${fmt(points[0][1])}`;
    for (let i = 1; i < n; i++) {
      d += ` L ${fmt(points[i][0])} ${fmt(points[i][1])}`;
    }
    if (closed) d += " Z";
    return d;
  }

  function corner(prev, cur, next) {
    const inDx = cur[0] - prev[0];
    const inDy = cur[1] - prev[1];
    const inLen = Math.hypot(inDx, inDy) || 1;
    const outDx = next[0] - cur[0];
    const outDy = next[1] - cur[1];
    const outLen = Math.hypot(outDx, outDy) || 1;
    const r = t * 0.5 * Math.min(inLen, outLen);
    return {
      a: [cur[0] - (inDx / inLen) * r, cur[1] - (inDy / inLen) * r],
      b: [cur[0] + (outDx / outLen) * r, cur[1] + (outDy / outLen) * r],
    };
  }

  if (closed && n >= 3) {
    const corners = [];
    for (let i = 0; i < n; i++) {
      corners.push(
        corner(points[(i - 1 + n) % n], points[i], points[(i + 1) % n]),
      );
    }
    let d = `M ${fmt(corners[0].b[0])} ${fmt(corners[0].b[1])}`;
    for (let i = 1; i < n; i++) {
      d += ` L ${fmt(corners[i].a[0])} ${fmt(corners[i].a[1])}`;
      d += ` Q ${fmt(points[i][0])} ${fmt(points[i][1])} ${fmt(corners[i].b[0])} ${fmt(corners[i].b[1])}`;
    }
    d += ` L ${fmt(corners[0].a[0])} ${fmt(corners[0].a[1])}`;
    d += ` Q ${fmt(points[0][0])} ${fmt(points[0][1])} ${fmt(corners[0].b[0])} ${fmt(corners[0].b[1])}`;
    d += " Z";
    return d;
  }

  // Open polyline: leave first/last endpoints sharp, round interior vertices.
  let d = `M ${fmt(points[0][0])} ${fmt(points[0][1])}`;
  for (let i = 1; i < n - 1; i++) {
    const c = corner(points[i - 1], points[i], points[i + 1]);
    d += ` L ${fmt(c.a[0])} ${fmt(c.a[1])}`;
    d += ` Q ${fmt(points[i][0])} ${fmt(points[i][1])} ${fmt(c.b[0])} ${fmt(c.b[1])}`;
  }
  d += ` L ${fmt(points[n - 1][0])} ${fmt(points[n - 1][1])}`;
  if (closed) d += " Z";
  return d;
}

// Bounding box of polyline points.
export function bbox(points) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of points) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}
