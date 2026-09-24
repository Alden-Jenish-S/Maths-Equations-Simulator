/**
 * DOM-free deterministic renderer, shared by the app and benchmark/export code.
 * renderStudio(ctx, scene, width, height, options) returns
 * {drawn, renderedCount, sourceCount, budget}. Units are CSS pixels; the caller
 * owns the DPR transform. No canvas resize, random numbers, clocks or DOM writes.
 * Scenes: atlas/live {points,bounds,kind,head,motion?}; unwrap {data:{points,bounds,
 * channels:[{name,values,range,poles}],frame,domain,phase,axis,display,osculating}};
 * History values carry timestamps, preview values use normalized domain phase.
 * Atlas motion contains cached {bins,groups,max,label} per raw source.
 * Fourier {data:{epicycle,
 * waveform,phase,extent,domain}}; spirograph {data:{trails,bounds,gear,pens}};
 * pendulum {data:{geometry,params,phase,trail1,trail2}}. Null points break paths.
 */
const TAU = Math.PI * 2;
const finite = Number.isFinite;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const STUDIO_PALETTES = Object.freeze({
  "Neon Cyberpunk": { background: "#080d18", panel: "#111a2b", grid: "#203048", axis: "#48617b", accent: "#58eadb", secondary: "#fa74c5", warm: "#f7cf81", text: "#b5c4d8" },
  "Solar Flare": { background: "#17100f", panel: "#241817", grid: "#432a26", axis: "#875247", accent: "#ffba64", secondary: "#ff697d", warm: "#ffe39b", text: "#efd7c2" },
  "Emerald Matrix": { background: "#07140f", panel: "#0c2119", grid: "#164332", axis: "#32745b", accent: "#69f5aa", secondary: "#d2f36d", warm: "#b8ffdd", text: "#bce7cf" },
  "Deep Space Violet": { background: "#0c091b", panel: "#17122c", grid: "#30255b", axis: "#624d95", accent: "#b69cff", secondary: "#6fe9ff", warm: "#f1c5ff", text: "#d6c9eb" },
  Synthwave: { background: "#12091a", panel: "#21102d", grid: "#492153", axis: "#884071", accent: "#ff62d4", secondary: "#52ddff", warm: "#ffce70", text: "#edc6e5" },
});
export function boundsOf(points = []) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of points) if (p && finite(p[0]) && finite(p[1])) {
    minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]);
    minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]);
  }
  if (!finite(minX)) return { minX: -1, minY: -1, maxX: 1, maxY: 1, width: 2, height: 2 };
  const pad = Math.max(1e-5, Math.max(maxX - minX, maxY - minY) * .09);
  return { minX: minX - pad, maxX: maxX + pad, minY: minY - pad, maxY: maxY + pad, width: maxX - minX + pad * 2, height: maxY - minY + pad * 2 };
}
export function project(point, bounds, width, height, margin = 28) {
  const scale = Math.min(Math.max(1, width - margin * 2) / bounds.width, Math.max(1, height - margin * 2) / bounds.height);
  return [width / 2 + (point[0] - (bounds.minX + bounds.maxX) / 2) * scale, height / 2 - (point[1] - (bounds.minY + bounds.maxY) / 2) * scale];
}
export const projectHelix = (p) => p?.length > 2 ? [p[0] * .82 - p[1] * .48, p[2] + p[0] * .26 + p[1] * .43] : p;
/** Prepare once per raw source; reuse with every 2D projection and palette. */
export function buildMotionBins(points, dt = null, count = 8) {
  count = clamp(Math.round(count) || 8, 2, 16);
  const values = new Float64Array(points.length), bins = new Uint8Array(points.length);
  const groups = Array.from({ length: count }, () => []);
  let max = 0;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1], b = points[i];
    if (!a || !b || a.length !== b.length || !a.every(finite) || !b.every(finite)) continue;
    values[i] = Math.hypot(...b.map((v, j) => v - a[j])) / (dt > 0 ? dt : 1);
    max = Math.max(max, values[i]);
  }
  for (let i = 0; i < points.length; i += 1) {
    bins[i] = max ? Math.min(count - 1, Math.floor(values[i] / max * count)) : 0;
    groups[bins[i]].push(i);
  }
  return { values, bins, groups, max, label: dt > 0 ? "speed ≈ ‖Δr‖/Δt" : "step displacement ‖Δr‖" };
}
const format = (v) => finite(v) ? Math.abs(v) >= 100 ? v.toExponential(1) : Number(v.toFixed(2)).toString() : "—";
function label(ctx, text, x, y, color, size = 9) { ctx.fillStyle = color; ctx.font = `${size}px ui-monospace, SFMono-Regular, Consolas, monospace`; ctx.fillText(text, x, y); }
function line(ctx, a, b, color, width = 1, dash = []) {
  ctx.strokeStyle = color; ctx.lineWidth = width; ctx.setLineDash(dash);
  ctx.beginPath(); ctx.moveTo(...a); ctx.lineTo(...b); ctx.stroke(); ctx.setLineDash([]);
}
function circle(ctx, p, r, color, width = 1) { if (!finite(r) || r < 0) return; ctx.strokeStyle = color; ctx.lineWidth = width; ctx.beginPath(); ctx.arc(...p, r, 0, TAU); ctx.stroke(); }
function spark(ctx, p, color, radius = 3, glow = .5) {
  if (!p?.every(finite)) return;
  ctx.fillStyle = color;
  if (glow > 0) { ctx.globalAlpha = glow * .16; ctx.beginPath(); ctx.arc(...p, radius * 3, 0, TAU); ctx.fill(); }
  ctx.globalAlpha = 1; ctx.beginPath(); ctx.arc(...p, radius, 0, TAU); ctx.fill();
}
function arrow(ctx, a, b, color) {
  if (![...a, ...b].every(finite)) return;
  line(ctx, a, b, color, 1.4);
  const angle = Math.atan2(b[1] - a[1], b[0] - a[0]);
  line(ctx, b, [b[0] - 6 * Math.cos(angle - .45), b[1] - 6 * Math.sin(angle - .45)], color);
  line(ctx, b, [b[0] - 6 * Math.cos(angle + .45), b[1] - 6 * Math.sin(angle + .45)], color);
}
function path(ctx, points, transform, color, opt, alpha = .9, max = opt.remaining, width = 1.25) {
  if (!points?.length || opt.remaining <= 0) return;
  const limit = Math.max(1, Math.min(opt.remaining, max));
  const stride = Math.max(1, Math.ceil(points.length / limit));
  opt.source += points.length;
  let open = false, drawn = 0;
  ctx.beginPath();
  for (let i = 0; i < points.length; i += 1) {
    const point = points[i];
    if (!point || !finite(point[0]) || !finite(point[1])) { open = false; continue; }
    if (i % stride && i !== points.length - 1) continue;
    if (drawn >= limit) break;
    const p = transform(point, i);
    if (!p?.every(finite)) { open = false; continue; }
    if (!open) ctx.moveTo(...p); else ctx.lineTo(...p);
    open = true; drawn += 1;
  }
  ctx.strokeStyle = color;
  if (opt.glow > 0) { ctx.globalAlpha = alpha * .14 * opt.glow; ctx.lineWidth = width + 5 * opt.glow; ctx.stroke(); }
  ctx.globalAlpha = alpha; ctx.lineWidth = width; ctx.stroke(); ctx.globalAlpha = 1;
  opt.drawn += drawn; opt.remaining -= drawn;
}
function grid(ctx, w, h, c, opt) {
  if (opt.showGrid) {
    const step = Math.max(40, Math.round(Math.min(w, h) / 8));
    for (let x = w / 2 % step; x < w; x += step) line(ctx, [x, 0], [x, h], c.grid, .5);
    for (let y = h / 2 % step; y < h; y += step) line(ctx, [0, y], [w, y], c.grid, .5);
  }
}
function axes(ctx, map, rect, c, opt) {
  if (!opt.showAxes) return;
  const p = map([0, 0]);
  if (p[0] > rect.x && p[0] < rect.x + rect.w) line(ctx, [p[0], rect.y], [p[0], rect.y + rect.h], c.axis, .7);
  if (p[1] > rect.y && p[1] < rect.y + rect.h) line(ctx, [rect.x, p[1]], [rect.x + rect.w, p[1]], c.axis, .7);
}
function inRect(rect, bounds, margin = 22) { return (p) => { const q = project(p, bounds, rect.w, rect.h, margin); return [q[0] + rect.x, q[1] + rect.y]; }; }
function clip(ctx, rect) { ctx.save(); ctx.beginPath(); ctx.rect(rect.x, rect.y, rect.w, rect.h); ctx.clip(); }
function split(w, h, fraction = .5) {
  if (w < 580) return [{ x: 18, y: 38, w: w - 36, h: h * .36 - 38 }, { x: 24, y: h * .46, w: w - 48, h: h * .5 }];
  return [{ x: 18, y: 40, w: w * fraction - 40, h: h - 75 }, { x: w * fraction + 10, y: 40, w: w * (1 - fraction) - 35, h: h - 75 }];
}
const ramps = new Map();
function motionRamp(c, count) {
  const key = `${c.accent}:${c.secondary}:${c.warm}:${count}`;
  if (!ramps.has(key)) {
    const rgb = (hex) => hex.match(/[a-f0-9]{2}/gi).map((v) => parseInt(v, 16));
    const stops = [rgb(c.secondary), rgb(c.accent), rgb(c.warm)];
    ramps.set(key, Array.from({ length: count }, (_, i) => {
      const t = i / Math.max(1, count - 1) * 2, index = Math.min(1, Math.floor(t));
      return `rgb(${stops[index].map((v, j) => Math.round(v + (stops[index + 1][j] - v) * (t - index))).join(",")})`;
    }));
  }
  return ramps.get(key);
}
// Exact N/κ in source coordinates. The renderer alone applies a screen-length
// cap. At κ=0 the radius is undefined/infinite, not a zero-length circle.
export function curvatureGeometry(frame) {
  if (!(frame?.curvature > 1e-12) || !(frame.speed > 1e-12)) return null;
  const radius = 1 / frame.curvature;
  const vector = frame.normal.map((v) => v * radius);
  return { radius, vector, center: frame.point.map((v, i) => v + vector[i]) };
}
function renderAtlas(ctx, scene, w, h, c, opt) {
  const points = scene.points ?? [], bounds = scene.bounds ?? boundsOf(points);
  const rect = { x: 22, y: 30, w: w - 44, h: h - 60 }, map = inRect(rect, bounds);
  axes(ctx, map, rect, c, opt);
  const motion = scene.motion;
  if (motion?.groups) {
    const colors = motionRamp(c, motion.groups.length), flow = scene.kind !== "map";
    const limit = Math.min(points.length, Math.floor(opt.remaining * .85)), stride = Math.max(1, Math.ceil(points.length / Math.max(1, limit)));
    opt.source += points.length;
    for (let bin = 0; bin < colors.length && opt.remaining > 0; bin += 1) {
      ctx.fillStyle = colors[bin]; ctx.strokeStyle = colors[bin]; ctx.beginPath(); let drawn = 0;
      const screen = [];
      for (const i of motion.groups[bin]) {
        if (drawn >= opt.remaining) break;
        if (i % stride || !points[i]?.every(finite)) continue;
        const p = map(points[i]);
        if (flow && i > 0 && points[i - 1]?.every(finite)) { ctx.moveTo(...map(points[i - 1])); ctx.lineTo(...p); }
        else if (!flow) { ctx.rect(p[0], p[1], 1.4, 1.4); screen.push(p); }
        drawn += 1;
      }
      const alpha = .22 + (scene.persistence ?? .7) * .68;
      // Shader-like bloom is approximated with a fixed number of layered 2D
      // passes per bin. No GPU shader and no per-particle shadowBlur.
      if (flow) {
        if (opt.glow) { ctx.globalAlpha = .12 * opt.glow; ctx.lineWidth = 1 + 5 * opt.glow; ctx.stroke(); }
        ctx.globalAlpha = alpha; ctx.lineWidth = 1; ctx.stroke();
      } else {
        ctx.globalAlpha = alpha; ctx.fill();
        if (opt.glow) {
          ctx.beginPath(); const size = 1.4 + 4 * opt.glow;
          for (const p of screen) ctx.rect(p[0] - size / 2, p[1] - size / 2, size, size);
          ctx.globalAlpha = .05 * opt.glow; ctx.fill();
        }
      }
      opt.drawn += drawn; opt.remaining -= drawn;
    }
    ctx.globalAlpha = 1;
    const legendWidth = Math.min(110, w * .22);
    colors.forEach((color, i) => { ctx.fillStyle = color; ctx.fillRect(w - legendWidth - 26 + i / colors.length * legendWidth, 22, legendWidth / colors.length, 3); });
    label(ctx, `0 → ${format(motion.max)}`, w - legendWidth - 26, 38, c.text, 8);
  } else if (scene.kind === "map") {
    const limit = Math.min(points.length, opt.remaining), stride = Math.max(1, Math.ceil(points.length / Math.max(1, limit)));
    ctx.fillStyle = c.accent; ctx.globalAlpha = .2 + (scene.persistence ?? .7) * .65; ctx.beginPath(); let drawn = 0;
    for (let i = 0; i < points.length && drawn < limit; i += stride) if (points[i]?.every(finite)) { const p = map(points[i]); ctx.rect(p[0], p[1], 1.3, 1.3); drawn += 1; }
    ctx.fill(); ctx.globalAlpha = 1; opt.drawn += drawn; opt.remaining -= drawn; opt.source += points.length;
  } else path(ctx, points, map, c.accent, opt, .6, Math.floor(opt.remaining * .85), .85);
  if (scene.trail) path(ctx, scene.trail, map, c.secondary, opt, .9, Math.min(opt.remaining, 1200), 1.25);
  if (scene.head) spark(ctx, map(scene.head), c.warm, 3, opt.glow);
  label(ctx, `${scene.projection ?? "x · y"} · ${motion?.label ?? "step displacement"} · layered Canvas2D bloom`, 28, h - 26, c.text, w < 580 ? 7 : 8);
}
function renderUnwrap(ctx, scene, w, h, c, opt) {
  const d = scene.data; if (!d) return;
  const [geometry, waves] = split(w, h, .49), map = inRect(geometry, d.bounds ?? boundsOf(d.points));
  const frame = d.frame, phase = d.phase ?? 0, history = d.display === "scrolling-history", current = frame?.point ? map(projectHelix(frame.point)) : null;
  let radiusNote = "N/κ undefined at κ=0 or a cusp";
  label(ctx, d.projection === "moving-frame" ? "MOVING FRAME / CURRENT T · N BASIS" : d.is3D ? "OBLIQUE 3D PROJECTION" : "FUNCTION / DOMAIN GEOMETRY", geometry.x, geometry.y - 15, c.text);
  label(ctx, d.display === "scrolling-history" ? "SCROLLING HISTORY · FIXED TIMESTAMPS" : "DOMAIN PREVIEW · ALIGNED CHANNELS", waves.x, waves.y - 15, c.text);
  axes(ctx, map, geometry, c, opt);
  clip(ctx, geometry);
  path(ctx, d.points, map, c.accent, opt, .62, Math.floor(opt.budget * .12));
  if (d.trail) path(ctx, d.trail, map, c.accent, opt, 1, Math.floor(opt.budget * .1), 2);
  const origin = map([0, 0]);
  if (current) {
    line(ctx, origin, current, `${c.accent}99`, .9);
    const angle = Math.atan2(current[1] - origin[1], current[0] - origin[0]);
    ctx.strokeStyle = c.warm; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(...origin, 22, 0, angle, angle < 0); ctx.stroke();
    label(ctx, "θ", origin[0] + 27, origin[1] - 7, c.warm);
    if (opt.vectors && frame.speed > 1e-10) {
      const tangent = projectHelix(frame.tangent), normal = projectHelix(frame.normal);
      const unit = (v) => { const n = Math.hypot(...v) || 1; return [v[0] / n, -v[1] / n]; };
      const t = unit(tangent), n = unit(normal), length = Math.min(65, geometry.w * .2);
      line(ctx, [current[0] - t[0] * length * 2, current[1] - t[1] * length * 2], [current[0] + t[0] * length * 2, current[1] + t[1] * length * 2], `${c.warm}77`, .8, [4, 5]);
      arrow(ctx, current, [current[0] + t[0] * length, current[1] + t[1] * length], c.warm);
      arrow(ctx, current, [current[0] + n[0] * length, current[1] + n[1] * length], c.secondary);
      const curvature = curvatureGeometry(frame);
      if (curvature) {
        const target = map(projectHelix(curvature.center)), dx = target[0] - current[0], dy = target[1] - current[1];
        const actual = Math.hypot(dx, dy), cap = Math.max(30, Math.min(geometry.w, geometry.h) * .7), fraction = Math.min(1, cap / Math.max(1e-12, actual));
        arrow(ctx, current, [current[0] + dx * fraction, current[1] + dy * fraction], c.accent);
        radiusNote = `R=1/κ ${format(curvature.radius)}${fraction < 1 ? " · arrow capped" : " · true scale"}`;
        if (d.osculating) {
          const unitScale = Math.abs(map([1, 0])[0] - map([0, 0])[0]);
          if (curvature.radius * unitScale <= Math.max(geometry.w, geometry.h) * 4) {
            const circlePoints = Array.from({ length: 97 }, (_, i) => {
              const angle = i / 96 * TAU;
              return projectHelix(curvature.center.map((v, j) => v + curvature.radius * (-frame.normal[j] * Math.cos(angle) + frame.tangent[j] * Math.sin(angle))));
            });
            path(ctx, circlePoints, map, c.accent, opt, .4, 97, .8);
          } else radiusNote += " · circle off scale";
        }
      }
    }
    spark(ctx, current, c.text, 3, opt.glow);
  }
  ctx.restore();
  label(ctx, `T · N · ${radiusNote}`, geometry.x, geometry.y + geometry.h + 13, c.text, w < 580 ? 7 : 8);
  label(ctx, `x ${format(d.coordinates?.[0])}  y ${format(d.coordinates?.[1])}  z ${format(d.coordinates?.[2])}`, geometry.x, geometry.y + geometry.h + 25, c.text, 8);
  const channels = d.channels ?? [], rowH = waves.h / Math.max(1, channels.length);
  channels.forEach((channel, index) => {
    const y = waves.y + index * rowH, color = [c.accent, c.secondary, c.warm][index % 3];
    const top = y + 15, plotH = Math.max(18, rowH - 24), baseline = top + plotH / 2;
    const range = channel.range || 1, samples = channel.values, history = d.display === "scrolling-history", axis = d.axis ?? [0, 1];
    const cursor = history ? waves.x + waves.w : waves.x + phase * waves.w;
    const sampleTransform = (p) => [waves.x + ((p[0] - axis[0]) / Math.max(1e-9, axis[1] - axis[0])) * waves.w, baseline - p[1] / range * plotH * .45];
    label(ctx, `${channel.name}  ±${format(range)}${channel.clipped ? " · display clipped" : ""}`, waves.x, y + 8, color, 8);
    line(ctx, [waves.x, baseline], [waves.x + waves.w, baseline], c.axis, .55);
    for (const pole of channel.poles ?? []) {
      const x = waves.x + (pole - axis[0]) / (axis[1] - axis[0]) * waves.w;
      if (x >= waves.x && x <= waves.x + waves.w) line(ctx, [x, top], [x, top + plotH], `${c.warm}aa`, .8, [2, 3]);
    }
    clip(ctx, { x: waves.x, y: top, w: waves.w, h: plotH });
    path(ctx, samples, sampleTransform, color, opt, .85, Math.floor(opt.budget * .125), 1);
    ctx.restore();
    line(ctx, [cursor, top], [cursor, top + plotH], `${c.text}88`, .7, [2, 4]);
    const value = frame?.channels?.[channel.name];
    if (finite(value) && Math.abs(value) <= range) {
      const p = [cursor, baseline - value / range * plotH * .45];
      if (current && w >= 580 && !history) line(ctx, [geometry.x + geometry.w, current[1]], [waves.x, p[1]], `${color}33`, .6, [2, 6]);
      spark(ctx, p, color, 2.5, opt.glow);
    }
  });
  label(ctx, history ? `${format(d.axis?.[0])} sim s` : format(d.domain?.[0]), waves.x, waves.y + waves.h + 12, c.text, 8);
  label(ctx, history ? "now →" : `t → ${format(d.domain?.[1])}`, waves.x + waves.w - 65, waves.y + waves.h + 12, c.text, 8);
}
function renderFourier(ctx, scene, w, h, c, opt) {
  const d = scene.data; if (!d) return;
  const [orbit, wave] = split(w, h, .49), extent = Math.max(.1, d.extent ?? 1);
  const scale = Math.min(orbit.w, orbit.h) * .43 / extent, center = [orbit.x + orbit.w / 2, orbit.y + orbit.h / 2];
  const map = (p) => [center[0] + p[0] * scale, center[1] - p[1] * scale];
  const epicycle = d.epicycle ?? { vectors: [], endpoint: [0, 0] };
  label(ctx, "EPICYCLES / HEAD-TO-TAIL SUM", orbit.x, orbit.y - 14, c.text);
  label(ctx, w < 580 ? "Σ A sin(fφ + δ) / FITTED y SCALE" : "Σ A sin(fφ + δ) / SAME y SCALE", wave.x, wave.y - 14, c.text);
  epicycle.vectors.slice(0, 32).forEach((vector, index) => {
    circle(ctx, map(vector.center), vector.radius * scale, `${c.axis}aa`, .8);
    arrow(ctx, map(vector.center), map(vector.endpoint), index % 2 ? c.secondary : c.accent);
    opt.drawn += 1; opt.remaining -= 1;
  });
  const endpoint = map(epicycle.endpoint), cy = center[1];
  const baseline = w < 580 ? wave.y + wave.h / 2 : cy;
  const waveScale = w < 580 ? Math.min(scale, wave.h * .44 / extent) : scale;
  const cursorX = wave.x + wave.w * .25;
  const from = d.domain?.[0] ?? 0, span = (d.domain?.[1] ?? TAU) - from;
  clip(ctx, wave);
  path(ctx, d.waveform, (p) => [wave.x + (p[0] - from) / span * wave.w, baseline - p[1] * waveScale], c.secondary, opt, .35 + .6 * (d.persistence ?? .7), 1800, 1.5);
  ctx.restore();
  if (opt.showAxes) line(ctx, [wave.x, baseline], [wave.x + wave.w, baseline], c.axis, .7);
  line(ctx, [cursorX, wave.y], [cursorX, wave.y + wave.h], c.axis, .75, [3, 5]);
  const target = [cursorX, baseline - epicycle.endpoint[1] * waveScale];
  line(ctx, endpoint, target, `${c.warm}aa`, .8, [4, 5]);
  spark(ctx, endpoint, c.warm, 3, opt.glow); spark(ctx, target, c.warm, 3, opt.glow);
  label(ctx, `φ = ${format(d.phase)} rad`, orbit.x, orbit.y + orbit.h + 15, c.text);
  label(ctx, "slow visual phase ≠ pitched audio clock", wave.x, wave.y + wave.h + 15, c.text, w < 580 ? 8 : 9);
}
function renderSpirograph(ctx, scene, w, h, c, opt) {
  const d = scene.data; if (!d) return;
  const bounds = d.bounds ?? boundsOf(d.trails?.flat() ?? []), map = inRect({ x: 20, y: 35, w: w - 40, h: h - 65 }, bounds);
  const unit = Math.abs(map([1, 0])[0] - map([0, 0])[0]);
  (d.trails ?? []).forEach((trail, i) => path(ctx, trail, map, [c.accent, c.secondary, c.warm][i % 3], opt, .75, Math.floor(opt.budget / 6), 1.1));
  const gear = d.gear;
  if (gear) {
    circle(ctx, map([0, 0]), gear.R * unit, c.axis, 1);
    const center = map(gear.center), radius = gear.r * unit;
    circle(ctx, center, radius, `${c.warm}99`, .9);
    for (let i = 0; i < 32; i += 1) {
      const angle = i / 32 * TAU + gear.rotation, cos = Math.cos(angle), sin = -Math.sin(angle);
      line(ctx, [center[0] + cos * (radius - 2), center[1] + sin * (radius - 2)], [center[0] + cos * (radius + 2), center[1] + sin * (radius + 2)], c.warm, .7);
    }
    for (const pen of d.pens ?? []) { line(ctx, center, map(pen), `${c.text}88`, .8); spark(ctx, map(pen), c.warm, 3, opt.glow); }
    spark(ctx, map(gear.contact), c.secondary, 3, opt.glow);
  } else for (const pen of d.pens ?? []) spark(ctx, map(pen), c.warm, 3, opt.glow);
  label(ctx, gear ? "FIXED RING / ROLLING GEAR / PHASE-OFFSET PENS" : "POLAR ROSE / NO ROLLING CONTACT", 28, 23, c.text, w < 580 ? 8 : 9);
}
function renderPendulum(ctx, scene, w, h, c, opt) {
  const d = scene.data; if (!d?.geometry) return;
  const [physical, portrait] = split(w, h, .57), params = d.params ?? { length1: 1, length2: 1, mass1: 1, mass2: 1 };
  const reach = params.length1 + params.length2, unit = Math.min(physical.w, physical.h) * .43 / reach;
  const origin = [physical.x + physical.w / 2, physical.y + physical.h / 2];
  const map = (p) => [origin[0] + p[0] * unit, origin[1] - p[1] * unit];
  label(ctx, "COUPLED MASSES / RK4", physical.x, physical.y - 14, c.text);
  path(ctx, d.trail1, map, c.secondary, opt, .45, Math.floor(opt.budget * .25), .8);
  path(ctx, d.trail2, map, c.accent, opt, .9, Math.floor(opt.budget * .35), 1.25);
  line(ctx, origin, map(d.geometry.bob1), c.text, 1.5); line(ctx, map(d.geometry.bob1), map(d.geometry.bob2), c.text, 1.5);
  spark(ctx, origin, c.text, 3, 0); spark(ctx, map(d.geometry.bob1), c.secondary, 4 + Math.sqrt(params.mass1) * 3, opt.glow);
  spark(ctx, map(d.geometry.bob2), c.accent, 4 + Math.sqrt(params.mass2) * 3, opt.glow);
  const side = Math.min(portrait.w, portrait.h - 15), rect = { x: portrait.x + (portrait.w - side) / 2, y: portrait.y + (portrait.h - side) / 2, w: side, h: side };
  label(ctx, "PHASE PORTRAIT / θ₁ × θ₂", portrait.x, portrait.y - 14, c.text);
  ctx.strokeStyle = c.axis; ctx.lineWidth = .6; ctx.strokeRect(rect.x, rect.y, side, side);
  const phaseMap = (p) => [rect.x + (p[0] + Math.PI) / TAU * side, rect.y + (Math.PI - p[1]) / TAU * side];
  axes(ctx, phaseMap, rect, c, opt);
  clip(ctx, rect); path(ctx, d.phase, phaseMap, c.warm, opt, .8, Math.floor(opt.budget * .35), 1); ctx.restore();
  label(ctx, "−π", rect.x, rect.y + side + 14, c.text, 8); label(ctx, "θ₁ → +π", rect.x + side - 55, rect.y + side + 14, c.text, 8);
  label(ctx, "θ₂ ↑", rect.x, rect.y - 6, c.text, 8);
}
function renderLive(ctx, scene, w, h, c, opt) {
  const points = scene.points ?? [], rect = { x: 22, y: 35, w: w - 44, h: h - 70 }, map = inRect(rect, scene.bounds ?? boundsOf(points));
  axes(ctx, map, rect, c, opt); path(ctx, points, map, c.accent, opt, .92, 3000, 1.4);
  if (points.length) spark(ctx, map(points[points.length - 1]), c.secondary, 3, opt.glow);
  label(ctx, scene.view === "xy" ? "PARAMETRIC x / y" : "SIGNAL / SIMULATION TIME →", 28, 24, c.text);
}
export function renderStudio(ctx, scene = {}, width = 800, height = 600, options = {}) {
  const w = Math.max(1, width), h = Math.max(1, height);
  const c = STUDIO_PALETTES[options.palette] ?? STUDIO_PALETTES["Neon Cyberpunk"];
  const budget = Math.max(512, Math.min(60000, Math.floor(options.maxPoints ?? 14000)));
  const opt = { showGrid: options.showGrid !== false, showAxes: options.showAxes !== false, vectors: options.vectors !== false, glow: clamp(Number(options.glow ?? .55), 0, 1), budget, remaining: budget, drawn: 0, source: 0 };
  ctx.save(); ctx.globalAlpha = 1; ctx.lineJoin = "round"; ctx.lineCap = "round";
  ctx.fillStyle = c.background; ctx.fillRect(0, 0, w, h); grid(ctx, w, h, c, opt);
  const renderers = { atlas: renderAtlas, unwrap: renderUnwrap, fourier: renderFourier, spirograph: renderSpirograph, pendulum: renderPendulum, live: renderLive };
  renderers[scene.mode]?.(ctx, scene, w, h, c, opt);
  ctx.restore();
  return { drawn: opt.drawn, renderedCount: opt.drawn, sourceCount: opt.source, budget };
}
