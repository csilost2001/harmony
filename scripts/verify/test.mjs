#!/usr/bin/env node
// scripts/verify/ 内 script の自動テスト。
// #1346 case A で導入された regression-trace-check.mjs の parse / 照合 /
// flake 判定ロジックを fixture と stub で検証する。
//
// Usage: node scripts/verify/test.mjs
// Exit code: 0 = pass, 1 = fail

import { readFileSync, mkdtempSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  parseArgs,
  extractFailedTests,
  findTracingIssues,
  sanitizeSpecName,
  checkIsolationEvidence,
  runIsolationLoop,
  evaluate,
} from "./regression-trace-check.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(__dirname, "fixtures");

let pass = 0;
let fail = 0;

function assert(name, cond, detail = "") {
  if (cond) {
    console.log(`  ✓ ${name}`);
    pass++;
  } else {
    console.log(`  ✗ ${name}${detail ? `: ${detail}` : ""}`);
    fail++;
  }
}

function group(title, fn) {
  console.log(`\n• ${title}`);
  fn();
}

// ─────────────────────────────────────────────────────────────
// parseArgs
// ─────────────────────────────────────────────────────────────
group("parseArgs", () => {
  const opt = parseArgs(["results.json", "--flake", "e2e/a.spec.ts", "--flake", "e2e/b.spec.ts", "--verbose"]);
  assert("resultsPath captured", opt.resultsPath === "results.json");
  assert("flakeSpecs collected", opt.flakeSpecs.length === 2 && opt.flakeSpecs[1] === "e2e/b.spec.ts");
  assert("verbose flag", opt.verbose === true);
  assert("default useGh = true", opt.useGh === true);
  assert("default autoRun = false", opt.autoRun === false);

  const opt2 = parseArgs(["--auto-run", "--no-gh", "--json", "--traced", "e2e/x.spec.ts"]);
  assert("autoRun without positional", opt2.autoRun === true && opt2.resultsPath === null);
  assert("--no-gh flips useGh", opt2.useGh === false);
  assert("--json flag", opt2.jsonOutput === true);
  assert("--traced collected", opt2.tracedSpecs[0] === "e2e/x.spec.ts");

  let threw = false;
  try { parseArgs(["--flake"]); } catch (e) { threw = e.message.includes("requires a spec path"); }
  assert("--flake without value throws", threw);

  let threw2 = false;
  try { parseArgs(["--unknown-flag"]); } catch (e) { threw2 = e.message.includes("Unknown option"); }
  assert("unknown option throws", threw2);
});

// ─────────────────────────────────────────────────────────────
// extractFailedTests
// ─────────────────────────────────────────────────────────────
group("extractFailedTests", () => {
  const allPass = JSON.parse(readFileSync(join(FIXTURES, "playwright-report-all-pass.json"), "utf8"));
  assert("all-pass report → empty array", extractFailedTests(allPass).length === 0);

  const mixed = JSON.parse(readFileSync(join(FIXTURES, "playwright-report-mixed.json"), "utf8"));
  const failed = extractFailedTests(mixed);
  assert("mixed report → 3 failures", failed.length === 3, `got ${failed.length}`);

  const presence = failed.find((f) => f.file === "e2e/presence-list.spec.ts");
  assert("presence-list captured", presence !== undefined);
  assert("presence-list line = 110", presence?.line === 110);
  assert("presence-list status = failed", presence?.status === "failed");
  assert("error message captured", presence?.errorMessage?.includes("strict mode") === true);

  const folder = failed.find((f) => f.file === "e2e/folder-picker.spec.ts");
  assert("folder-picker captured as timedOut", folder?.status === "timedOut");
  assert("folder-picker errors[] handled", folder?.errorMessage?.includes("timeout") === true);

  // Edge: malformed input
  assert("null report → empty", extractFailedTests(null).length === 0);
  assert("undefined report → empty", extractFailedTests(undefined).length === 0);
  assert("missing suites → empty", extractFailedTests({}).length === 0);
});

