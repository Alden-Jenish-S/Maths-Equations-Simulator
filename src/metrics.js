const EPSILON = 1e-12;
const ANALYSIS_GRID_SIZES = Object.freeze([8, 12, 16, 24, 32, 48]);
const MAX_TAIL_POINTS = 12000;
// Reject unsupported numerical geometry explicitly rather than dropping its
// points and scoring a benign remainder. This is well below overflow in any
// squared/fourth-order intermediate used below.
const GEOMETRY_LIMIT = 1e6;

const clamp = (value, min = 0, max = 1) => {
  if (!Number.isFinite(value)) return value === Infinity ? max : min;
  return Math.max(min, Math.min(max, value));
};
const finiteOr = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const ratio = (value) => clamp(finiteOr(value));
const safeNumber = (value) => {
  try {
    return Number(value);
  } catch {
    return NaN;
  }
};

function mean(values) {
  const finite = values.filter(Number.isFinite);
  if (!finite.length) return 0;
  const scale = finite.reduce((largest, value) => Math.max(largest, Math.abs(value)), 0);
  if (!scale) return 0;
  const scaledMean = finite.reduce((sum, value) => sum + value / scale, 0) / finite.length;
  return finiteOr(scale * scaledMean);
}

function median(values) {
  const ordered = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!ordered.length) return 0;
  const middle = Math.floor(ordered.length / 2);
  if (ordered.length % 2) return ordered[middle];
  return finiteOr(ordered[middle - 1] / 2 + ordered[middle] / 2);
}

function percentile(values, p) {
  const ordered = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!ordered.length) return 0;
  return ordered[Math.min(ordered.length - 1, Math.floor((ordered.length - 1) * clamp(p)))];
}

const band = (value, centre, width) => {
  if (!Number.isFinite(value) || !Number.isFinite(centre) || !Number.isFinite(width) || width <= 0) return 0;
  const normalized = (value - centre) / width;
  return finiteOr(Math.exp(-0.5 * normalized * normalized));
};

function distance(a, b) {
  return finiteOr(Math.hypot(a[0] - b[0], a[1] - b[1]), Number.MAX_VALUE);
}

function validateScale(scale) {
  if (!Array.isArray(scale) || scale.length !== 2) return { valid: false, reason: "coordinate-scale-shape" };
  const [sx, sy] = scale;
  if (!Number.isFinite(sx) || !Number.isFinite(sy) || sx <= 0 || sy <= 0) {
    return { valid: false, reason: "coordinate-scale-positive-finite" };
  }
  return { valid: true, value: [sx, sy] };
}

function normalizePoints(points, coordinateScale) {
  const [sx, sy] = coordinateScale;
  let overflow = false;
  let unsafeGeometry = false;
  const normalized = points.map(([x, y]) => {
    const nx = x / sx;
    const ny = y / sy;
    if (!Number.isFinite(nx) || !Number.isFinite(ny)) overflow = true;
    if (Math.abs(nx) > GEOMETRY_LIMIT || Math.abs(ny) > GEOMETRY_LIMIT) unsafeGeometry = true;
    return [
      Number.isFinite(nx) ? nx : Math.sign(x || 1) * Number.MAX_VALUE,
      Number.isFinite(ny) ? ny : Math.sign(y || 1) * Number.MAX_VALUE,
    ];
  });
  return { points: normalized, overflow, unsafeGeometry };
}

function gridFor(points, gridSize = 24) {
  const counts = new Float64Array(gridSize * gridSize);
  let valid = 0;
  for (const [x, y] of points) {
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < -1 || x > 1 || y < -1 || y > 1) continue;
    const ix = Math.min(gridSize - 1, Math.max(0, Math.floor(((x + 1) * gridSize) / 2)));
    const iy = Math.min(gridSize - 1, Math.max(0, Math.floor(((y + 1) * gridSize) / 2)));
    counts[iy * gridSize + ix] += 1;
    valid += 1;
  }
  return { counts, valid };
}

function entropyFromCounts(counts) {
  const total = counts.reduce((sum, value) => sum + value, 0);
  if (!Number.isFinite(total) || total <= 0) return 0;
  let entropy = 0;
  for (const count of counts) {
    if (count <= 0) continue;
    const p = count / total;
    entropy -= p * Math.log(p);
  }
  return ratio(entropy / Math.log(Math.max(2, counts.length)));
}

function occupancyFromCounts(counts) {
  return ratio(counts.reduce((total, value) => total + (value > 0 ? 1 : 0), 0) / counts.length);
}

