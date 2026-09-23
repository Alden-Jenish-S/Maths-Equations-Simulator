# Gates: Mathematical foundation (integration)

Scope: expanded systems and generalized art modes compose without changing the original simulator contract.

- [x] N1: child gates are checked.
  CHECK: node /Users/aldenjenish/.config/opencode/skills/unlazy/scripts/gate-check.mjs --status gates/leaf-2.1.1.md gates/leaf-2.1.2.md
  EXPECT: /ALL MET/
  EVIDENCE: gates/leaf-2.1.2.md: 2 gates | ALL MET (4 met)

- [x] N2: math modules import together.
  CHECK: node -e "import('./src/systems.js').then(()=>import('./src/art-modes.js')).then(()=>console.log('MATH_IMPORT_PASS'))"
  EXPECT: MATH_IMPORT_PASS
  EVIDENCE: MATH_IMPORT_PASS