// ─────────────────────────────────────────────────────────────
// findTracingIssues (gh stub)
// ─────────────────────────────────────────────────────────────
group("findTracingIssues with gh stub", () => {
  const stubResults = JSON.stringify([
    { number: 1342, title: "follow-up for e2e/presence-list.spec.ts:110", body: "details", url: "https://x/1342" },
    { number: 1999, title: "unrelated", body: "", url: "https://x/1999" },
  ]);
  const captured = { args: null };
  const runGh = (cmd, args) => {
    captured.args = args;
    return stubResults;
  };
  const matches = findTracingIssues("e2e/presence-list.spec.ts", 110, runGh);
  assert("gh args contain --state open", captured.args?.includes("open") === true);
  assert("gh search arg = basename", captured.args?.[captured.args.indexOf("--search") + 1] === "presence-list.spec.ts");
  assert("only matching issue returned", matches.length === 1 && matches[0].number === 1342);

  // No match scenario
  const runGhEmpty = () => JSON.stringify([{ number: 999, title: "other", body: "no spec ref", url: "" }]);
  const m2 = findTracingIssues("e2e/foo.spec.ts", 10, runGhEmpty);
  assert("non-matching issue filtered out", m2.length === 0);

  // body match
  const runGhBody = () => JSON.stringify([
    { number: 555, title: "general issue", body: "see e2e/foo.spec.ts for repro", url: "" },
  ]);
  const m3 = findTracingIssues("e2e/foo.spec.ts", 1, runGhBody);
  assert("body containing spec path → match", m3.length === 1 && m3[0].number === 555);
});

// ─────────────────────────────────────────────────────────────
// sanitizeSpecName
// ─────────────────────────────────────────────────────────────
group("sanitizeSpecName", () => {
  assert("slash → underscore", sanitizeSpecName("e2e/foo.spec.ts") === "e2e_foo.spec.ts");
  assert("colon → underscore", sanitizeSpecName("foo:bar:baz") === "foo_bar_baz");
  assert("dot preserved", sanitizeSpecName("a.b.c") === "a.b.c");
});

// ─────────────────────────────────────────────────────────────
// checkIsolationEvidence / runIsolationLoop
// ─────────────────────────────────────────────────────────────
group("checkIsolationEvidence", () => {
  const dir = mkdtempSync(join(tmpdir(), "isolation-evidence-"));
  const spec = "e2e/presence-list.spec.ts";
  // 1. file 不存在
  const r1 = checkIsolationEvidence(spec, dir);
  assert("absent evidence → ok=false", r1.ok === false && r1.reason.includes("not found"));

  // 2. invalid JSON
  writeFileSync(join(dir, `isolation-${sanitizeSpecName(spec)}.json`), "{ not json");
  const r2 = checkIsolationEvidence(spec, dir);
  assert("invalid JSON → ok=false", r2.ok === false && r2.reason.includes("not JSON"));

  // 3. runs < 3
  writeFileSync(
    join(dir, `isolation-${sanitizeSpecName(spec)}.json`),
    JSON.stringify({ spec, runs: [{ status: "passed" }, { status: "passed" }] }),
  );
  const r3 = checkIsolationEvidence(spec, dir);
  assert("runs < 3 → ok=false", r3.ok === false && r3.reason.includes("at least"));

  // 4. 3 runs but last has fail
  writeFileSync(
    join(dir, `isolation-${sanitizeSpecName(spec)}.json`),
    JSON.stringify({ spec, runs: [{ status: "passed" }, { status: "passed" }, { status: "failed" }] }),
  );
  const r4 = checkIsolationEvidence(spec, dir);
  assert("last 3 not all pass → ok=false", r4.ok === false && r4.reason.includes("not all passed"));

  // 5. all 3 pass → ok=true
  writeFileSync(
    join(dir, `isolation-${sanitizeSpecName(spec)}.json`),
    JSON.stringify({ spec, runs: [{ status: "passed" }, { status: "passed" }, { status: "passed" }] }),
  );
  const r5 = checkIsolationEvidence(spec, dir);
  assert("3 consecutive pass → ok=true", r5.ok === true);

  // 6. 5 runs with last 3 passed → ok=true (前段の fail があっても last 3 で判定)
  writeFileSync(
    join(dir, `isolation-${sanitizeSpecName(spec)}.json`),
    JSON.stringify({ spec, runs: [{ status: "failed" }, { status: "failed" }, { status: "passed" }, { status: "passed" }, { status: "passed" }] }),
  );
  const r6 = checkIsolationEvidence(spec, dir);
  assert("last 3 pass after earlier fails → ok=true", r6.ok === true);
});

