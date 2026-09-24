# Mathematical systems and numerical validation

`src/systems.js` is a deterministic numerical catalogue. Maps are iterated
directly. The five ODEs use classical fixed-step fourth-order Runge–Kutta
(RK4). A simulation returns a display projection in `points`, the state
projection used by the existing API in `rawPoints`, and diagnostic `metadata`.
Spatial three-dimensional states retain `z`; Duffing intentionally retains its
legacy `[x,v]` projection while integrating an internal time coordinate.

## Systems and exploration ranges

The ranges below are the browser's documented exploration ranges. They are
schema guidance, not an implicit numerical claim that every parameter value is
an attractor. Non-finite parameters are rejected; finite values supplied to the
API are retained, except for the legacy Ikeda clamp described below.

### Hénon map

\[
x_{n+1}=1-a x_n^2+y_n,\qquad y_{n+1}=b x_n.
\]

Range: `a ∈ [0, 1.6]`, `b ∈ [-0.5, 0.5]`. The map is direct iteration and its
Jacobian determinant is `−b`. The canonical `(a,b)=(1.4,0.3)` case is used as
a bounded strange-attractor reference. A trajectory that exceeds
`hardRadius`, or becomes non-finite, is marked divergent and is not clipped.

### Lorenz flow

\[
\dot x=\sigma(y-x),\quad \dot y=x(\rho-z)-y,\quad \dot z=xy-\beta z.
\]

Range: `σ ∈ [5,20]`, `ρ ∈ [0,50]`, `β ∈ [1,4]`; reference `dt=0.01`.
The vector-field divergence is the constant
`−(σ+1+β)`. The classical `(σ,ρ,β)=(10,28,8/3)` case is validated, and
`rawPoints` retains `z` for alternate projections.

### Forced Duffing oscillator

\[
\ddot x+\delta\dot x+\alpha x+\beta x^3=\gamma\cos(\omega t).
\]

Range: `δ ∈ [0.02,0.5]`, `α ∈ [-1,1]`, `β ∈ [0.1,2]`,
`γ ∈ [0,3]`, `ω ∈ [0.5,2.5]`; reference `dt=0.02`. The integrated state is
`(x,v,t)` with `v=ẋ`; the public display projection remains `[x,v]` for
compatibility. The forcing period is `2π/|ω|`; the API reports `null` when
`ω=0` or the period exceeds the finite numerical range. For the unforced system, the
Hamiltonian is

\[
H=v^2/2+\alpha x^2/2+\beta x^4/4,\qquad \frac{dH}{dt}=-\delta v^2,
\]

but discovery and the reference validation use forced motion.

### Ikeda map

\[
t_n=0.4-\frac{6}{1+x_n^2+y_n^2},
\]
\[
x_{n+1}=1+u(x_n\cos t_n-y_n\sin t_n),\qquad
y_{n+1}=u(x_n\sin t_n+y_n\cos t_n).
\]

Range: `u ∈ [0.45,0.99]`, including the canonical `u=0.918` reference.
The area multiplier is `u²`. For `u<1`, the affine radius inequality gives the
absorbing bound `r ≤ 1/(1-u)`, which is checked for the reference trajectory.
The original API's finite-value clamp to `[0,1.2]` is retained; non-finite `u`
is rejected before clamping.
For `u >= 1`, `metadata.absorbingRadius` is `null` because this inequality
provides no finite absorbing bound; the simulation's escape guard still applies.

### Clifford attractor

\[
x_{n+1}=\sin(a y_n)+c\cos(a x_n),\qquad
y_{n+1}=\sin(b x_n)+d\cos(b y_n).
\]

Range: `a,b,c,d ∈ [-2,2]` with reference `(-1.4,1.6,1,0.7)`. For that
reference, the component bounds `|x|≤1+|c|=2` and
`|y|≤1+|d|=1.7` follow directly from the trigonometric terms.

### De Jong attractor

\[
x_{n+1}=\sin(a y_n)-\cos(b x_n),\qquad
y_{n+1}=\sin(c x_n)-\cos(d y_n).
\]

