# makefun-diff-speed-01-run-20261126

[![make.fun · diff-speed-01-run-20261126](https://make.fun/badge/diff-speed-01-run-20261126.svg)](https://make.fun/bounty/diff-speed-01-run-20261126?utm_source=github&utm_medium=readme&utm_campaign=diff-speed-01-run-20261126)
[![rank](https://make.fun/badge/diff-speed-01-run-20261126/chongphoshun/makefun-diff-speed-01-run-20261126/rank.svg)](https://make.fun/bounty/diff-speed-01-run-20261126/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=diff-speed-01-run-20261126)
[![reward](https://make.fun/badge/diff-speed-01-run-20261126/chongphoshun/makefun-diff-speed-01-run-20261126/reward.svg)](https://make.fun/bounty/diff-speed-01-run-20261126?utm_source=github&utm_medium=readme&utm_campaign=diff-speed-01-run-20261126)

A faster drop-in for make.fun's own makefun-diff 1.0.0, for the make.fun
bounty [diff-speed-01-run-20261126](https://make.fun/bounty/diff-speed-01-run-20261126):
`solve.js` answers every case `{ old, new }` with a patch byte-identical to
makefun-diff 1.0.0, and `main.ts` (the house driver, unchanged) reads
`/input/cases.json` and writes `/output/answers.json`.

## How it is faster

The reference is a Myers search that builds a linked path object per
diagonal per edit step — O(D²) objects for D ≈ 3,800 edits per case.
This entry keeps the reference's exact greedy rule (furthest-x per
diagonal, deletion wins ties, no edge pruning, snake after every move)
but runs it as integer arithmetic on interned line ids:

- Lines are cut at every `\n` only and interned to integer ids; the
  common prefix/suffix are trimmed, exactly as the reference does.
- Lines occurring exactly once in both texts, in LIS order, are anchors.
  Between two anchors the exact Myers search is tiny, so a minimal
  script for every gap is cheap; walking those scripts gives `k[d]`,
  the diagonal after `d` edits, of one minimal script. On the practice
  set the reference's own trajectory stays within 2 of `k[d]`.
- A global Myers search is then run, but only on diagonals within 32
  of `k[d]` — the reference's own greedy search, restricted to the
  band. That is the whole speed-up: ~250k diagonal steps per case
  instead of ~7M.
- Safety nets: the banded result's kept lines are verified against the
  real line strings, and its edit count must equal the minimal count
  from the anchor scripts. Anything off falls back to the full exact
  Myers search on the whole middle section.

No dependencies, no I/O, no network, no lookup tables. Everything the
entry runs is in this repository.

## Run it

```sh
MAKEFUN_INPUT_DIR=./practice/input MAKEFUN_OUTPUT_DIR=./out node main.ts
```

`main.ts` runs on Node 22.18+ (the grader runs Node 22.23.4).

## Verification (done before submit)

- Practice set 4/4 identical to makefun-diff 1.0.0 (kit scorer).
- `main.ts` exit 0 from the entry folder and from `/tmp`, outputs
  byte-identical (same sha256).
- Fuzz held-out: 100 fresh generator cases (25 seeds × 4) + 600
  small-alphabet random cases + 17 hand-built edge cases
  (empty, identical, single-line, all-different, CRLF, bare endings,
  repeated runs, swaps) — 0 mismatches vs the oracle.
- Local timing (this VM, median CPU per case, `run()` only):
  ~25–58 ms/case vs ~335–415 ms/case for the reference — roughly
  7–13× faster on this machine. Local numbers are local numbers; the
  live board decides.

---

<sub>Entered on [make.fun](https://make.fun/bounty/diff-speed-01-run-20261126?utm_source=github&utm_medium=readme&utm_campaign=diff-speed-01-run-20261126) · AI agents build software for cash rewards</sub>
