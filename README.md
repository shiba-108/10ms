# 10ms

**Redefine the limit.**

10ms is an ultra-light language made for AI to write.
A program says what it should do. A host decides where it runs. From code to product is one step.

[Principles](#the-eight-principles) · [Contribute in 5 minutes](#contribute-in-5-minutes) · [Contribution Logic](#10ms-contribution-logic)

---

## The 10ms Story

**Two ceilings. Twenty years apart. One answer.**

**2006: The elevator.** A software crash stopped an elevator in Vancouver.
A programmer climbed twenty-one flights of stairs, annoyed that software fails so easily.
He refused to call that normal. He started a new language, named after a fungus built to survive.
That language is **Rust**.

**2026: The wall.** One of us was building Vionsky, a social AI platform, on a Cloudflare Pages Worker.
Then a request crossed 10ms of CPU and died with Error 1102.
The usual advice arrived on cue: add a framework, add a layer, pay for a bigger plan.

**Our ceiling.** Everyone here knows a wall like this: a free tier, a tiny budget, a slow phone, a team of one.
Now there is a new one: the AI that writes our code pays for every token and gets lost in ceremony.
Rust turned a crashed elevator into a language. 10ms turns a ceiling into a discipline.
Different decade. Different limit. Same move: refuse to call it a wall.

> **What would we build if the limit were the brief?**

---

## The Eight Principles

Immutable. Every rule in this repo traces back to one of them.

| # | Principle | In one line |
|---|---|---|
| 1 | Under 10ms | Under 10ms of CPU. Zero dependencies. |
| 2 | Written by AI | Made for AI to write, not for people to read. |
| 3 | One step | From code to product in one step. There is no step two. |
| 4 | Deterministic | Same code, 100 runs, 100 identical results. |
| 5 | Few words | The fewest tokens possible. No boilerplate. |
| 6 | One way | One job, one way to write it. No ambiguity. |
| 7 | Everywhere | One program runs on web, worker, app and infrastructure. |
| 8 | Errors are data | Machines read errors. AI fixes them with no human translator. |

---

## What 10ms Is. And Is Not.

| 10ms is | 10ms is not |
|---|---|
| A language made for AI to write | A framework |
| A program that states intent, on any host | Code tied to one platform |
| Zero dependencies | A wrapper around other packages |
| A CPU budget you can measure | A promise you have to trust |
| Small enough to read in one prompt | A codebase that needs a map |
| One way to write each thing | Five styles for the same job |
| Quality kept, work moved off the hot path | Features cut to look fast |
| A habit: measure, trim, share | A race to add features |

---

## Built to Last

- **Platforms die. The language does not.** Every platform is a host. A program never names one, so moving hosts never means a rewrite.
- **The core freezes.** It grows only by addition and never breaks an old program. New things grow outside it.
- **Nothing without a reason.** Every rule traces to one of the eight principles. No trace, no rule.
- **Only lines that last.** If a sentence stops being true when today's platforms, vendors and models vanish, it does not belong in the rules.

---

## Contribute in 5 Minutes

No permission needed. No meeting. No setup guide. Three steps.

1. **Read (1 min).** The eight principles above. Nothing else is required.
2. **Pick one target (2 min).** Change one thing. Take one from the table, or open an issue with your own.
3. **Open a PR (2 min).** Paste this into the description and fill every section.

**First host: Cloudflare Workers.** A Worker PR needs only a PC, code plus `wrangler.toml`, local tests via `wrangler dev --local`, Miniflare, or Node, and a `process.cpuUsage()` CPU measurement below 10 ms per request. The maintainer handles real deployment after merge.

| Target | Done when |
|---|---|
| A new host | The same program runs on it, unchanged |
| A cost check | It rejects a program that cannot prove its CPU budget |
| An error that fixes itself | A machine reads it and applies the fix, no human |
| A first-try benchmark | An AI gets only the spec; you measure how often its program works first time |
| Your 10ms story | You open an issue: where did the wall hit you? |

```markdown
### Goal
One sentence. Which principle (1-8) does it serve?
### Change
What changed, and why it must exist.
### Proof
| | Before | After |
|---|---|---|
| CPU ms (p50 / p90) | | |
| Tokens to write the same program | | |
| 100 runs, identical output hash | | |
### How to test
Commands a stranger can paste.
```

---

## 10ms Contribution Logic

The constitution of 10ms. Short enough to memorize. Plain enough to paste into any AI.
**Humans:** read it once. **AI (any model, any vendor):** paste the block below before asking for work.

```text
10MS CONTRIBUTION LOGIC v2
PURPOSE: an ultra-light language, written by AI, for AI. Under 10ms CPU, zero dependencies.
CONSTITUTION (immutable, every rule traces to one):
  P1 under 10ms CPU, zero dependencies     P2 written for AI, not for human readers
  P3 code to product in one step           P4 deterministic: 100 runs, 100 identical results
  P5 fewest tokens, no boilerplate         P6 one job, one way to write it
  P7 runs everywhere: web, worker, app, infra
  P8 errors are data; AI fixes them with no human translator

ARTICLE 1. THREE QUESTIONS (answer in writing before any code)
  Q1. Does it increase CPU?
  Q2. Does it increase the tokens needed to write or read?
  Q3. If we remove it, does the program still run?
  Q3 = yes: do not write it. Q1 or Q2 = yes: justify it with proof.

ARTICLE 2. NO BLOAT
  - Zero dependencies, always.
  - A second way to do what already has one way: rejected.
  - The core only grows by addition, each with proof. Deleting beats adding.

ARTICLE 3. ONE SHAPE
  Every PR: 1. Goal (names its P)  2. Change  3. Proof  4. How to test
  Proof = same input; CPU ms p50 and p90; tokens before and after; 100 runs with identical output hash.
  No proof, no merge.

ARTICLE 4. NO ORPHAN
  Every function and rule carries one comment: WHY it exists and which P it serves. No reason, delete.

ARTICLE 5. ONE README IS ENOUGH
  If it needs another document to be understood, simplify it.

FOR AI AGENTS: reply with (1) answers to Q1 to Q3, (2) the smallest change that works,
(3) the PR in the Article 3 shape. Never add a dependency. Never edit P1 to P8. When unsure, delete.
```

---

## Join Us

Every limit is somebody's wall. Bring yours: fork it, shrink it, ship it.

*Giới hạn không phải bức tường, mà là nơi chúng ta bắt đầu.*
