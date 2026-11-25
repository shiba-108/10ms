# Why We Did It This Way

Twenty-one decisions, each in two lines. This page is a translation: to change a decision, change it at the machine layer first.

- **D1. 10ms is a language. The framework is only its first host.**
  Why: Platforms and frameworks age. A language made for AI can outlive both.

- **D2. The eight principles never change. Only the human owner may amend them.**
  Why: A compass that moves is not a compass. Agents drift; principles must not.

- **D3. We write for AI first. People get a view, not the source.**
  Why: Serving both makes the code worse for both. AI pays per token; a person can always ask for a translation.

- **D4. A program never names a platform.**
  Why: Hosts are mortal. Moving to a new one must never mean a rewrite.

- **D5. We made 10ms our name and our filter.**
  Why: The number came from a real wall, and a hard limit filters out useless work.

- **D6. We went public under MIT.**
  Why: Hidden means no community. People can copy the code, but not our community, story, trust or speed.

- **D7. The core stays tiny, then freezes.**
  Why: Any AI can read a small core in one go. Once frozen, it only grows by addition and never breaks an old program. The ecosystem grows outside.

- **D8. No rule names a syntax, a version or a vendor.**
  Why: A rule must stay true if today's platforms and models vanish. Syntax lives in the one-page spec; vendors live in the host list.

- **D9. Two layers: the machine layer is the root, the human layer is its translation. The machine layer is in English.**
  Why: AI reads fewer tokens, there is one source of truth, and the story stays warm for the community. Every AI reads English best.

- **D10. The live status note stays under 30 lines.**
  Why: AI context is limited. The status note is "now", the log is "history".

- **D11. Work in micro-steps and commit after each one.**
  Why: A sudden limit once killed a merge halfway. Now the most we can lose is one step.
- **D12. One canonical form (Canonical-or-Error).**
  Why: The compiler accepts one way to write something. Any other form returns an error with the canonical form, so no formatter or style guide is needed.

- **D13. Errors are patches (Error = Patch).**
  Why: Each error is JSON with a location, expectation, exact fix, and replay seed. The AI applies the patch and reruns, without a person.

- **D14. Cost proof.**
  Why: Every loop is bounded, so the compiler can calculate an upper bound on CPU. A program that cannot prove ≤10ms does not ship.

- **D15. Declared effects (@).**
  Why: The core is pure; anything that touches external state (storage, network, time, randomness) goes through @ and is logged. The same log and input produce the same output.

- **D16. Intent over procedure.**
  Why: Programs declare what to do, not where to run. The host chooses, with no second configuration step.

- **D17. One file = one product.**
  Why: Page and on share one file; ship splits the browser and server parts, so full-stack needs no glue.

- **D18. Seal.**
  Why: Ship returns a hash of the source and binds the runtime to it. The same source is the same product; rollback points to an old hash.

- **D19. First-try rate.**
  Why: Measure how often a new AI runs programs correctly on its first try from the one-page spec. Reject features whose token cost exceeds their value.

- **D20. Frozen core + lifespan layers.**
  Why: The core only adds; layers change at different rates, and rules must remain true if a platform disappears.

- **D21. Mirror.**
  Why: A read-only command translates any program for people. Readability is a gift, while the AI-written source remains the truth.
