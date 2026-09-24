# Geometry and physics

`src/art-modes.js` is a dependency-free ES module. It is safe to import from
Node: it creates no canvas, audio node, timer, or other browser resource. The
module implements the exact boundary in `docs/IMPLEMENTATION-CONTRACT.md`.

## Curves

`CURVE_LIST` is the ordered list of seventeen descriptors and `CURVES` is the
id-indexed lookup:

```js
const { points, channels, metadata } = sampleCurve("ellipse", { a: 2, b: 1 }, 720);
const frame = curveFrame("helix", { radius: 2, pitch: 0.2 }, 1.5);
```

The domains are finite and are recorded in every descriptor and sample
metadata. `sampleCurve` includes both domain endpoints and returns a point for
every requested sample. It also returns synchronized arrays for every channel
present in the sample. The channel names include `x`, `y`, `z` where needed,
`tangentX/Y/Z`, `normalX/Y/Z`, `speed`, and `curvature`. Circle additionally
has `sin`, `cos`, `tan`, `cot`, `sec`, and `csc`; hyperbola has `cosh`, `sinh`,
`tanh`, `sech`, `csch`, and `coth`.

The circle and hyperbola channels are deliberately not regularized at poles.
Their undefined values are `null`. When an asymptote falls between uniform
sample points, the two channel entries around that interval are also set to
`null`, so a line renderer can break the segment instead of connecting across
an unbounded value. A `null` curvature means that the local frame is not
defined, normally because the parameterization has zero speed or a cusp. A
`null` channel makes `frame.singular` true; a cusp or zero-speed frame does so
as well.

The implementations use analytic first and second derivatives for the conics,
roulette curves, spirals, the helix, and the lemniscate. Superellipse samples
use the Lamé implicit law for all four useful regimes in the schema: `n = 2/3`
(astroid), `n = 1` (diamond), `n = 2` (ellipse), and `n = 4` (rounded
rectangle). The angular parameter is not arc length. At the axis corners/cusps
of the non-smooth regimes the position remains valid, while speed and
curvature are reported as zero/null rather than guessed from a one-sided
normal.

The lemniscate parameterization is continuous through the origin and traverses
both lobes over `[0, 2π]`. The clothoid has unit speed and curvature magnitude
`|a t|`. Its position integral is evaluated with deterministic eight-point
Gauss–Legendre quadrature over cached cells of width `1/32`; this avoids doing a
long adaptive integration on every animation frame. The cache is bounded to
eight curvature-rate tables. This is accurate for the supplied domain
`[-6, 6]`, but is still a floating-point quadrature, not a symbolic Fresnel
evaluation. Calling `curveFrame` outside the descriptor’s displayed domain is
allowed only within the finite numerical guard and is not a substitute for
the documented sampling domain.

Curvature is the non-negative magnitude of the planar or spatial Frenet
curvature. The normal is the left planar normal for two-dimensional curves. In
3D it is the normalized component of the second derivative perpendicular to
the tangent, which is Frenet-like and remains well-defined for the helix. It
does not provide a binormal because the contract exposes only `normal`.

### Research additions

The catalogue also includes three closed-domain additions that use the same
`curveFrame`/`sampleCurve` jet interface:

- **Lissajous figure**: `x = A sin(at + δ)`, `y = B sin(bt)`, with positive
  integer frequencies `a` and `b` and `[0, 2π]` domain. The first and second
  derivatives are evaluated directly from the two sinusoidal components.
- **Torus knot**: `x = (R + r cos(qt)) cos(pt)`,
  `y = (R + r cos(qt)) sin(pt)`, `z = r sin(qt)`, with integer winding counts,
  `R > r`, and `[0, 2π]` domain. The derivative jet differentiates the radial
  factor before applying the planar polar product rule. Coprime `p,q` give a
  single traversal; non-coprime choices intentionally retrace a reduced knot.
- **Joukowsky mapped circle**: `z(t) = cx + i cy + ρ exp(it)` and
  `w = z + a²/z`, returned as `[Re(w), Im(w)]`. The quotient derivatives are
  analytic through second order. The source circle must not pass through the
  pole `z = 0`; circles that enclose the pole remain valid closed contours, and
  zero-speed mapped cusps are reported with null curvature rather than guessed.

The equations and terminology were checked against Wolfram MathWorld's
[Lissajous Curve](https://mathworld.wolfram.com/LissajousCurve.html) and
[Torus Knot](https://mathworld.wolfram.com/TorusKnot.html) entries, and NASA
Glenn's [Conformal Mapping](https://www.grc.nasa.gov/www/k-12/airplane/map.html)
airfoil tutorial. These references motivate the displayed equations; the
implementation remains a finite-precision visual sampler, not a claim about
physical airflow or knot classification beyond the selected integer winding.

## Spirographs

```js
spirographPoint({ R: 5, r: 3, d: 2, mode: "hypotrochoid" }, t, phase);
generateSpirograph({ R: 5, r: 3, d: 2, mode: "hypotrochoid" }, 2400);
```

`hypotrochoid` and `epitrochoid` use the standard fixed-circle/rolling-circle
equations. `rose` uses `R/r` as the radial-frequency ratio and `d` as its
amplitude. `phase` is a pen phase, so multiple pens can call the same equation
with different phases without modifying the geometry parameters.

For a rational gear ratio that can be represented by the bounded search (up to
denominator 512), generation covers the exact closed period and reports
`metadata.closed`, `turns`, and `period`. For a ratio that is not detected as a
small rational, generation uses a deterministic ten-turn window and reports
`closed: false`; this is a finite visual window, not a claim that the curve is
aperiodic. Inputs are finite and bounded, and a hypotrochoid requires `R >= r`.

## Double pendulum

```js
const state = createDoublePendulum({ theta1: 0.8, theta2: 1.4 });
const frame = stepDoublePendulum(state, { damping: 0 }, 1 / 240);
```

Angles are measured from the downward vertical and remain numerically
**unwrapped**. `geometry.origin`, `bob1`, and `bob2` are Cartesian positions;
`point` is the second bob and `phaseSpace` is `[theta1, theta2]`. The potential
energy reference is the pivot-height reference, and therefore

```text
V = -(m1 + m2) g l1 cos(theta1) - m2 g l2 cos(theta2).
```

The accelerations come from the coupled Lagrange mass matrix, which is solved
at each derivative evaluation. A fixed-step classical RK4 update is used, with
bounded substeps for large requested `dt`; it is not an energy-preserving
integrator. In the undamped case energy drift decreases rapidly with smaller
steps, but long chaotic trajectories will eventually separate and are not
expected to match bit-for-bit across step sizes. Damping is viscous generalized
damping on both angular velocities, so energy should decrease for ordinary
finite states but is not projected onto an artificial energy shell.

Inputs reject non-finite values, invalid masses/lengths, negative `dt`, and
unsupported curve or spirograph modes. The state update is transactional: if a
finite-state or substep guard fails, the state is marked `diverged`, its last
finite numerical state is retained, and the returned frame has
`bounded: false, diverged: true`. The implementation does not clip a divergent
angle or velocity into a plausible-looking drawing. These guards protect the
renderer; they are not a proof of physical stability.

Run the focused verification with:

```sh
node scripts/art-test.mjs
```

It checks descriptor completeness, deterministic sampling, implicit curve
identities, channel poles, cusp handling, helix/clothoid differential
properties, gear closure, invalid inputs, RK4 refinement, and conservative or
damped energy behavior.
