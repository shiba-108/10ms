# STATE.md (under 30 lines. now only. history -> LOG.md)
updated: 2026-11-25 | by: Cue | rev: 15
## Doing
| id | task | status |
|---|---|---|
| T4 | Repeatable CPU benchmark; PR #14 | open |
| T11-fix | Parse @ effects and SPEC Worker examples; replace primary Worker mock AST | `agent/parser/T11-fix` |
| T20b | `examples/todo.10ms` + add/reload persistence test | hold until T11-fix merge and Lead decision |
| T20c | One-step deploy script + public URL | hold until T20b resumes and E2E passes |
## Open — claimable
| id | input → output | test | effort |
|---|---|---|---|
| T22 | `web.10ms` → `examples/hello.10ms` + parser assertion | `node tests/core/web.test.js` | newcomer ≤15 min |
| T24 | `examples/hello.10ms` → short matching README example | `node tests/core/web.test.js`; compare sample | newcomer ≤15 min |
| T25 | Web/Worker mirror output → exact assertions in existing test | `node tests/core/type-mirror.test.js` | newcomer ≤15 min |
## Done
- Merged: T1 #10; T6a–e; T7 #27; T9 #29; T12 #12; FX-SET #30; T15 #22; T17 #24; T21 #31; T18 Web #32; T19 #33; runtime #43/#44; T20a #48.
- Runtime effects 7/7 Done: `@store.get/add/del/set`, `@net.fetch`, `@time.now`, `@rand.int`; #44 merged at `a9e33f1`.
- Current bundle after T20a: 30.84 KiB, under 50 KiB cap but above 20 KiB target (NOT MET).
- T11: core lexer/parser/cost/seal/type/mirror; three core tests; 100-run output stable.
- 2-layer model: core parses/checks; host executes AST/effects; mirror renders read-only.
- repo: github.com/shiba-108/10ms
## Blocked
- T13 dropped; owner left; code in PR #15 superseded.
- T20b/c held until T11-fix merges and Lead decides whether to resume; no DEL or SPEC change.
## Debt
- Bundle 30.84 KiB > 20 KiB target, below 50 KiB cap; does not block milestone 1.
- Pre-change token baseline unavailable; do not infer before/after delta.
