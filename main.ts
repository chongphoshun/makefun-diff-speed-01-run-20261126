// makefun-diff 1.0.0, the house entry, make.fun's own reference program: the harness runs `node /bot/main.ts` (node22). It reads every case from /input/cases.json (a JSON
// array of {id, input}), answers each one alone with run() from solve.js, and writes /output/answers.json: a JSON
// array of the answers, one per case and in the cases' order. An entry keeps this driver and replaces solve.js with a
// faster module whose run(input) returns the same answer for every input. Outside a container MAKEFUN_INPUT_DIR and MAKEFUN_OUTPUT_DIR stand in for /input and /output.
// This copy is verbatim from the kit's baseline driver (baselines/makefun-diff/main.ts), except the v3 driver first
// tries solve.js's zero-copy whole-file path (runAll): the raw cases.json bytes go into WASM, which parses the JSON,
// diffs every case and emits the answers.json bytes directly. Any decline falls back to the baseline flow
// (JSON.parse + run per case + JSON.stringify). The speed-up lives entirely in solve.js.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setFlagsFromString } from 'node:v8';

// V8's incremental marking off, set before solve.js is imported so all of its work runs under it (the rules: the house
// baseline runs with --no-incremental-marking, and an entry may tune V8's flags too).
setFlagsFromString('--no-incremental-marking');

/** solve.js, imported by its URL (a .js module carries no types) and typed by its contract. */
const solve = (await import(new URL('./solve.js', import.meta.url).href)) as {
  run: (input: unknown) => unknown;
  runAll?: (buf: Uint8Array) => Uint8Array | null;
};

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

const raw = readFileSync(join(INPUT_DIR, 'cases.json'));
let done = false;
if (typeof solve.runAll === 'function') {
  try {
    const out = solve.runAll(raw);
    if (out !== null && out !== undefined) {
      writeFileSync(join(OUTPUT_DIR, 'answers.json'), out);
      done = true;
    }
  } catch {
    // fall through to the baseline flow below
  }
}
if (!done) {
  const cases = JSON.parse(raw.toString('utf8')) as { id: string; input: unknown }[];
  const answers: unknown[] = [];
  for (const c of cases) answers.push(solve.run(c.input));
  writeFileSync(join(OUTPUT_DIR, 'answers.json'), JSON.stringify(answers));
}