function jsDivergence(a, b) {
  const totalA = a.reduce((sum, value) => sum + value, 0);
  const totalB = b.reduce((sum, value) => sum + value, 0);
  if (!Number.isFinite(totalA) || !Number.isFinite(totalB) || totalA <= 0 || totalB <= 0) return 0;
  let divergence = 0;
  for (let i = 0; i < a.length; i += 1) {
    const p = a[i] / totalA;
    const q = b[i] / totalB;
    const m = (p + q) / 2;
    if (p > 0 && m > 0) divergence += 0.5 * p * Math.log(p / m);
    if (q > 0 && m > 0) divergence += 0.5 * q * Math.log(q / m);
  }
  return ratio(divergence / Math.log(2));
}

function transformedGrid(counts, gridSize, transform) {
  const result = new Float64Array(counts.length);
  for (let iy = 0; iy < gridSize; iy += 1) {
    for (let ix = 0; ix < gridSize; ix += 1) {
      const [tx, ty] = transform(ix, iy, gridSize);
      if (tx >= 0 && tx < gridSize && ty >= 0 && ty < gridSize) {
        result[ty * gridSize + tx] = counts[iy * gridSize + ix];
      }
    }
  }
  return result;
}

function symmetryScore(counts, gridSize) {
  const total = counts.reduce((sum, value) => sum + value, 0);
  if (!total) return 0;
  const transforms = [
    (x, y, g) => [g - 1 - x, y],
    (x, y, g) => [x, g - 1 - y],
    (x, y, g) => [g - 1 - x, g - 1 - y],
  ];
  return ratio(mean(transforms.map((transform) => 1 - jsDivergence(counts, transformedGrid(counts, gridSize, transform)))));
}

function componentMetrics(counts, gridSize) {
  const occupied = new Uint8Array(counts.length);
  let occupiedCount = 0;
  for (let i = 0; i < counts.length; i += 1) {
    if (counts[i] > 0) {
      occupied[i] = 1;
      occupiedCount += 1;
    }
  }
  const seen = new Uint8Array(counts.length);
  let largest = 0;
  let largestPerimeter = 0;
  const directions = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (let start = 0; start < occupied.length; start += 1) {
    if (!occupied[start] || seen[start]) continue;
    const queue = [start];
    seen[start] = 1;
    let size = 0;
    let perimeter = 0;
    while (queue.length) {
      const index = queue.pop();
      const x = index % gridSize;
      const y = Math.floor(index / gridSize);
      size += 1;
      for (const [dx, dy] of directions) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || nx >= gridSize || ny < 0 || ny >= gridSize) {
          perimeter += 1;
          continue;
        }
        const neighbor = ny * gridSize + nx;
        if (!occupied[neighbor]) perimeter += 1;
        else if (!seen[neighbor]) {
          seen[neighbor] = 1;
          queue.push(neighbor);
        }
      }
    }
    if (size > largest) {
      largest = size;
      largestPerimeter = perimeter;
    }
  }
  const compactness = largestPerimeter ? ratio((4 * Math.PI * largest) / (largestPerimeter * largestPerimeter)) : 0;
  return {
    occupiedCount,
    largestComponentRatio: ratio(occupiedCount ? largest / occupiedCount : 0),
    compactness,
  };
}

/**
 * Compute the grid spectrum with two one-dimensional transforms. The former
 * implementation evaluated every (u,v,x,y) tuple, O(n^4); this separable
 * version is O(n^3) and keeps the same normalized diagnostics.
 */
