# Gates: Trustworthy discovery and telemetry (integration)

Scope: metrics, deterministic search, generated artifacts, and scientific documentation.

- [x] N1: child gates are checked.
  CHECK: node /Users/aldenjenish/.config/opencode/skills/unlazy/scripts/gate-check.mjs --status gates/leaf-2.2.1.md gates/leaf-2.2.2.md
  EXPECT: /ALL MET/
  EVIDENCE: gates/leaf-2.2.2.md: 2 gates | ALL MET (3 met)

- [x] N2: generated data has the expanded schema.
  CHECK: node -e "import('./data/discoveries.json',{with:{type:'json'}}).then(({default:x})=>console.log('DATA_SCHEMA_PASS families='+x.search.families.length))"
  EXPECT: /DATA_SCHEMA_PASS families=9/
  EVIDENCE: DATA_SCHEMA_PASS families=9
