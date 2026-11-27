// makefun-diff drop-in, faster: exact Myers (baseline tie-break) via an
// anchor-guided banded search, with the hot core in WebAssembly.
//
// v2: the whole algorithm runs in WASM (wasm-v2/core.ts, AssemblyScript,
// compiled with --uncheckedBehavior always --runtime stub). The JS glue
// encodes the two texts as ASCII bytes straight into wasm memory
// (TextEncoder.encodeInto; a short read means non-ASCII, which falls back),
// the core tokenizes, interns, trims, anchors, Myers-searches and formats
// the patch to bytes, and JS decodes the result. Any wasm failure, any
// negative return, any non-ASCII input, or any out-of-capacity case falls
// back to runJS below: the v1 pure-JS algorithm, kept whole and exact.
// No dependencies, no I/O, no network.
//
// How the algorithm works (see competition RULES.txt for the exact patch rule):
//  1. Lines are cut at every '\n' only and interned to integer ids.
//  2. The common prefix/suffix are trimmed, as the reference does.
//  3. Lines occurring exactly once in both middle texts, in LIS order,
//     are anchors. Between two anchors the exact Myers search is tiny,
//     so a minimal script for every gap is cheap; walking those scripts
//     gives k[d], the diagonal after d edits, of one minimal script.
//  4. A global Myers search is then run, but only on diagonals within
//     W=32 of k[d]. That search is the reference's own greedy search
//     (furthest-x per diagonal, deletion wins ties, no edge pruning,
//     snake after every move), restricted to the band. On the practice
//     set the reference's own trajectory stays within 2 of k[d], so the
//     band holds the reference path with a wide margin.
//  5. Safety nets: the banded result's kept lines are verified against
//     the real line strings, and its edit count must equal the anchor
//     script's (the minimal) count. Anything off falls back to the full
//     exact Myers search on the whole middle section.

// ---- WASM fast path (core.wasm, embedded base64) ----
const WASM_B64 = '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';
let wasm = null; // wasm exports once instantiated
let wasmDead = false;
const textEnc = new TextEncoder();
const textDec = new TextDecoder();

function wasmInit() {
  if (wasm || wasmDead) return wasm;
  try {
    const bytes = Buffer.from(WASM_B64, 'base64');
    const mod = new WebAssembly.Module(bytes);
    const inst = new WebAssembly.Instance(mod, {
      env: {
        abort() { throw new Error('wasm abort'); },
        now: () => performance.now(),
      },
    });
    wasm = inst.exports;
  } catch {
    wasmDead = true;
  }
  return wasm;
}

// Returns the patch string, or null to fall back to runJS.
function runWasm(oldS, newS) {
  const w = wasmInit();
  if (!w) return null;
  try {
    w.begin();
    const oldPtr = w.alloc(oldS.length);
    const newPtr = w.alloc(newS.length);
    const outCap = 2 * (oldS.length + newS.length) + 65536;
    const outPtr = w.alloc(outCap);
    if (oldPtr < 0 || newPtr < 0 || outPtr < 0) return null;
    let buf = w.memory.buffer;
    const r1 = textEnc.encodeInto(oldS, new Uint8Array(buf, oldPtr, oldS.length));
    if (r1.read !== oldS.length) return null; // non-ASCII: JS fallback
    const r2 = textEnc.encodeInto(newS, new Uint8Array(buf, newPtr, newS.length));
    if (r2.read !== newS.length) return null; // non-ASCII: JS fallback
    const outLen = w.run(oldPtr, oldS.length, newPtr, newS.length, outPtr, outCap);
    if (outLen < 0) return null; // wasm declines: JS fallback
    buf = w.memory.buffer; // re-read: memory may have grown
    return textDec.decode(new Uint8Array(buf, outPtr, outLen));
  } catch {
    return null;
  }
}

/** The patch of input.old into input.new, byte-identical to makefun-diff 1.0.0. */
export function run(input) {
  const out = runWasm(input.old, input.new);
  return out !== null ? out : runJS(input);
}