Range: `a,b,c,d ∈ [-3,3]` with reference
`(1.641,1.902,0.316,1.525)`. Every output component is in `[-2,2]` by
the sine/cosine bound; validation checks this identity over the returned tail.

### Aizawa flow

\[
\dot x=(z-b)x-dy,\qquad \dot y=dx+(z-b)y,
\]
\[
\dot z=c+az-z^3/3-(x^2+y^2)(1+ez)+fzx^3.
\]

Range: `a ∈ [0.8,1.1]`, `b ∈ [0.5,0.9]`, `c ∈ [0.4,0.8]`,
`d ∈ [2.5,4.5]`, `e ∈ [0.1,0.4]`, `f ∈ [0.05,0.15]`; reference `dt=0.01`.
Its divergence is state-dependent and is reported as the formula

\[
\nabla\cdot F=a+2(z-b)-z^2-e(x^2+y^2)+fx^3.
\]

The API deliberately reports this formula, rather than a misleading constant.

### Rössler flow

\[
\dot x=-y-z,\qquad \dot y=x+ay,\qquad \dot z=b+z(x-c).
\]

Range: `a,b ∈ [0.1,0.4]`, `c ∈ [4,14]`; reference `dt=0.01` and
`(a,b,c)=(0.2,0.2,5.7)`. Its divergence is state-dependent:

\[
\nabla\cdot F=a+x-c.
\]

`metadata.divergence` therefore contains `{kind: "state-dependent", formula:
"a + x − c"}` rather than the incorrect constant `a-c`.

### Thomas cyclic flow

\[
\dot x=\sin(y)-bx,\qquad \dot y=\sin(z)-by,\qquad
\dot z=\sin(x)-bz.
\]

Range: `b ∈ [0.15,0.35]`; reference `b=0.208186`, `dt=0.02`. Its divergence
is the constant `−3b`. The default initial state breaks cyclic symmetry; the
metadata flag records whether a supplied initial state does so.

## Numerical limits and failure behavior

- `burnIn` is an integer in `[0, 2,000,000]`; `steps` is an integer in
  `[1, 2,000,000]`; their sum is capped at `2,000,000` to prevent runaway
  allocations and loops.
- ODE `dt` must be finite and is limited to `[10⁻⁸,1]`. The accumulated ODE
  time must remain finite. Map configurations reject non-finite values even
  though `dt` is unused.
- `hardRadius` must be finite and non-negative (zero is accepted for an
  intentionally empty-radius guard). Non-finite parameters and
  initial state coordinates are rejected. A finite overflow during a map step
  or any RK4 stage marks the trajectory divergent and stops it before a
  non-finite point can be returned.
- `getSystem` rejects unknown IDs. `simulateSystem` applies each system's
  default configuration to omitted fields, preserving the original API shape.
- A divergent run reports `metadata.diverged=true`, `divergedAt`, and the
  finite prefix only. It is never resized or clipped to look complete.

## Verification

Run:

```sh
node scripts/validate.mjs
```

The validation script is numerical-systems-only. It checks all nine systems,
finite complete reference tails, exact deterministic repeatability of complete
trajectory objects, map bounds and identities, divergence metadata, overflow
and malformed-configuration rejection, and the Hénon divergence path.

For each of the five ODEs it integrates the same initial state over the same
short physical interval `T=0.4` at `dt`, `dt/2`, and `dt/4`. It compares final
states and requires the coarse-to-half-step error ratio to exceed `4`, a
conservative evidence threshold for fourth-order RK4 (the observed ratios are
close to `16` for the reference states). This is a local step-refinement test,
not a proof of global accuracy.

Chaotic behavior is not certified by this check. Determinism means repeatable
floating-point execution for identical inputs; it does not imply that a
long-run chaotic trajectory is physically predictable, structurally unique, or
an independently verified strange attractor.

The equations and parameter selections follow the standard definitions in
Hénon (1976), Lorenz (1963), Ikeda (1979), the Aizawa and Rössler system
definitions, Thomas' cyclic flow, and standard Duffing summaries. No external
material is downloaded at runtime.