group("runIsolationLoop", () => {
  const dir = mkdtempSync(join(tmpdir(), "isolation-loop-"));
  const spec = "e2e/foo.spec.ts";
  // stub runProc: 3 回連続 passed report を返す
  let calls = 0;
  const stubPass = () => {
    calls++;
    return {
      status: 0,
      stdout: JSON.stringify({ suites: [], stats: { duration: 100 } }),
      stderr: "",
    };
  };
  const r = runIsolationLoop(spec, dir, stubPass, false);
  assert("3 pass runs → ok=true", r.ok === true);
  assert("runProc called 3 times", calls === 3);
  const ev = JSON.parse(readFileSync(r.evidencePath, "utf8"));
  assert("evidence file persisted", ev.runs.length === 3 && ev.runs.every((x) => x.status === "passed"));

  // 2 回目で fail
  let calls2 = 0;
  const stubFail = () => {
    calls2++;
    if (calls2 === 2) {
      return {
        status: 1,
        stdout: JSON.stringify({
          suites: [{ specs: [{ ok: false, file: "e2e/foo.spec.ts", line: 1, tests: [{ results: [{ status: "failed", error: { message: "x" } }] }] }] }],
          stats: { duration: 100 },
        }),
        stderr: "",
      };
    }
    return { status: 0, stdout: JSON.stringify({ suites: [], stats: { duration: 100 } }), stderr: "" };
  };
  const dir2 = mkdtempSync(join(tmpdir(), "isolation-loop-fail-"));
  const r2 = runIsolationLoop(spec, dir2, stubFail, false);
  assert("fail at run 2 → ok=false", r2.ok === false);
  assert("stops early (calls=2)", calls2 === 2);
});