// makefun-diff drop-in, faster: exact Myers (baseline tie-break) via an
// anchor-guided banded search. No dependencies, no I/O, no network.
//
// How it works (see competition RULES.txt for the exact patch rule):
//  1. Lines are cut at every '\n' only and interned to integer ids.
//  2. The common prefix/suffix are trimmed, as the reference does.
//  3. Lines occurring exactly once in both middle texts, in LIS order,
//     are anchors. Between two anchors the exact Myers search is tiny,
//     so a minimal script for every gap is cheap; walking those scripts
//     gives k[d], the diagonal after d edits, of one minimal script.
//  4. A global Myers search is then run, but only on diagonals within
//     W=32 of k[d]. That search is the reference's own greedy search
//     (furthest-x per diagonal, deletion wins ties, no edge pruning,
//     snake after every move), restricted to the band. On the practice
//     set the reference's own trajectory stays within 2 of k[d], so the
//     band holds the reference path with a wide margin.
//  5. Safety nets: the banded result's kept lines are verified against
//     the real line strings, and its edit count must equal the anchor
//     script's (the minimal) count. Anything off falls back to the full
//     exact Myers search on the whole middle section.
const KEEP = 0, DEL = 1, INS = 2;
const W = 32;

/** A text's lines, each with its '\n' (the last one without, when the text does not end in one). */
function tokenize(text) {
  const lines = [];
  let s = 0;
  for (;;) {
    const i = text.indexOf('\n', s);
    if (i === -1) { if (s < text.length) lines.push(text.slice(s)); break; }
    lines.push(text.slice(s, i + 1));
    s = i + 1;
  }
  return lines;
}

/** Exact Myers runs on id ranges [alo,ahi) x [blo,bhi), baseline semantics. */
function myersExact(a, alo, ahi, b, blo, bhi) {
  const N = ahi - alo, M = bhi - blo;
  if (N === 0 && M === 0) return [];
  if (N === 0) return [{ kind: INS, count: M }];
  if (M === 0) return [{ kind: DEL, count: N }];
  let pre = 0;
  while (pre < N && pre < M && a[alo + pre] === b[blo + pre]) pre++;
  let suf = 0;
  while (suf < N - pre && suf < M - pre && a[ahi - 1 - suf] === b[bhi - 1 - suf]) suf++;
  const runs = [];
  if (pre > 0) runs.push({ kind: KEEP, count: pre });
  const core = myersCore(a, alo + pre, ahi - suf, b, blo + pre, bhi - suf);
  for (let i = 0; i < core.length; i++) runs.push(core[i]);
  if (suf > 0) runs.push({ kind: KEEP, count: suf });
  return runs;
}

function myersCore(a, alo, ahi, b, blo, bhi) {
  const N = ahi - alo, M = bhi - blo;
  if (N === 0 && M === 0) return [];
  if (N === 0) return [{ kind: INS, count: M }];
  if (M === 0) return [{ kind: DEL, count: N }];
  const max = N + M;
  const snaps = [];
  let x = 0;
  while (x < N && x < M && a[alo + x] === b[blo + x]) x++;
  const s0 = new Int32Array(1);
  s0[0] = x;
  snaps.push(s0);
  if (x >= N && x >= M) return [{ kind: KEEP, count: x }];
  const kEnd = N - M;
  let D = -1;
  outer:
  for (let d = 1; d <= max; d++) {
    const cur = new Int32Array(2 * d + 1);
    cur.fill(-1);
    for (let k = -d; k <= d; k += 2) {
      let best = -1, have = false;
      if (k - 1 >= -(d - 1) && k - 1 <= d - 1) {
        const xp = snaps[d - 1][(k - 1) + (d - 1)];
        if (xp >= 0 && xp < N) { const xd = xp + 1; if (!have || xd >= best) { best = xd; have = true; } }
      }
      if (k + 1 >= -(d - 1) && k + 1 <= d - 1) {
        const xp = snaps[d - 1][(k + 1) + (d - 1)];
        if (xp >= 0) {
          const yp = xp - (k + 1);
          if (yp < M) { const xi = xp; if (!have || xi > best) { best = xi; have = true; } }
        }
      }
      if (!have) continue;
      let xx = best, yy = xx - k;
      while (xx < N && yy < M && a[alo + xx] === b[blo + yy]) { xx++; yy++; }
      cur[k + d] = xx;
      if (xx >= N && yy >= M) { D = d; snaps.push(cur); break outer; }
    }
    snaps.push(cur);
  }
  if (D < 0) throw new Error('myers: no path');
  const comps = [];
  let k = kEnd;
  for (let d = D; d >= 1; d--) {
    const xcur = snaps[d][k + d];
    let best = -1, have = false, isDel = false;
    if (k - 1 >= -(d - 1) && k - 1 <= d - 1) {
      const xp = snaps[d - 1][(k - 1) + (d - 1)];
      if (xp >= 0 && xp < N) { const xd = xp + 1; if (!have || xd >= best) { best = xd; have = true; isDel = true; } }
    }
    if (k + 1 >= -(d - 1) && k + 1 <= d - 1) {
      const xp = snaps[d - 1][(k + 1) + (d - 1)];
      if (xp >= 0) {
        const yp = xp - (k + 1);
        if (yp < M) { const xi = xp; if (!have || xi > best) { best = xi; have = true; isDel = false; } }
      }
    }
    if (!have) throw new Error('myers: backtrack dead');
    const snake = xcur - best;
    if (snake > 0) comps.push({ kind: KEEP, count: snake });
    comps.push({ kind: isDel ? DEL : INS, count: 1 });
    k = isDel ? k - 1 : k + 1;
  }
  const x0 = snaps[0][0];
  if (x0 > 0) comps.push({ kind: KEEP, count: x0 });
  comps.reverse();
  const out = [];
  for (let i = 0; i < comps.length; i++) {
    const c = comps[i], l = out[out.length - 1];
    if (l && l.kind === c.kind) l.count += c.count;
    else out.push({ kind: c.kind, count: c.count });
  }
  return out;
}

