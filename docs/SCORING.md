# Scoring and adversarial evaluation

`analyzeTrajectory(points, options)` is a total, deterministic heuristic. It
always returns a finite metric object for ordinary JavaScript inputs, including
empty arrays, malformed points, non-finite coordinates, invalid requested
counts, extreme finite values, and invalid coordinate scales. Invalid scales
are reported through `invalidInput: true`, `invalidReason`, and a zero score;
they do not silently turn normalized coordinates into `NaN`.

The browser and explorer interface remains unchanged. The driver may pass
simulator metadata explicitly as `options.metadata`; metadata signals such as
`diverged`, `bounded: false`, `clipApplied`, and `divergedAt` are treated as
authoritative divergence signals.

## Input validity and ratios

- A point is finite only when it is an array with two finite coordinates.
- `finiteRatio` uses `max(requestedCount, suppliedPointCount, 1)` as its
  denominator, so a small requested count cannot create a ratio above one.
- Any malformed or non-finite supplied point, hard-radius escape, explicit
  clipping, metadata divergence, normalization overflow, or an unsafe finite
  geometry range gives
  `divergencePenalty = 1` and `score = 0`.
- A requested count larger than the supplied array is an incomplete output. It
  is classified as `transient`, has a zero score, and retains the observed
  finite ratio.
- Complete trajectories shorter than 512 points are also classified as
  `transient` with a zero score: their recurrence, growth, and noise evidence
  is too weak for a meaningful ranking.
- Empty input is classified as `divergent` with a zero score.
- All fields whose meaning is a ratio or normalized score component are
  clamped to `[0, 1]`. The public `score` is clamped to `[0, 100]`.

The configured coordinate scale is exactly a positive finite pair. It is a declared
family scale, not a scale inferred from the candidate. Division overflow is
detected before geometry metrics are used, and finite normalized coordinates
outside the supported numerical geometry range are rejected rather than
dropped. Raw hard-radius checks happen before display-grid clipping, so
clipping a divergent trajectory cannot make it appear bounded.

## Feature vector

The analyzer uses the finite normalized tail, capped at 12,000 points for
bounded work. Occupancy and entropy are computed independently at every grid
size in `[8, 12, 16, 24, 32, 48]`; the arrays are exposed as
`occupancyByScale`, `entropyByScale`, and `scaleSizes`. The aggregate
`occupancy` and `entropy` include the mean valid-grid ratio.

- **Occupancy:** fraction of occupied cells, averaged across the declared
  scales.
- **Entropy:** normalized Shannon entropy of cell counts at each scale.
- **Periodicity:** best lag recurrence, close-return support, cycle coverage,
  and activity. A fixed point has zero activity and cannot win on recurrence.
- **Symmetry:** mean Jensen-Shannon similarity under horizontal, vertical, and
  180-degree reflections of the 24 by 24 grid.
- **Spectrum:** a separable two-dimensional DFT of the 24 by 24 occupancy grid.
  It reports spectral entropy, dominant-share, high-frequency share, radial
  band coverage, and a concentrated multi-band structure signal. The original
  four nested spatial loops were replaced with row and column transforms,
  reducing this diagnostic from O(n^4) to O(n^3).
- **Stability:** valid-grid coverage, block drift, hard-escape penalty, and
  growth risk.
- **Growth risk:** a proxy from the 90th-percentile radius in four successive
  blocks, requiring net growth and a repeatable upward trend. It is not a
  Lyapunov exponent or a proof of divergence.
- **Collapse diagnostics:** covariance eigenvalues, connected-component ratio,
  compactness, recurrence/occupancy interaction, centroid-relative radial
  uniformity, and suffix variance.
- **Tail collapse:** compares an active early window with the final window.
  A rich trajectory that becomes fixed near the end therefore remains
  transient instead of being judged only by a short final centroid.
- **Prediction skill/noise risk:** deterministic nearest-neighbour successor
  agreement is sampled across time. It suppresses random clouds that happen
  to have high entropy and occupancy; it is a noise proxy, not a
  determinism or chaos test.

The score is a weighted target-band utility. It does not maximize entropy or
symmetry: those objectives alone reward noise and circles. The final score is
multiplied by stability, transient validity, and one-minus-collapse/noise
penalties. A bounded candidate can still receive a positive score without
being labeled `structured`.

## Translation-invariant collapse handling

Circle and ring diagnostics use the centroid of the analyzed coordinates and
the distribution of radii around that centroid. Translating a circle changes
its absolute coordinates but not its radial uniformity or angular coverage.
Such a candidate is therefore classified as `trivial` when the ring evidence
is strong, regardless of whether its translated position is centered in the
display box. Thin lines use covariance anisotropy; fixed points use covariance
trace and recurrence activity.

## Classes

- **`divergent`:** malformed/non-finite data, hard escape, explicit clipping,
  metadata divergence, normalization overflow, or empty input.
- **`transient`:** an incomplete requested output or a bounded trace with
  strong block drift, growth, or rich-then-fixed suffix collapse.
- **`trivial`:** fixed points, translated or centered circles/rings, and thin
  filaments detected by collapse diagnostics.
- **`periodic-trivial`:** strongly recurring low-occupancy traces that are not
  already covered by the fixed/line/ring tests.
- **`structured`:** a bounded, valid candidate with score at least 35 after
  penalties and without a protected collapse or noise classification.
- **`bounded-low-complexity`:** bounded data that does not meet the structured
  threshold, including broadband random square noise.

These are policy labels for ranking and display, not mathematical claims about
the underlying dynamical system.

## Adversarial loop

Run:

```sh
node scripts/adversarial.mjs
```

The deterministic holdout asserts every named fixture independently. It
includes:

1. canonical Hénon at `a=1.4`, `b=0.3`, which must remain structured and have a
   meaningful positive score;
2. a fixed point;
3. a translated circle;
4. a noisy square, which must not be structured;
5. a thin line;
6. explicitly clipped divergence;
7. one-percent NaN contamination;
8. a non-finite final point;
9. finite values whose normalization overflows;
10. a short output with missing requested samples;
11. a requested-count underflow case that checks ratio capping;
12. explicit metadata divergence;
13. a rich prefix followed by a fixed tail;
14. zero and NaN coordinate scales; and
15. empty input; and
16. positive-score default references for Lorenz, Duffing, Ikeda, Clifford,
    De Jong, Aizawa, Rössler, and Thomas.

For every fixture the script checks its expected class or score policy,
deterministic repeatability, finite output, ratio bounds, six-scale arrays, and
score-component bounds. It also compares the optimized DFT with an independent
direct DFT on a deterministic grid. Full metrics are written to
`data/adversarial-report.json`, with a compact table in
`data/adversarial-report.md`.

## Limitations

This spectrum is a compact DFT diagnostic, not a fractal-dimension estimator.
The scorer does not estimate Lyapunov exponents, certify chaos, or infer a
physical invariant measure. A visually compelling structure can score poorly
if it falls outside the declared family normalization, and a novel structure
can resemble a protected fixed, line, ring, or noise family. The growth proxy
is based on four blocks and the tail-collapse test depends on the available
sample count. Metadata divergence is trusted as an explicit simulator
contract signal; unlabeled domain-specific failure modes remain the
simulator's responsibility.