export function spectralMetrics(counts, gridSize) {
  const n = gridSize;
  if (!Number.isInteger(n) || n < 2 || !counts || counts.length !== n * n) {
    return { spectralEntropy: 0, top4Share: 0, highFrequencyShare: 0, radialBandCoverage: 0, structure: 0 };
  }
  const cos = Array.from({ length: n }, () => new Float64Array(n));
  const sin = Array.from({ length: n }, () => new Float64Array(n));
  for (let k = 0; k < n; k += 1) {
    for (let index = 0; index < n; index += 1) {
      const angle = (2 * Math.PI * k * index) / n;
      cos[k][index] = Math.cos(angle);
      sin[k][index] = Math.sin(angle);
    }
  }

  const rowReal = new Float64Array(n * n);
  const rowImaginary = new Float64Array(n * n);
  for (let y = 0; y < n; y += 1) {
    for (let u = 0; u < n; u += 1) {
      let real = 0;
      let imaginary = 0;
      for (let x = 0; x < n; x += 1) {
        const value = finiteOr(counts[y * n + x]);
        real += value * cos[u][x];
        imaginary -= value * sin[u][x];
      }
      rowReal[y * n + u] = finiteOr(real);
      rowImaginary[y * n + u] = finiteOr(imaginary);
    }
  }

  const powers = [];
  for (let u = 0; u < n; u += 1) {
    for (let v = 0; v < n; v += 1) {
      if (u === 0 && v === 0) continue;
      let real = 0;
      let imaginary = 0;
      for (let y = 0; y < n; y += 1) {
        const rowIndex = y * n + u;
        const rowR = rowReal[rowIndex];
        const rowI = rowImaginary[rowIndex];
        real += rowR * cos[v][y] + rowI * sin[v][y];
        imaginary += rowI * cos[v][y] - rowR * sin[v][y];
      }
      const safeReal = finiteOr(real);
      const safeImaginary = finiteOr(imaginary);
      const power = finiteOr(safeReal * safeReal + safeImaginary * safeImaginary);
      const radius = Math.hypot(u <= n / 2 ? u : n - u, v <= n / 2 ? v : n - v);
      powers.push({ power, radius: finiteOr(radius) });
    }
  }
  const totalPower = powers.reduce((sum, item) => sum + item.power, 0);
  if (!Number.isFinite(totalPower) || totalPower <= EPSILON) {
    return { spectralEntropy: 0, top4Share: 0, highFrequencyShare: 0, radialBandCoverage: 0, structure: 0 };
  }
  powers.sort((a, b) => b.power - a.power);
  const probabilities = powers.map((item) => ratio(item.power / totalPower));
  const spectralEntropy = ratio(-probabilities.reduce((sum, p) => sum + (p > 0 ? p * Math.log(p) : 0), 0) / Math.log(probabilities.length));
  const top4Share = ratio(probabilities.slice(0, 4).reduce((sum, p) => sum + p, 0));
  const maxRadius = Math.hypot(n / 2, n / 2);
  const highFrequencyShare = ratio(powers
    .filter((item) => item.radius > maxRadius * 0.65)
    .reduce((sum, item) => sum + item.power, 0) / totalPower);
  const bands = 6;
  const bandEnergy = Array.from({ length: bands }, () => 0);
  for (const item of powers) {
    const bandIndex = Math.min(bands - 1, Math.floor((item.radius / maxRadius) * bands));
    bandEnergy[bandIndex] += item.power / totalPower;
  }
  const radialBandCoverage = ratio(bandEnergy.filter((energy) => energy >= 0.035).length / bands);
  const structure = ratio(top4Share * radialBandCoverage * band(highFrequencyShare, 0.18, 0.18));
  return { spectralEntropy, top4Share, highFrequencyShare, radialBandCoverage, structure };
}

function covarianceMetrics(points) {
  if (!points.length) return { eigenMax: 0, eigenMin: 0, trace: 0, lineCollapse: 0 };
  const cx = mean(points.map((point) => point[0]));
  const cy = mean(points.map((point) => point[1]));
  let xx = 0;
  let xy = 0;
  let yy = 0;
  for (const [x, y] of points) {
    const dx = x - cx;
    const dy = y - cy;
    xx += dx * dx;
    xy += dx * dy;
    yy += dy * dy;
  }
  xx = finiteOr(xx / points.length);
  xy = finiteOr(xy / points.length);
  yy = finiteOr(yy / points.length);
  const trace = finiteOr(xx + yy);
  const delta = xx - yy;
  const discriminant = finiteOr(Math.sqrt(Math.max(0, delta * delta + 4 * xy * xy)));
  const eigenMax = finiteOr((trace + discriminant) / 2);
  const eigenMin = finiteOr(Math.max(0, (trace - discriminant) / 2));
  return { eigenMax, eigenMin, trace, lineCollapse: eigenMax <= EPSILON ? 1 : ratio(1 - eigenMin / (eigenMax + EPSILON)) };
}

