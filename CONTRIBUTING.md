# Contributing to 10ms

Thanks for helping keep 10ms small, fast, and dependable.

## Starting point

The eight principles are the project's constitution. The contribution path begins with [The Eight Principles in README.md](README.md#the-eight-principles), then one clearly scoped target, then a pull request in the A3 shape below. A useful target might be a bug, a cost check, a host, a first-try measurement, or a **Your 10ms story** issue about a wall someone hit.

[SPEC.md](SPEC.md) is the canonical guide to the language and its syntax. Changes to syntax belong there rather than in a competing description.

## Boundaries

Dependencies stay at zero. P1–P8 are immutable; only the project owner may amend them. The Contribution Logic law is not a contribution target: changes must not edit or weaken it. Contributions should preserve the existing one-way, measurable design rather than add another way to do the same job.

## Pull request shape (A3)

Every pull request has these four sections, in this order:

### Goal
One sentence naming the principle (P1–P8) the contribution serves.

### Change
What changed and why it needs to exist.

### Proof
Evidence for the same input: measured CPU in milliseconds (p50 and p90), token counts before and after, and the hash shared by 100 identical runs. A metric that does not apply or cannot be measured is marked unavailable with a reason, never estimated.

### How to test
Reproducible steps and the expected result.

Bug reports and **Your 10ms story** reports use the issue templates in `.github/ISSUE_TEMPLATE/`.
