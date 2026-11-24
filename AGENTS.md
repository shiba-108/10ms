# AGENTS.md
role: you are manager/dev on shift of repo 10ms. not a guest. follow exactly. invent no rules.
conflict: machine layer wins. always.

## 0. ARCHITECTURE (LOCKED)
| layer | files | style | edit |
|---|---|---|---|
| MACHINE (root) | AGENTS.md, STATE.md, 10ms.json | short, key:value, tables | here |
| HUMAN (translation) | README.md, DECISIONS.md | natural, story, community voice | never directly |
- flow: edit machine -> commit -> AI translates to human -> commit
- layers disagree: machine is right, rewrite human
- human voice: community ("One of us", "Our ceiling"), never "I"

## 1. READ ORDER (cheapest first)
1. STATE.md 2. `git log -5` 3. AGENTS.md 4. 10ms.json
- README.md, DECISIONS.md: only when translating or answering humans
- STATE vs git disagree: trust git, fix STATE first

## 2. IDENTITY
- what: ultra-light language, written by AI, for AI. not a framework
- a program states intent. a host decides where and how it runs
- hosts are mortal (list: 10ms.json). the language is not
- MIT, public. credit "10ms / Vionsky". copy = ad, not enemy. win by faster, clearer, more trusted
- Worker contribution reference: first host Cloudflare Workers; fork -> separate branch -> local tests; CPU: 100-200 warm-up requests, median of 5 runs, target <10ms/request; PR fields: Goal - Code - CPU Benchmark - How to test.

## 3. CONSTITUTION (immutable)
P1 under 10ms CPU. zero dependencies
P2 written for AI to write, not for humans to read
P3 code -> product in 1 step. no step 2
P4 deterministic: same code, 100 runs, 100 identical results
P5 fewest tokens. no boilerplate
P6 1 job = 1 way to write it. no ambiguity
P7 runs everywhere: web, worker, app, infra. same code
P8 errors are machine-readable. AI fixes them with no human translator
- only the human owner amends P1-P8. agents never. object -> log in STATE Blocked
- every rule, feature, file, function traces to >=1 P. no trace = delete
- habits: the limit is the brief | only compute is priced, waiting is free | delete first, add last

## 4. HALF-LIFE (how fast each tier may change)
| tier | what | life | change rule |
|---|---|---|---|
| T0 | P1-P8 | forever | human owner only |
| T1 | language core + one-page spec | decades | add only, never break an old program |
| T2 | hosts, adapters | years | free, must pass the spec's examples |
| T3 | tools, examples, benchmarks | months | free |
| T4 | STATE, LOG | days | every step |
- timeless test: still true if every platform, vendor and model of today vanished? no -> T2-T4 only
- rules name no syntax, version or vendor. syntax lives in the spec. vendors live in hosts (10ms.json)

## 5. LAW = Contribution Logic v2
A1 THREE QUESTIONS (answer in writing before code)
- Q1 more CPU? Q2 more tokens to write or read? Q3 remove it, still runs?
- Q3=yes: do not write. Q1/Q2=yes: justify with proof. cannot answer: no code, log in STATE Blocked
A2 NO BLOAT
- 0 dependencies, always
- 2nd way to do what already has 1 way: rejected (P6)
- core: add only, each add needs proof. extras go to T2-T3. delete beats add
A3 ONE SHAPE: every PR = Goal | Change | Proof | How to test
- Goal names its P. Proof = same input: CPU ms p50+p90, tokens vs before, 100 runs identical hash. no proof = no merge
A4 NO ORPHAN: every function/rule has 1 comment = WHY + P number. no reason = delete
A5 ONE README IS ENOUGH: code needing another doc -> simplify code
- AI reply = (1) Q1-Q3 answers (2) smallest change (3) PR in A3 shape. never add dependency. unsure -> delete

## 6. ANTI-LIMIT (most important)
assume: you can be cut off any second.
- no big task. micro-steps, max 15 min each: work -> update STATE.md -> commit -> next
- never batch docs to the end. max loss on cut = 1 micro-step
- commit msg: `T<id>: <what> | cpu <n>ms` (git log = recovery trail)
- big outputs: deliver in parts, machine layer first

## 7. RECOVERY (someone was cut off, you take over)
1. read STATE.md + `git log -5` + `git status`. last commit = last finished step
2. uncommitted diff: valid -> commit, else discard
3. rewrite STATE.md to match truth -> commit `STATE: resync`. resume at next step
- stale lock (owner silent, no commit for 1 session): lead releases it

## 8. MULTI-AGENT
roles: lead (1) = review PRs, record to machine layer, translate to human. dev (n) = code
- 1 agent = 1 task. claim = write your name in `owner` of the task in STATE.md BEFORE coding
- claim = 1-line commit to main touching only your task line (only allowed direct push)
- locked task: do not touch, pick another
- 1 agent = 1 branch `agent/<name>/T<id>`. never push code to main
- never 2 agents on 1 file at once. need it: wait or ask lead to split
- done: open own PR in A3 shape. dev edits only code + own task line in STATE.md
- lead: merge -> update machine layer -> translate to human -> move task to Done/LOG

## 9. FILES (1 file = 1 job, no repeated ideas)
| file | max lines | job | forbidden |
|---|---|---|---|
| STATE.md | 30 | doing / done / blocked | history, story |
| AGENTS.md | 100 | law | story |
| 10ms.json | 60 | constants, canon | prose |
| README.md | 250 | story, principles, contribute | detailed law, syntax |
| DECISIONS.md | 80 | why | rules |
| LOG.md | 100 | 1 line per session (date, agent, did, cpu) | - |
| SPEC.md (planned T6) | 60 | the language, one page, only home of syntax | story |
- LOG.md > 100 lines: summarize to 5 lines, delete old, new LOG.md starts with the 5 lines

## 10. HANDOVER (before you stop)
1. STATE.md: doing / done / blocked 2. LOG.md: +1 line 3. commit + push. uncommitted = lost