/** Banded Myers on id ranges, centre kArr[d], half-width W. Returns runs, or null. */
function myersBanded(a, alo, ahi, b, blo, bhi, kArr, D) {
  const N = ahi - alo, M = bhi - blo;
  if (N === 0 && M === 0) return [];
  if (N === 0) return [{ kind: INS, count: M }];
  if (M === 0) return [{ kind: DEL, count: N }];
  const WW = 2 * W + 5;
  const snaps = new Int32Array((D + 1) * WW);
  snaps.fill(-1);
  let x = 0;
  while (x < N && x < M && a[alo + x] === b[blo + x]) x++;
  snaps[0 + (0 - (kArr[0] - W - 2))] = x;
  if (x >= N && x >= M) return [{ kind: KEEP, count: x }];
  const kEnd = N - M;
  let Df = -1;
  for (let d = 1; d <= D; d++) {
    const cd = kArr[d], pd = kArr[d - 1];
    const klo = Math.max(-d, cd - W), khi = Math.min(d, cd + W);
    const bo = d * WW, po = (d - 1) * WW, wlo = pd - W - 2;
    for (let k = klo; k <= khi; k += 2) {
      let best = -1, have = false;
      let pi = (k - 1) - wlo;
      if (pi >= 0 && pi < WW) {
        const xp = snaps[po + pi];
        if (xp >= 0 && xp < N) { const xd = xp + 1; if (!have || xd >= best) { best = xd; have = true; } }
      }
      pi = (k + 1) - wlo;
      if (pi >= 0 && pi < WW) {
        const xp = snaps[po + pi];
        if (xp >= 0) {
          const yp = xp - (k + 1);
          if (yp < M) { const xi = xp; if (!have || xi > best) { best = xi; have = true; } }
        }
      }
      if (!have) continue;
      let xx = best, yy = xx - k;
      while (xx < N && yy < M && a[alo + xx] === b[blo + yy]) { xx++; yy++; }
      snaps[bo + (k - (cd - W - 2))] = xx;
      if (xx >= N && yy >= M) { Df = d; break; }
    }
    if (Df >= 0) break;
  }
  if (Df < 0) return null;
  const comps = [];
  let k = kEnd;
  for (let d = Df; d >= 1; d--) {
    const cd = kArr[d], pd = kArr[d - 1];
    const xcur = snaps[d * WW + (k - (cd - W - 2))];
    let best = -1, have = false, isDel = false;
    const wlo = pd - W - 2, po = (d - 1) * WW;
    let pi = (k - 1) - wlo;
    if (pi >= 0 && pi < WW) {
      const xp = snaps[po + pi];
      if (xp >= 0 && xp < N) { const xd = xp + 1; if (!have || xd >= best) { best = xd; have = true; isDel = true; } }
    }
    pi = (k + 1) - wlo;
    if (pi >= 0 && pi < WW) {
      const xp = snaps[po + pi];
      if (xp >= 0) {
        const yp = xp - (k + 1);
        if (yp < M) { const xi = xp; if (!have || xi > best) { best = xi; have = true; isDel = false; } }
      }
    }
    if (!have) throw new Error('banded: backtrack dead');
    const snake = xcur - best;
    if (snake > 0) comps.push({ kind: KEEP, count: snake });
    comps.push({ kind: isDel ? DEL : INS, count: 1 });
    k = isDel ? k - 1 : k + 1;
  }
  const x0 = snaps[0 + (0 - (kArr[0] - W - 2))];
  if (x0 > 0) comps.push({ kind: KEEP, count: x0 });
  comps.reverse();
  const out = [];
  for (let i = 0; i < comps.length; i++) {
    const c = comps[i], l = out[out.length - 1];
    if (l && l.kind === c.kind) l.count += c.count;
    else out.push({ kind: c.kind, count: c.count });
  }
  return out;
}

