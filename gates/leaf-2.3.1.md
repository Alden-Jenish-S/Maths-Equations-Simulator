# Gates: Interactive product

Scope: browser UI, themes, canvas animation, controls, snapshot export, and optional WebAudio.

- [x] G1: Static browser smoke loads the atlas and required controls.
  CHECK: node scripts/smoke-server.mjs
  EXPECT: /SERVER_SMOKE_PASS status=200 assets=atlas/
  EVIDENCE: SERVER_SMOKE_PASS status=200 assets=atlas

- [x] G2: UI source contains theme, audio, projection, and snapshot affordances.
  CHECK: node scripts/docs-check.mjs
  EXPECT: /DOCS_PASS ui_controls=present/
  EVIDENCE: DOCS_PASS ui_controls=present