function periodicMetrics(points, maxPeriod = 64) {
  if (points.length < 16) return { periodicity: 0, bestPeriod: null, medianStep: 0 };
  const diagonal = Math.sqrt(8);
  const steps = [];
  for (let i = 1; i < points.length; i += 1) steps.push(distance(points[i], points[i - 1]));
  const medianStep = finiteOr(median(steps));
  const activity = ratio(1 - Math.exp(-Math.min(Number.MAX_SAFE_INTEGER, medianStep) / (0.02 * diagonal)));
  let best = { score: 0, period: null };
  const safeMaxPeriod = Number.isFinite(maxPeriod) ? Math.max(2, Math.min(128, Math.floor(maxPeriod))) : 64;
  const limit = Math.min(safeMaxPeriod, Math.floor(points.length / 8));
  for (let lag = 2; lag <= limit; lag += 1) {
    const errors = [];
    let close = 0;
    for (let i = lag; i < points.length; i += 1) {
      const error = finiteOr(distance(points[i], points[i - lag]) / diagonal, Number.MAX_VALUE);
      errors.push(error);
      if (error <= 0.04) close += 1;
    }
    const error = median(errors);
    const support = ratio(close / Math.max(1, errors.length));
    const coverage = ratio((points.length - lag) / (8 * lag));
    const score = ratio((1 - clamp(error, 0, 1)) * Math.sqrt(support) * coverage * activity);
    if (score > best.score) best = { score, period: lag };
  }
  return { periodicity: ratio(best.score), bestPeriod: best.period, medianStep };
}

function blockDrift(points) {
  if (points.length < 32) return 1;
  const blocks = [];
  const blockSize = Math.max(1, Math.floor(points.length / 4));
  for (let block = 0; block < 4; block += 1) {
    const slice = points.slice(block * blockSize, block === 3 ? points.length : (block + 1) * blockSize);
    blocks.push([mean(slice.map((point) => point[0])), mean(slice.map((point) => point[1]))]);
  }
  const reference = blocks[3];
  const distances = blocks.slice(0, 3).map((point) => distance(point, reference) / Math.sqrt(8));
  return ratio(median(distances));
}

function radialMetrics(points) {
  if (points.length < 16) return { ring: 0, radius: 0, radialUniformity: 0, angularCoverage: 0 };
  const cx = mean(points.map((point) => point[0]));
  const cy = mean(points.map((point) => point[1]));
  const radii = points.map(([x, y]) => Math.hypot(x - cx, y - cy)).filter(Number.isFinite);
  const radius = finiteOr(mean(radii));
  if (radius <= 0.02) return { ring: 0, radius, radialUniformity: 0, angularCoverage: 0 };
  const radialDeviation = Math.sqrt(mean(radii.map((value) => {
    const delta = value - radius;
    return delta * delta;
  })));
  const radialRelativeDeviation = (radialDeviation / Math.max(radius, EPSILON)) / 0.18;
  const radialUniformity = ratio(Math.exp(-radialRelativeDeviation * radialRelativeDeviation));
  const bins = new Uint8Array(24);
  for (const [x, y] of points) {
    const angle = Math.atan2(y - cy, x - cx);
    const index = Math.min(23, Math.max(0, Math.floor(((angle + Math.PI) * 24) / (2 * Math.PI))));
    bins[index] = 1;
  }
  const angularCoverage = ratio(bins.reduce((sum, value) => sum + value, 0) / 18);
  const radiusActivity = ratio(radius / 0.12);
  return { ring: ratio(radialUniformity * angularCoverage * radiusActivity), radius, radialUniformity, angularCoverage };
}

function scaleConsistency(occupancies, pointCount) {
  if (pointCount < 32) return 0;
  const average = mean(occupancies);
  const deviation = Math.sqrt(mean(occupancies.map((value) => {
    const delta = value - average;
    return delta * delta;
  })));
  return ratio(1 - deviation / 0.25);
}

function growthMetrics(points) {
  if (points.length < 32) return { growthRisk: 0, blockRadii: [] };
  const blockSize = Math.max(1, Math.floor(points.length / 4));
  const blockRadii = [];
  for (let block = 0; block < 4; block += 1) {
    const start = block * blockSize;
    const end = block === 3 ? points.length : (block + 1) * blockSize;
    blockRadii.push(percentile(points.slice(start, end).map(([x, y]) => Math.max(Math.abs(x), Math.abs(y))), 0.9));
  }
  const first = Math.max(blockRadii[0], 0.02);
  const last = blockRadii[blockRadii.length - 1];
  // Require net growth as well as a rising trend; a stationary oscillation
  // with one upward block transition is not evidence of continuing growth.
  const endpointGrowth = ratio((last / first - 1.1) / 2.5);
  const risingSteps = blockRadii.slice(1).filter((value, index) => value > blockRadii[index] * 1.02).length / 3;
  return { growthRisk: ratio(endpointGrowth * risingSteps), blockRadii };
}