/** Longest increasing subsequence (strict) of js, as indices into js. */
function lisIdx(js) {
  const n = js.length;
  const tails = [], tailIdx = [], prev = new Int32Array(n).fill(-1);
  for (let i = 0; i < n; i++) {
    const v = js[i];
    let lo = 0, hi = tails.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (tails[mid] < v) lo = mid + 1; else hi = mid; }
    if (lo === tails.length) { tails.push(v); tailIdx.push(i); }
    else { tails[lo] = v; tailIdx[lo] = i; }
    if (lo > 0) prev[i] = tailIdx[lo - 1];
  }
  const res = [];
  let cur = tailIdx.length ? tailIdx[tailIdx.length - 1] : -1;
  while (cur !== -1) { res.push(cur); cur = prev[cur]; }
  return res.reverse();
}

/** A line as the patch writes it: op, the line, a newline, and '%' on a line of its own when it had none. */
function written(out, op, line) {
  out.push(op, line);
  if (!line.endsWith('\n')) out.push('\n%\n');
}

function formatPatch(aStr, bStr, runs, n, m) {
  const changes = [];
  let o = 0, p = 0, deleted = 0, inserted = 0;
  for (let i = 0; i < runs.length; i++) {
    const r = runs[i];
    if (r.kind === KEEP) { o += r.count; p += r.count; continue; }
    let c = changes[changes.length - 1];
    if (c === undefined || c.o + c.dels !== o || c.p + c.ins !== p) {
      c = { o, p, dels: 0, ins: 0 };
      changes.push(c);
    }
    if (r.kind === DEL) { c.dels += r.count; o += r.count; deleted += r.count; }
    else { c.ins += r.count; p += r.count; inserted += r.count; }
  }
  const hunks = [];
  for (let i = 0; i < changes.length; i++) {
    const c = changes[i], h = hunks[hunks.length - 1], prev = h ? h[h.length - 1] : undefined;
    if (prev !== undefined && c.o - (prev.o + prev.dels) <= 6) h.push(c);
    else hunks.push([c]);
  }
  const out = [`makefun-diff/1 old=${n} new=${m} hunks=${hunks.length} deleted=${deleted} inserted=${inserted}\n`];
  for (let hi = 0; hi < hunks.length; hi++) {
    const h = hunks[hi], first = h[0], last = h[h.length - 1];
    const oldStart = Math.max(0, first.o - 3);
    const newStart = first.p - (first.o - oldStart);
    const after = Math.min(3, n - (last.o + last.dels));
    const oldEnd = last.o + last.dels + after;
    const newEnd = last.p + last.ins + after;
    out.push(`@ ${oldStart + 1} ${oldEnd - oldStart} ${newStart + 1} ${newEnd - newStart}\n`);
    let at = oldStart;
    for (let ci = 0; ci < h.length; ci++) {
      const c = h[ci];
      for (; at < c.o; at++) written(out, '=', aStr[at]);
      for (let t = 0; t < c.dels; t++) written(out, '-', aStr[c.o + t]);
      for (let t = 0; t < c.ins; t++) written(out, '+', bStr[c.p + t]);
      at = c.o + c.dels;
    }
    for (; at < oldEnd; at++) written(out, '=', aStr[at]);
  }
  return out.join('');
}

