# STATE.md (under 30 lines. now only. history -> LOG.md)
updated: 2026-11-25 | by: Manus | rev: 16
## Doing
| id | task | status |
|---|---|---|
| T4 | Repeatable CPU benchmark; PR #14 | open |
| PR47 | Worker-specific Wrangler config; preserve Web ship config | open |
| PR41 | Minify/test the Worker-specific bundle after #47 | queued |
## Open — claimable
| id | input → output | test | effort |
|---|---|---|---|
| T22 | `web.10ms` → `examples/hello.10ms` + parser assertion | `node tests/core/web.test.js` | newcomer ≤15 min |
| T24 | `examples/hello.10ms` → short matching README example | `node tests/core/web.test.js`; compare sample | newcomer ≤15 min |
| T25 | Web/Worker mirror output → exact assertions in existing test | `node tests/core/type-mirror.test.js` | newcomer ≤15 min |
## Done
- Merged: T1 #10; T6a–e; T7 #27; T9 #29; T12 #12; FX-SET #30; T15 #22; T17 #24; T21 #31; T18 Web #32; T19 #33; runtime #43/#44.
- Runtime effects 7/7 Done: `@store.get/add/del/set`, `@net.fetch`, `@time.now`, `@rand.int`; #44 merged at `a9e33f1`.
- T21 Worker bundle 28.67 KiB: under 50 KiB cap; above 20 KiB target (NOT MET).
- T11: core lexer/parser/cost/seal/type/mirror; three core tests; 100-run output stable.
- 2-layer model: core parses/checks; host executes AST/effects; mirror renders read-only.
- repo: github.com/shiba-108/10ms
## Blocked
- T20: runtime-effect scope awaits owner's decision.
- Pre-change token baseline unavailable; do not infer before/after delta.
- T13 dropped; owner left; code in PR #15 superseded.
- Issue #11 live deploy/Cloudflare CPU confirmation remains owner-only; not attempted.
