# STATE.md (under 30 lines. now only. history -> LOG.md)
updated: 2026-11-25 | by: Cue | rev: 13
## Doing
| id | task | status |
|---|---|---|
| T4 | Repeatable CPU benchmark; PR #14 | open |
| T12 | Conditional PR auto-merge policy; PR #12 | open |
| T21 | Measure Worker bundle and rendered Web output; target 20 KiB, max 50 KiB | PR #31 open |
| FX-SET | Runtime effects: @store.set; issue #26 | open |
## Done
- T1 | Worker /echo validation, hit-log count, CPU test; PR #10 merged
- T6a | SPEC v1/canonical forms, 7 effects/examples; PR #17 merged
- T6b | D12-D21 and SPEC machine layer; PR #18 merged
- T6c | Architecture guidance folded into AGENTS; PR #19 merged
- T6d | STATE/LOG resynced; Worker test passed; avg 0.0982ms/request (100 requests)
- T11 | Core lexer/parser/cost/seal/type/mirror; 3 core tests; 100-run output hash stable
- repo: github.com/shiba-108/10ms
- 2-layer machine root / human translation; core pure, host executes AST, mirror renders
## Blocked
- SPEC: 7 effects; runtime: 3 (@store.get/add/del). Missing @store.set/@net.fetch/@time.now/@rand.int.
- Pre-change token baseline unavailable; do not infer before/after delta
- T13 | dropped; owner left; code in PR #15 superseded.
## Next (proposed, lead confirms)
- T6e | pending
- T7 | error catalog: every error is data with an exact fix (P8)
- T8 | first-try benchmark: AI gets only the spec; measure first-attempt success (P2, P5, P6)
- T9 | determinism check: 100 runs, identical output hash (P4)