function tailCollapseMetrics(points) {
  if (points.length < 96) return { tailCollapse: 0, tailFixedCollapse: 0, tailLineCollapse: 0, tailVariance: 0 };
  const window = Math.max(32, Math.min(512, Math.floor(points.length / 4)));
  const prefix = points.slice(0, window);
  const suffix = points.slice(-window);
  const prefixCovariance = covarianceMetrics(prefix);
  const suffixCovariance = covarianceMetrics(suffix);
  const prefixVariance = prefixCovariance.trace;
  const suffixVariance = suffixCovariance.trace;
  const prefixActivity = ratio(prefixVariance / 0.01);
  const tailFixedCollapse = ratio(Math.exp(-suffixVariance / 0.002));
  const tailLineCollapse = ratio((suffixCovariance.lineCollapse - 0.97) / 0.03);
  const newLineCollapse = tailLineCollapse * ratio((0.99 - prefixCovariance.lineCollapse) / 0.05);
  return {
    tailCollapse: ratio(prefixActivity * Math.max(tailFixedCollapse, newLineCollapse)),
    tailFixedCollapse,
    tailLineCollapse,
    tailVariance: suffixVariance,
  };
}

// Cross-time nearest-neighbour successor skill. Spatially uniform or rescaled
// IID clouds have no predictive skill even if their density looks attractive.
// Adjacent samples are excluded; candidates and queries are bounded and chosen
// deterministically. This is a noise proxy, not a test of determinism/chaos.
function predictionMetrics(points, variance) {
  if (points.length < 512 || variance <= EPSILON) return { predictionSkill: 0, noiseRisk: 0 };
  const transitionCount = points.length - 1;
  const candidateCount = Math.min(2048, transitionCount);
  const queryCount = Math.min(256, transitionCount);
  let errorSum = 0;
  let matched = 0;
  for (let query = 0; query < queryCount; query += 1) {
    const index = Math.floor(query * transitionCount / queryCount);
    let nearest = -1;
    let bestDistance = Infinity;
    for (let candidate = 0; candidate < candidateCount; candidate += 1) {
      const other = Math.floor(candidate * transitionCount / candidateCount);
      if (Math.abs(other - index) <= 8) continue;
      const dx = points[index][0] - points[other][0];
      const dy = points[index][1] - points[other][1];
      const squaredDistance = dx * dx + dy * dy;
      if (squaredDistance < bestDistance) {
        bestDistance = squaredDistance;
        nearest = other;
      }
    }
    if (nearest < 0) continue;
    const dx = points[index + 1][0] - points[nearest + 1][0];
    const dy = points[index + 1][1] - points[nearest + 1][1];
    errorSum += dx * dx + dy * dy;
    matched += 1;
  }
  const predictionSkill = ratio(1 - errorSum / Math.max(1, matched) / variance);
  return { predictionSkill, noiseRisk: ratio((0.35 - predictionSkill) / 0.35) };
}

function targetUtility(metrics) {
  return {
    occupancy: band(metrics.occupancy, 0.3, 0.25),
    entropy: band(metrics.entropy, 0.62, 0.25),
    periodicity: band(metrics.periodicity, 0.45, 0.35),
    symmetry: band(metrics.symmetry, 0.55, 0.35),
    spectrum: band(metrics.spectrumStructure, 0.42, 0.3),
    scale: band(metrics.scaleConsistency, 0.75, 0.25),
    order: band(metrics.orderCoherence, 0.5, 0.35),
  };
}

function metadataDiverges(metadata) {
  if (!metadata || typeof metadata !== "object") return false;
  return metadata.diverged === true
    || metadata.divergent === true
    || metadata.divergenceDetected === true
    || metadata.divergence === true
    || metadata.finite === false
    || metadata.bounded === false
    || metadata.clipApplied === true
    || metadata.status === "divergent"
    || metadata.status === "diverged"
    || (metadata.divergedAt !== null && metadata.divergedAt !== undefined)
    || (Array.isArray(metadata.finalState) && !metadata.finalState.every(Number.isFinite));
}