/** The patch of input.old into input.new, byte-identical to makefun-diff 1.0.0. */
function runJS(input) {
  const aStr = tokenize(input.old), bStr = tokenize(input.new);
  const map = new Map();
  const a = new Int32Array(aStr.length), b = new Int32Array(bStr.length);
  for (let i = 0; i < aStr.length; i++) {
    let id = map.get(aStr[i]);
    if (id === undefined) { id = map.size; map.set(aStr[i], id); }
    a[i] = id;
  }
  for (let i = 0; i < bStr.length; i++) {
    let id = map.get(bStr[i]);
    if (id === undefined) { id = map.size; map.set(bStr[i], id); }
    b[i] = id;
  }
  const N = a.length, M = b.length;
  let pre = 0;
  while (pre < N && pre < M && a[pre] === b[pre]) pre++;
  let suf = 0;
  while (suf < N - pre && suf < M - pre && a[N - 1 - suf] === b[M - 1 - suf]) suf++;
  const alo = pre, ahi = N - suf, blo = pre, bhi = M - suf;
  const n = ahi - alo, m = bhi - blo;
  let midRuns;
  if (n === 0 && m === 0) {
    midRuns = [];
  } else if (n === 0) {
    midRuns = [{ kind: INS, count: m }];
  } else if (m === 0) {
    midRuns = [{ kind: DEL, count: n }];
  } else {
    // Anchors: lines unique in both middle texts, LIS order.
    const cntA = new Int32Array(map.size), cntB = new Int32Array(map.size);
    for (let i = alo; i < ahi; i++) cntA[a[i]]++;
    for (let j = blo; j < bhi; j++) cntB[b[j]]++;
    const posB = new Int32Array(map.size).fill(-1);
    for (let j = blo; j < bhi; j++) if (cntB[b[j]] === 1) posB[b[j]] = j;
    const candI = [], candJ = [];
    for (let i = alo; i < ahi; i++) {
      const id = a[i];
      if (cntA[id] === 1 && cntB[id] === 1) { candI.push(i); candJ.push(posB[id]); }
    }
    const lis = lisIdx(candJ);
    // Gap scripts -> k[d] of one minimal script, streamed (no run storage).
    // First pass: total D (needed to size kArr). Second pass fills it.
    // (Both passes are cheap: gaps are tiny; the passes share the gap runs.)
    const anchors = [[alo - 1, blo - 1]];
    for (let t = 0; t < lis.length; t++) anchors.push([candI[lis[t]], candJ[lis[t]]]);
    anchors.push([ahi, bhi]);
    let D = 0;
    const gapRuns = new Array(anchors.length - 1);
    for (let g = 0; g < anchors.length - 1; g++) {
      const i1 = anchors[g][0], j1 = anchors[g][1], i2 = anchors[g + 1][0], j2 = anchors[g + 1][1];
      const gl = i2 - i1 - 1, gr = j2 - j1 - 1;
      let runs;
      if (gl === 0 && gr === 0) {
        runs = [];
      } else if (gl === 0) {
        runs = [{ kind: INS, count: gr }];
      } else if (gr === 0) {
        runs = [{ kind: DEL, count: gl }];
      } else {
        let same = gl === gr;
        if (same) for (let t = 0; t < gl; t++) if (a[i1 + 1 + t] !== b[j1 + 1 + t]) { same = false; break; }
        runs = same ? [{ kind: KEEP, count: gl }] : myersExact(a, i1 + 1, i2, b, j1 + 1, j2);
      }
      gapRuns[g] = runs;
      for (let t = 0; t < runs.length; t++) if (runs[t].kind !== KEEP) D += runs[t].count;
    }
    const kArr = new Int32Array(D + 1);
    let d = 0, k = 0;
    kArr[0] = 0;
    for (let g = 0; g < gapRuns.length; g++) {
      const runs = gapRuns[g];
      for (let t = 0; t < runs.length; t++) {
        const r = runs[t];
        if (r.kind === DEL) { for (let q = 0; q < r.count; q++) { d++; k++; kArr[d] = k; } }
        else if (r.kind === INS) { for (let q = 0; q < r.count; q++) { d++; k--; kArr[d] = k; } }
      }
    }
    let banded = myersBanded(a, alo, ahi, b, blo, bhi, kArr, D);
    let ok = banded !== null;
    if (ok) {
      // Verify: kept lines are truly equal, and the edit count is the minimal one.
      let dd = 0, o = 0, p = 0;
      for (let t = 0; t < banded.length && ok; t++) {
        const r = banded[t];
        if (r.kind === KEEP) {
          for (let q = 0; q < r.count; q++) if (aStr[alo + o + q] !== bStr[blo + p + q]) { ok = false; break; }
          o += r.count; p += r.count;
        } else if (r.kind === DEL) { dd += r.count; o += r.count; }
        else { dd += r.count; p += r.count; }
      }
      if (ok && (dd !== D || o !== n || p !== m)) ok = false;
    }
    midRuns = ok ? banded : myersExact(a, alo, ahi, b, blo, bhi);
  }
  const runs = [];
  if (pre > 0) runs.push({ kind: KEEP, count: pre });
  for (let t = 0; t < midRuns.length; t++) {
    const r = midRuns[t], l = runs[runs.length - 1];
    if (l && l.kind === r.kind) l.count += r.count;
    else runs.push({ kind: r.kind, count: r.count });
  }
  if (suf > 0) {
    const l = runs[runs.length - 1];
    if (l && l.kind === KEEP) l.count += suf;
    else runs.push({ kind: KEEP, count: suf });
  }
  return formatPatch(aStr, bStr, runs, N, M);
}