// ─────────────────────────────────────────────────────────────
// evaluate (E2E)
// ─────────────────────────────────────────────────────────────
group("evaluate end-to-end", () => {
  const mixed = JSON.parse(readFileSync(join(FIXTURES, "playwright-report-mixed.json"), "utf8"));
  const loadReport = () => mixed;
  const runRegressionSuite = () => { throw new Error("should not auto-run"); };

  // Scenario A: gh stub returns issue for presence-list, --flake folder-picker (no evidence) → step-ops UNTRACED
  const dir = mkdtempSync(join(tmpdir(), "eval-scenarioA-"));
  const ghStubA = (cmd, args) => {
    const searchTerm = args[args.indexOf("--search") + 1];
    if (searchTerm === "presence-list.spec.ts") {
      return JSON.stringify([{ number: 1342, title: "presence-list strict mode @ e2e/presence-list.spec.ts:110", body: "", url: "" }]);
    }
    return JSON.stringify([]);
  };
  const optA = parseArgs(["dummy", "--flake", "e2e/folder-picker.spec.ts", "--isolation-evidence-dir", dir]);
  const resA = evaluate({
    options: optA,
    loadReport,
    runRegressionSuite,
    runGh: ghStubA,
    runProc: () => ({ status: 1, stdout: "", stderr: "" }),
  });
  assert("3 evaluations", resA.evaluations.length === 3);
  const presenceEv = resA.evaluations.find((e) => e.failed.file === "e2e/presence-list.spec.ts");
  const folderEv = resA.evaluations.find((e) => e.failed.file === "e2e/folder-picker.spec.ts");
  const stepEv = resA.evaluations.find((e) => e.failed.file === "e2e/step-ops.spec.ts");
  assert("presence-list traced via gh", presenceEv?.verdict === "traced");
  assert("folder-picker flake rejected (no evidence)", folderEv?.verdict === "untraced");
  assert("step-ops untraced", stepEv?.verdict === "untraced");
  assert("gateOk = false", resA.gateOk === false);

  // Scenario B: provide isolation evidence for folder-picker, gh trace for step-ops → all green
  const dir2 = mkdtempSync(join(tmpdir(), "eval-scenarioB-"));
  writeFileSync(
    join(dir2, `isolation-${sanitizeSpecName("e2e/folder-picker.spec.ts")}.json`),
    JSON.stringify({ spec: "e2e/folder-picker.spec.ts", runs: [{ status: "passed" }, { status: "passed" }, { status: "passed" }] }),
  );
  const ghStubB = (cmd, args) => {
    const term = args[args.indexOf("--search") + 1];
    if (term === "presence-list.spec.ts") return JSON.stringify([{ number: 1342, title: "tracks e2e/presence-list.spec.ts", body: "", url: "" }]);
    if (term === "step-ops.spec.ts") return JSON.stringify([{ number: 1888, title: "step-ops follow up (e2e/step-ops.spec.ts)", body: "", url: "" }]);
    return JSON.stringify([]);
  };
  const optB = parseArgs(["dummy", "--flake", "e2e/folder-picker.spec.ts", "--isolation-evidence-dir", dir2]);
  const resB = evaluate({
    options: optB,
    loadReport,
    runRegressionSuite,
    runGh: ghStubB,
    runProc: () => ({ status: 1, stdout: "", stderr: "" }),
  });
  assert("B: gateOk = true", resB.gateOk === true);
  assert(
    "B: folder-picker flake confirmed",
    resB.evaluations.find((e) => e.failed.file === "e2e/folder-picker.spec.ts")?.verdict === "flake-confirmed",
  );

  // Scenario C: no failures → gateOk = true, evaluations empty
  const optC = parseArgs(["dummy"]);
  const resC = evaluate({
    options: optC,
    loadReport: () => JSON.parse(readFileSync(join(FIXTURES, "playwright-report-all-pass.json"), "utf8")),
    runRegressionSuite,
    runGh: () => JSON.stringify([]),
    runProc: () => ({ status: 0, stdout: "", stderr: "" }),
  });
  assert("C: no failures → empty evaluations", resC.evaluations.length === 0);
  assert("C: gateOk = true", resC.gateOk === true);

  // Scenario D: --no-gh & no --traced → all UNTRACED unless --flake with evidence
  const optD = parseArgs(["dummy", "--no-gh"]);
  const resD = evaluate({
    options: optD,
    loadReport,
    runRegressionSuite,
    runGh: () => { throw new Error("should not call gh"); },
    runProc: () => ({ status: 0, stdout: "", stderr: "" }),
  });
  assert("D: gateOk = false (all untraced)", resD.gateOk === false);
  assert("D: every verdict = untraced", resD.evaluations.every((e) => e.verdict === "untraced"));

  // Scenario E: --traced manual mark
  const optE = parseArgs(["dummy", "--no-gh", "--traced", "e2e/presence-list.spec.ts", "--traced", "e2e/folder-picker.spec.ts", "--traced", "e2e/step-ops.spec.ts"]);
  const resE = evaluate({
    options: optE,
    loadReport,
    runRegressionSuite,
    runGh: () => { throw new Error("should not call gh"); },
    runProc: () => ({ status: 0, stdout: "", stderr: "" }),
  });
  assert("E: all traced manually → gateOk = true", resE.gateOk === true);
});

// ─────────────────────────────────────────────────────────────
// Result summary
// ─────────────────────────────────────────────────────────────
console.log(`\n────────────────────────────────────────────`);
console.log(`Result: ${pass} pass, ${fail} fail`);
if (fail > 0) process.exit(1);
