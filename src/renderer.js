/** Pure projection and point-budget helpers shared by the browser and benchmarks. */

export function projectRawPoints(rawPoints, projection = "x-y") {
  const axis = projection.split("-").map((name) => ({ x: 0, y: 1, z: 2 }[name]));
  return rawPoints.map((point) => [point[axis[0]] ?? point[0], point[axis[1]] ?? point[1]]);
}

export function computeBounds(points, padding = 0.06) {
  const finite = points.filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
  if (!finite.length) return { minX: -1, maxX: 1, minY: -1, maxY: 1, width: 2, height: 2 };
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [x, y] of finite) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  const rawWidth = Math.max(EPSILON, maxX - minX);
  const rawHeight = Math.max(EPSILON, maxY - minY);
  const pad = Math.max(rawWidth, rawHeight) * padding;
  minX -= pad;
  maxX += pad;
  minY -= pad;
  maxY += pad;
  return { minX, maxX, minY, maxY, width: maxX - minX, height: maxY - minY };
}

const EPSILON = 1e-9;

export function mapToScreen(point, bounds, width, height, margin = 28) {
  const usableWidth = Math.max(1, width - margin * 2);
  const usableHeight = Math.max(1, height - margin * 2);
  const scale = Math.min(usableWidth / bounds.width, usableHeight / bounds.height);
  const offsetX = (width - bounds.width * scale) / 2;
  const offsetY = (height - bounds.height * scale) / 2;
  return [offsetX + (point[0] - bounds.minX) * scale, height - offsetY - (point[1] - bounds.minY) * scale];
}

export function decimateToGrid(points, width, height, maxPoints = 90000) {
  if (points.length <= maxPoints) return points;
  const tileSize = Math.max(1, Math.ceil(Math.sqrt((width * height) / maxPoints)));
  const tiles = new Map();
  const result = [];
  const limitX = Math.max(1, Math.ceil(width / tileSize));
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    if (!Number.isFinite(point[0]) || !Number.isFinite(point[1])) continue;
    const x = Math.max(0, Math.floor(point[0] / tileSize));
    const y = Math.max(0, Math.floor(point[1] / tileSize));
    const key = y * limitX + x;
    if (!tiles.has(key)) {
      tiles.set(key, index);
      result.push(point);
      if (result.length >= maxPoints) break;
    }
  }
  if (points.length) {
    result[0] = points[0];
    if (result.length > 1) result[result.length - 1] = points[points.length - 1];
  }
  return result;
}

export function renderPointCloud(ctx, points, options = {}) {
  const width = options.width ?? ctx.canvas.width;
  const height = options.height ?? ctx.canvas.height;
  const bounds = options.bounds ?? computeBounds(points);
  const margin = options.margin ?? 28;
  const dpr = options.dpr ?? 1;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = options.background ?? "#0d1117";
  ctx.fillRect(0, 0, width, height);
  ctx.save();
  if (options.showGrid !== false) {
    ctx.strokeStyle = options.gridColor ?? "rgba(148, 163, 184, .12)";
    ctx.lineWidth = 1 / dpr;
    for (let i = 1; i < 5; i += 1) {
      const x = (width / 5) * i;
      const y = (height / 5) * i;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }
  }
  if (options.showAxes !== false) {
    ctx.strokeStyle = options.axisColor ?? "rgba(226, 232, 240, .25)";
    ctx.beginPath();
    const originX = bounds.minX <= 0 && bounds.maxX >= 0 ? mapToScreen([0, 0], bounds, width, height, margin)[0] : margin;
    const originY = bounds.minY <= 0 && bounds.maxY >= 0 ? mapToScreen([0, 0], bounds, width, height, margin)[1] : height - margin;
    ctx.moveTo(originX, 0);
    ctx.lineTo(originX, height);
    ctx.moveTo(0, originY);
    ctx.lineTo(width, originY);
    ctx.stroke();
  }
  const screenPoints = points
    .filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y))
    .map((point) => mapToScreen(point, bounds, width, height, margin));
  const visiblePoints = decimateToGrid(screenPoints, width, height, options.maxPoints ?? 90000);
  ctx.fillStyle = options.pointColor ?? "#80e8c7";
  const pointSize = options.pointSize ?? 1.4;
  for (const [x, y] of visiblePoints) {
    ctx.fillRect(x, y, pointSize, pointSize);
  }
  ctx.restore();
  return { bounds, sourceCount: screenPoints.length, renderedCount: visiblePoints.length };
}