function invalidResult({ requestedCount, finiteRatio, hardEscapeRatio, tailCount, reason }) {
  const zeroScales = ANALYSIS_GRID_SIZES.map(() => 0);
  return {
    finiteRatio: ratio(finiteRatio),
    validRatio: 0,
    hardEscapeRatio: ratio(hardEscapeRatio),
    occupancy: 0,
    entropy: 0,
    occupancyByScale: zeroScales,
    entropyByScale: [...zeroScales],
    scaleSizes: [...ANALYSIS_GRID_SIZES],
    periodicity: 0,
    bestPeriod: null,
    symmetry: 0,
    spectrumStructure: 0,
    spectralEntropy: 0,
    top4Share: 0,
    highFrequencyShare: 0,
    radialBandCoverage: 0,
    stability: 0,
    scaleConsistency: 0,
    transientPenalty: 0,
    tailCollapse: 0,
    tailFixedCollapse: 0,
    tailLineCollapse: 0,
    tailVariance: 0,
    collapsePenalty: 0,
    divergencePenalty: 1,
    fixedCollapse: 0,
    lineCollapse: 0,
    circleCollapse: 0,
    largestComponentRatio: 0,
    compactness: 0,
    medianStep: 0,
    orderCoherence: 0,
    tailCount: Math.max(0, Math.floor(finiteOr(tailCount))),
    growthRisk: 0,
    noiseRisk: 0,
    predictionSkill: 0,
    missingRatio: 0,
    requestedCount: Math.max(0, Math.floor(finiteOr(requestedCount))),
    invalidInput: true,
    invalidReason: reason,
    normalizationOverflow: false,
    metadataDivergence: false,
    numericalRangeExceeded: false,
    score: 0,
    structureScore: 0,
    scoreComponents: {
      occupancy: 0, entropy: 0, periodicity: 0, symmetry: 0, spectrum: 0, scale: 0, order: 0,
      stability: 0, transient: 0, collapse: 0, divergence: 0, noise: 0,
    },
    classification: "divergent",
  };
}

