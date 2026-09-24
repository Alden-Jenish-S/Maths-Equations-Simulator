# Validation procedures

## Numerical checks

Run:

```sh
node scripts/validate.mjs
```

The script checks:

- exactly nine registered systems with non-empty equations and parameter schemas;
- a bounded, finite reference sample for each family;
- deterministic repeatability of complete trajectories under identical configuration;
- finite default samples for all seventeen generalized curves;
- fixed-duration RK4 refinement evidence for the five added continuous systems;
- explicit execution of a Hénon unstable/escape path.

The reference samples are intentionally shorter than the discovery search. Their purpose is to catch equation and integrator regressions, not to certify a global stability theorem.

## Scoring checks

Run:

```sh
node scripts/adversarial.mjs
```

The expected result includes complete metric keys, at least three penalty cases, a positive structured Hénon reference score, and machine-readable JSON evidence. A clipped candidate receives a divergence penalty even when its visible points lie inside the square viewport.

## UI and server checks

`node scripts/smoke-server.mjs` starts the local static server on an isolated test port, fetches the HTML entry point, verifies the canvas shell, and fetches the generated atlas. `docs-check.mjs` verifies documentation and semantic control ids. The browser itself uses native selects, range inputs, labels, a canvas description, and a polite live region.

## Performance check

`node scripts/benchmark.mjs` generates deterministic 50k and 200k screen-space clouds and measures the occupancy-tile decimator. The browser renderer uses device-pixel-ratio capping, filled rectangles rather than per-point arcs, and a pixel-budgeted screen-space decimator. Full source and rendered counts are shown to prevent silent data loss.