export function analyzeTrajectory(points = [], options = {}) {
  const settings = options && typeof options === "object" ? options : {};
  const metadata = settings.metadata && typeof settings.metadata === "object" ? settings.metadata : {};
  const pointContainerValid = Array.isArray(points);
  const sourcePoints = pointContainerValid ? points : [];
  const rawFinite = sourcePoints.filter((point) => Array.isArray(point) && point.length >= 2 && Number.isFinite(point[0]) && Number.isFinite(point[1]));
  const invalidPointCount = sourcePoints.length - rawFinite.length;

  const requestedRaw = settings.requestedCount ?? metadata.requestedCount ?? sourcePoints.length;
  const requestedNumber = safeNumber(requestedRaw);
  const requestedValid = Number.isFinite(requestedNumber) && requestedNumber >= 0 && Number.isInteger(requestedNumber);
  const requestedCount = requestedValid ? Math.floor(requestedNumber) : sourcePoints.length;
  const denominator = Math.max(1, requestedCount, sourcePoints.length);
  const finiteRatio = ratio(rawFinite.length / denominator);
  const missingRatio = ratio(Math.max(0, requestedCount - sourcePoints.length) / denominator);
  const hardRadiusRaw = safeNumber(settings.hardRadius ?? 100);
  const hardRadiusValid = Number.isFinite(hardRadiusRaw) && hardRadiusRaw > 0;
  const hardRadius = hardRadiusValid ? hardRadiusRaw : 100;
  const hardEscapeCount = rawFinite.filter(([x, y]) => Math.max(Math.abs(x), Math.abs(y)) > hardRadius).length;
  const hardEscapeRatio = ratio(hardEscapeCount / denominator);
  const scaleResult = validateScale(settings.coordinateScale === undefined ? [1, 1] : settings.coordinateScale);
  if (!scaleResult.valid) {
    return invalidResult({ requestedCount, finiteRatio, hardEscapeRatio, tailCount: rawFinite.length, reason: scaleResult.reason });
  }
  if (!requestedValid) {
    return invalidResult({ requestedCount, finiteRatio, hardEscapeRatio, tailCount: rawFinite.length, reason: "requested-count" });
  }
  if (!hardRadiusValid) {
    return invalidResult({ requestedCount, finiteRatio, hardEscapeRatio, tailCount: rawFinite.length, reason: "hard-radius" });
  }
  if (!pointContainerValid) {
    return invalidResult({ requestedCount, finiteRatio, hardEscapeRatio, tailCount: rawFinite.length, reason: "points-array" });
  }

  const normalized = normalizePoints(rawFinite, scaleResult.value);
  const normalizedTail = normalized.points.length > MAX_TAIL_POINTS
    ? normalized.points.slice(-MAX_TAIL_POINTS)
    : normalized.points;
  const geometryPoints = normalizedTail.filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y) && Math.abs(x) <= GEOMETRY_LIMIT && Math.abs(y) <= GEOMETRY_LIMIT);
  const gridStats = ANALYSIS_GRID_SIZES.map((gridSize) => gridFor(normalizedTail, gridSize));
  const validRatios = gridStats.map((grid) => ratio(grid.valid / Math.max(1, normalizedTail.length)));
  const occupancyByScale = gridStats.map((grid) => occupancyFromCounts(grid.counts));
  const entropyByScale = gridStats.map((grid) => entropyFromCounts(grid.counts));
  const validRatio = ratio(mean(validRatios));
  const occupancy = ratio(validRatio * mean(occupancyByScale));
  const entropy = ratio(validRatio * mean(entropyByScale));
  const grid = gridStats[3];
  const symmetry = symmetryScore(grid.counts, 24);
  const components = componentMetrics(grid.counts, 24);
  const spectrum = spectralMetrics(grid.counts, 24);
  const covariance = covarianceMetrics(geometryPoints);
  const periodic = periodicMetrics(geometryPoints, settings.maxPeriod ?? 64);
  const rawDrift = blockDrift(geometryPoints);
  const radial = radialMetrics(geometryPoints);
  const growth = growthMetrics(geometryPoints);
  const tailCollapse = tailCollapseMetrics(geometryPoints);
  const scale = scaleConsistency(occupancyByScale, normalizedTail.length);
  const normalizationFailure = normalized.overflow;
  const metadataDivergence = metadataDiverges(metadata);
  const clipApplied = settings.clipApplied === true || metadata.clipApplied === true;
  const incompleteOutput = requestedCount > sourcePoints.length;
  const emptyOutput = sourcePoints.length === 0;
  const dataQualityFailure = invalidPointCount > 0
    || hardEscapeCount > 0
    || normalizationFailure
    || normalized.unsafeGeometry
    || metadataDivergence
    || clipApplied;
  const transientPenalty = ratio(Math.max(rawDrift * (1 - 0.85 * radial.ring), tailCollapse.tailCollapse, growth.growthRisk * 0.8));
  const growthRisk = growth.growthRisk;
  const stability = ratio(validRatio
    * Math.exp(-2 * transientPenalty)
    * (1 - hardEscapeRatio)
    * (1 - growthRisk));
  const orderCoherence = ratio(1 - Math.exp(-Math.min(Number.MAX_SAFE_INTEGER, periodic.medianStep) / 0.15));
  const fixedCollapse = ratio(Math.exp(-covariance.trace / 0.002));
  const filledCircleCollapse = ratio(components.largestComponentRatio
    * band(components.compactness, 0.9, 0.12)
    * band(symmetry, 0.96, 0.08));
  const ringCollapse = radial.ring;
  const circleCollapse = ratio(Math.max(filledCircleCollapse, ringCollapse));
  const purePeriodicCollapse = periodic.periodicity > 0.82 && occupancy < 0.1 && spectrum.structure < 0.25 ? 0.8 : 0;
  const lineCollapse = covariance.lineCollapse;
  // A chaotic attractor can be anisotropic without being a one-dimensional
  // filament. Keep the raw diagnostic, but require near-perfect anisotropy or
  // a very small occupied support before it becomes a dominant score penalty.
  const linePenalty = Math.max(lineCollapse * 0.55, ratio((lineCollapse - 0.97) / 0.03));
  const collapsePenalty = ratio(Math.max(fixedCollapse, linePenalty, circleCollapse, purePeriodicCollapse));
  const divergencePenalty = ratio(dataQualityFailure || incompleteOutput || emptyOutput ? 1 : 0);
  const spatialNoiseRisk = ratio(
    ratio((entropy - 0.75) / 0.2)
    * ratio((occupancy - 0.55) / 0.35)
    * ratio((0.12 - spectrum.structure) / 0.12)
    * ratio((0.35 - periodic.periodicity) / 0.35),
  );
  const prediction = predictionMetrics(geometryPoints, covariance.trace);
  const noiseRisk = Math.max(spatialNoiseRisk, prediction.noiseRisk);
  const shortOutput = sourcePoints.length < 512;
  let invalidReason = null;
  if (invalidPointCount > 0) invalidReason = "non-finite-or-malformed-point";
  else if (hardEscapeCount > 0) invalidReason = "hard-radius-escape";
  else if (normalizationFailure) invalidReason = "normalization-overflow";
  else if (normalized.unsafeGeometry) invalidReason = "numerical-range-exceeded";
  else if (metadataDivergence) invalidReason = "metadata-divergence";
  else if (clipApplied) invalidReason = "clip-applied";
  else if (emptyOutput) invalidReason = "empty-trajectory";
  else if (incompleteOutput) invalidReason = "missing-requested-samples";
  const metrics = {
    finiteRatio,
    validRatio,
    hardEscapeRatio,
    missingRatio,
    occupancy,
    entropy,
    occupancyByScale,
    entropyByScale,
    scaleSizes: [...ANALYSIS_GRID_SIZES],
    periodicity: periodic.periodicity,
    bestPeriod: periodic.bestPeriod,
    symmetry,
    spectrumStructure: spectrum.structure,
    spectralEntropy: spectrum.spectralEntropy,
    top4Share: spectrum.top4Share,
    highFrequencyShare: spectrum.highFrequencyShare,
    radialBandCoverage: spectrum.radialBandCoverage,
    stability,
    scaleConsistency: scale,
    transientPenalty,
    tailCollapse: tailCollapse.tailCollapse,
    tailFixedCollapse: tailCollapse.tailFixedCollapse,
    tailLineCollapse: tailCollapse.tailLineCollapse,
    tailVariance: tailCollapse.tailVariance,
    collapsePenalty,
    divergencePenalty,
    fixedCollapse,
    lineCollapse,
    circleCollapse,
    largestComponentRatio: components.largestComponentRatio,
    compactness: components.compactness,
    medianStep: periodic.medianStep,
    orderCoherence,
    tailCount: normalizedTail.length,
    growthRisk,
    noiseRisk,
    predictionSkill: prediction.predictionSkill,
    requestedCount,
    metadataDivergence,
    invalidInput: false,
    invalidReason,
    normalizationOverflow: normalizationFailure,
    numericalRangeExceeded: normalized.unsafeGeometry,
  };
  const utilities = targetUtility(metrics);
  const structureScore = ratio(0.18 * utilities.occupancy
    + 0.16 * utilities.entropy
    + 0.14 * utilities.periodicity
    + 0.10 * utilities.symmetry
    + 0.20 * utilities.spectrum
    + 0.10 * utilities.scale
    + 0.12 * utilities.order);
  const score = divergencePenalty >= 1 || shortOutput
    ? 0
    : finiteOr(100 * structureScore * stability * (1 - divergencePenalty) * (1 - transientPenalty) * (1 - collapsePenalty) * (1 - 0.55 * noiseRisk));
  let classification = "bounded-low-complexity";
  if (dataQualityFailure || metadataDivergence || hardEscapeCount > 0 || invalidPointCount > 0) classification = "divergent";
  else if (emptyOutput) classification = "divergent";
  else if (incompleteOutput || shortOutput) classification = "transient";
  else if (tailCollapse.tailCollapse > 0.72 || growthRisk > 0.65) classification = "transient";
  else if (fixedCollapse > 0.85 || lineCollapse > 0.97 || circleCollapse > 0.78) classification = "trivial";
  else if (transientPenalty > 0.82) classification = "transient";
  else if (periodic.periodicity > 0.82 && purePeriodicCollapse > 0.5) classification = "periodic-trivial";
  else if (noiseRisk > 0.45) classification = "bounded-low-complexity";
  else if (score >= 35) classification = "structured";

  return {
    ...metrics,
    score: clamp(score, 0, 100),
    structureScore,
    scoreComponents: {
      ...utilities,
      stability,
      transient: ratio(1 - transientPenalty),
      collapse: ratio(1 - collapsePenalty),
      divergence: ratio(1 - divergencePenalty),
      noise: ratio(1 - 0.55 * noiseRisk),
    },
    classification,
  };
}

export function featureVector(metrics) {
  return [
    finiteOr(metrics?.occupancy),
    finiteOr(metrics?.entropy),
    finiteOr(metrics?.periodicity),
    finiteOr(metrics?.symmetry),
    finiteOr(metrics?.spectrumStructure),
    finiteOr(metrics?.stability),
    finiteOr(metrics?.compactness),
    finiteOr(metrics?.scaleConsistency),
    finiteOr(metrics?.spectralEntropy),
    finiteOr(metrics?.transientPenalty),
  ];
}

export function featureDistance(a, b) {
  const left = featureVector(a);
  const right = featureVector(b);
  return finiteOr(Math.sqrt(mean(left.map((value, index) => {
    const delta = value - right[index];
    return delta * delta;
  }))));
}

export function scoreSynthetic(points = [], options = {}) {
  return analyzeTrajectory(points, { coordinateScale: [1, 1], hardRadius: 10, ...options });
}
