#!/usr/bin/env node
// scripts/verify/ 内 script の自動テスト。
// #1346 case A で導入された regression-trace-check.mjs の parse / 照合 /
// flake 判定ロジックを fixture と stub で検証する。
//
// Usage: node scripts/verify/test.mjs
// Exit code: 0 = pass, 1 = fail

import { readFileSync, mkdtempSync, writeFileSync, mkdirSync, existsSync, cpSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { countOutlineNone } from "./no-new-outline-none.mjs";
import { scanText } from "./no-secrets.mjs";
import { measure as measureHygiene } from "./hygiene.mjs";
import { licenseOk, latestLts } from "../dev/deps-report.mjs";
import {
  parseArgs,
  extractFailedTests,
  findTracingIssues,
  sanitizeSpecName,
  checkIsolationEvidence,
  runIsolationLoop,
  isStrictModeViolation,
  checkIssueState,
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

async function group(title, fn) {
  console.log(`\n• ${title}`);
  // 同期の試験は、その場で最後まで動く。非同期の試験は、呼び出し側が await する。例外は失敗として数える
  try { await fn(); } catch (e) { fail++; console.log(`  ✗ (群の途中で例外) ${e && e.stack ? e.stack.split("\n").slice(0, 3).join(" / ") : e}`); }
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

  const opt2 = parseArgs(["--auto-run", "--no-gh", "--json", "--traced", "e2e/x.spec.ts:1234"]);
  assert("autoRun without positional", opt2.autoRun === true && opt2.resultsPath === null);
  assert("--no-gh flips useGh", opt2.useGh === false);
  assert("--json flag", opt2.jsonOutput === true);
  assert(
    "--traced collected as TracedRef",
    opt2.tracedSpecs[0]?.spec === "e2e/x.spec.ts" && opt2.tracedSpecs[0]?.issueNumber === 1234,
  );

  let threw = false;
  try { parseArgs(["--flake"]); } catch (e) { threw = e.message.includes("requires a spec path"); }
  assert("--flake without value throws", threw);

  let threw2 = false;
  try { parseArgs(["--unknown-flag"]); } catch (e) { threw2 = e.message.includes("Unknown option"); }
  assert("unknown option throws", threw2);

  // --traced format requirements
  let threwT1 = false;
  try { parseArgs(["dummy", "--traced", "e2e/foo.spec.ts"]); }
  catch (e) { threwT1 = e.message.includes("<issue#>"); }
  assert("--traced without issue# throws", threwT1);

  let threwT2 = false;
  try { parseArgs(["dummy", "--traced", "e2e/foo.spec.ts:abc"]); }
  catch (e) { threwT2 = e.message.includes("<issue#>"); }
  assert("--traced non-numeric issue throws", threwT2);

  let threwT3 = false;
  try { parseArgs(["dummy", "--traced", "e2e/foo.spec.ts:0"]); }
  catch (e) { threwT3 = e.message.includes("positive safe integer"); }
  assert("--traced zero issue throws", threwT3);

  // unsafe integer rejection (#1346 Codex Round 2 Nit guard)
  let threwT4 = false;
  try { parseArgs(["dummy", "--traced", "e2e/foo.spec.ts:9007199254740993"]); }
  catch (e) { threwT4 = e.message.includes("safe integer"); }
  assert("--traced > MAX_SAFE_INTEGER throws", threwT4);

  // ok-path: large but safe integer
  const optLarge = parseArgs(["dummy", "--traced", "e2e/foo.spec.ts:9007199254740991"]);
  assert(
    "--traced MAX_SAFE_INTEGER accepted",
    optLarge.tracedSpecs[0]?.issueNumber === Number.MAX_SAFE_INTEGER,
  );

  // Windows-style paths: regex takes last `:<digits>` so backslash paths work
  const optWin = parseArgs(["dummy", "--traced", "e2e\\foo.spec.ts:42"]);
  assert(
    "--traced Windows path parsed (last :<digits> wins)",
    optWin.tracedSpecs[0]?.spec === "e2e\\foo.spec.ts" && optWin.tracedSpecs[0]?.issueNumber === 42,
  );
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
// isStrictModeViolation (#1346 case C 機械化)
// ─────────────────────────────────────────────────────────────
group("isStrictModeViolation", () => {
  assert(
    "canonical Playwright message detected",
    isStrictModeViolation("Error: strict mode violation: locator('.btn') resolved to 3 elements"),
  );
  assert(
    "loose match (just 'strict mode')",
    isStrictModeViolation("got strict mode error from playwright"),
  );
  assert(
    "resolved to N elements fallback",
    isStrictModeViolation("Locator resolved to 2 elements: foo, bar"),
  );
  assert("regular timeout not strict-mode", isStrictModeViolation("Test timeout of 30000ms exceeded") === false);
  assert("null / undefined safe", isStrictModeViolation(null) === false && isStrictModeViolation(undefined) === false);
  assert("empty string safe", isStrictModeViolation("") === false);
});

// ─────────────────────────────────────────────────────────────
// checkIssueState (gh issue view stub)
// ─────────────────────────────────────────────────────────────
group("checkIssueState", () => {
  const ghOpen = () => "OPEN\n";
  const ghClosed = () => "CLOSED\n";
  const ghEmpty = () => "";
  const ghThrow = () => { throw new Error("gh: issue not found"); };
  const ghOther = () => "DRAFT\n";

  assert("OPEN state", checkIssueState(1234, ghOpen) === "OPEN");
  assert("CLOSED state", checkIssueState(1234, ghClosed) === "CLOSED");
  assert("empty output → null", checkIssueState(1234, ghEmpty) === null);
  assert("gh throws → null", checkIssueState(1234, ghThrow) === null);
  assert("unknown state → null", checkIssueState(1234, ghOther) === null);

  // Validate args
  let captured;
  const ghCapture = (cmd, args) => { captured = { cmd, args }; return "OPEN"; };
  checkIssueState(1346, ghCapture);
  assert("gh issue view called", captured?.args?.[0] === "issue" && captured?.args?.[1] === "view" && captured?.args?.[2] === "1346");
  assert("gh --jq .state passed", captured?.args?.includes("--jq") && captured?.args?.includes(".state"));
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

  // Scenario E: --traced manual mark with issue numbers (--no-gh, skip OPEN check)
  const optE = parseArgs([
    "dummy", "--no-gh",
    "--traced", "e2e/presence-list.spec.ts:1342",
    "--traced", "e2e/folder-picker.spec.ts:9999",
    "--traced", "e2e/step-ops.spec.ts:8888",
  ]);
  const resE = evaluate({
    options: optE,
    loadReport,
    runRegressionSuite,
    runGh: () => { throw new Error("should not call gh"); },
    runProc: () => ({ status: 0, stdout: "", stderr: "" }),
  });
  assert("E: all traced manually (no-gh) → gateOk = true", resE.gateOk === true);
  const presenceE = resE.evaluations.find((ev) => ev.failed.file === "e2e/presence-list.spec.ts");
  assert(
    "E: tracingIssues contains #1342 from --traced",
    presenceE?.tracingIssues?.[0]?.number === 1342,
  );

  // Scenario F: strict-mode violation + --flake + isolation evidence → still UNTRACED (case C)
  const dirF = mkdtempSync(join(tmpdir(), "eval-scenarioF-"));
  writeFileSync(
    join(dirF, `isolation-${sanitizeSpecName("e2e/presence-list.spec.ts")}.json`),
    JSON.stringify({
      spec: "e2e/presence-list.spec.ts",
      runs: [{ status: "passed" }, { status: "passed" }, { status: "passed" }],
    }),
  );
  const optF = parseArgs([
    "dummy", "--no-gh",
    "--flake", "e2e/presence-list.spec.ts",
    "--flake", "e2e/folder-picker.spec.ts",
    "--flake", "e2e/step-ops.spec.ts",
    "--isolation-evidence-dir", dirF,
  ]);
  // Also provide isolation evidence for folder-picker and step-ops (these are NOT strict-mode)
  writeFileSync(
    join(dirF, `isolation-${sanitizeSpecName("e2e/folder-picker.spec.ts")}.json`),
    JSON.stringify({
      spec: "e2e/folder-picker.spec.ts",
      runs: [{ status: "passed" }, { status: "passed" }, { status: "passed" }],
    }),
  );
  writeFileSync(
    join(dirF, `isolation-${sanitizeSpecName("e2e/step-ops.spec.ts")}.json`),
    JSON.stringify({
      spec: "e2e/step-ops.spec.ts",
      runs: [{ status: "passed" }, { status: "passed" }, { status: "passed" }],
    }),
  );
  const resF = evaluate({
    options: optF,
    loadReport,
    runRegressionSuite,
    runGh: () => { throw new Error("should not call gh"); },
    runProc: () => ({ status: 0, stdout: "", stderr: "" }),
  });
  const presenceF = resF.evaluations.find((ev) => ev.failed.file === "e2e/presence-list.spec.ts");
  assert(
    "F: strict-mode failure with isolation evidence → UNTRACED (case C guard)",
    presenceF?.verdict === "untraced" && presenceF?.detail?.includes("strict-mode") === true,
  );
  const folderF = resF.evaluations.find((ev) => ev.failed.file === "e2e/folder-picker.spec.ts");
  assert(
    "F: non strict-mode timedOut + isolation 3x pass → flake-confirmed",
    folderF?.verdict === "flake-confirmed",
  );
  assert(
    "F: gateOk = false (strict-mode 1 件 untraced)",
    resF.gateOk === false,
  );

  // Scenario G: --traced with gh validation (OPEN / CLOSED) — uses useGh path
  const optG_open = parseArgs(["dummy", "--traced", "e2e/presence-list.spec.ts:1342"]);
  // For this test, treat folder-picker / step-ops as gh-traced via title match (or via --traced too)
  const optG_open2 = parseArgs([
    "dummy",
    "--traced", "e2e/presence-list.spec.ts:1342",
    "--traced", "e2e/folder-picker.spec.ts:9999",
    "--traced", "e2e/step-ops.spec.ts:8888",
  ]);
  // gh stub: 1342 = OPEN, 9999 / 8888 = OPEN as well
  const ghAllOpen = (cmd, args) => {
    if (args[1] === "view") return "OPEN";
    return "[]";
  };
  const resG_open = evaluate({
    options: optG_open2,
    loadReport,
    runRegressionSuite,
    runGh: ghAllOpen,
    runProc: () => ({ status: 0, stdout: "", stderr: "" }),
  });
  assert("G-open: all OPEN issue traces → gateOk = true", resG_open.gateOk === true);

  // gh stub: 1342 = CLOSED
  const ghClosedForPresence = (cmd, args) => {
    if (args[1] === "view") {
      const issueNum = args[2];
      if (issueNum === "1342") return "CLOSED";
      return "OPEN";
    }
    return "[]";
  };
  const resG_closed = evaluate({
    options: optG_open2,
    loadReport,
    runRegressionSuite,
    runGh: ghClosedForPresence,
    runProc: () => ({ status: 0, stdout: "", stderr: "" }),
  });
  const presenceG = resG_closed.evaluations.find((ev) => ev.failed.file === "e2e/presence-list.spec.ts");
  assert(
    "G-closed: CLOSED issue rejected as traced",
    presenceG?.verdict === "untraced" && presenceG?.detail?.includes("CLOSED"),
  );
  assert("G-closed: gateOk = false", resG_closed.gateOk === false);
});

// ─────────────────────────────────────────────────────────────
// check-design.mjs (設計書の要確認事項をコマンドで検査)
// ─────────────────────────────────────────────────────────────
group("check-design", () => {
  const repo = resolve(__dirname, "../..");
  const run = (...args) => spawnSync("node", ["scripts/check-design.mjs", ...args], { cwd: repo, encoding: "utf8" });
  const retail = run("examples/retail", "--strict");
  assert("retail (警告なし) は --strict でも終了コード 0", retail.status === 0, retail.stdout + retail.stderr);
  assert("--json は構造化して返す", (() => { try { const j = JSON.parse(run("examples/retail", "--json").stdout); return j.summary.error === 0 && Array.isArray(j.issues); } catch { return false; } })());
  assert("使い方の誤り (引数なし) は終了コード 2", run().status === 2);
  assert("harmony.json がない場所は終了コード 2", run("examples").status === 2);

  const tmp = mkdtempSync(join(tmpdir(), "check-design-"));
  try {
    const ws = join(tmp, "retail");
    cpSync(join(repo, "examples/retail"), ws, { recursive: true });
    writeFileSync(join(ws, "harmony/reports/broken.json"), "{ not json");
    const broken = run(ws);
    assert("壊れた JSON は error として終了コード 1", broken.status === 1 && broken.stdout.includes("broken.json"), broken.stdout);
    // 警告は既定では失敗にせず、--strict で失敗にする
    const rp = JSON.parse(readFileSync(join(ws, "harmony/reports/delivery-note.json"), "utf8"));
    rmSync(join(ws, "harmony/reports/broken.json"));
    rp.sections.find((x) => x.kind === "detail").fields.push({ id: "noSrc", label: "出どころなし", kind: "field" });
    writeFileSync(join(ws, "harmony/reports/delivery-note.json"), JSON.stringify(rp));
    assert("警告だけなら既定は終了コード 0", run(ws).status === 0);
    assert("警告は --strict で終了コード 1", run(ws, "--strict").status === 1);

    // harmony.json に登録されていないテーブルは、設計書・検査に含めたうえで、情報として知らせる (#1487。警告ではないので --strict でも失敗にしない)
    writeFileSync(join(ws, "harmony/reports/delivery-note.json"), JSON.stringify(JSON.parse(readFileSync(join(repo, "examples/retail/harmony/reports/delivery-note.json"), "utf8"))));
    const hj = JSON.parse(readFileSync(join(ws, "harmony.json"), "utf8"));
    const droppedTable = hj.entities.tables.shift();
    writeFileSync(join(ws, "harmony.json"), JSON.stringify(hj));
    const unreg = run(ws, "--strict", "--info");
    assert("未登録のテーブルは、検査に含めたうえで、情報として理由が出る (--strict でも失敗にしない)", unreg.status === 0 && unreg.stdout.includes(droppedTable.id) && unreg.stdout.includes("一覧に載っていません"), unreg.stdout);
    hj.entities.tables.unshift(droppedTable);
    writeFileSync(join(ws, "harmony.json"), JSON.stringify(hj));

    // design-check.json: 抑制は要確認を外し、独自ルールの違反は要確認に出る。読めない項目は警告、JSON が壊れていれば error
    const checkFile = join(ws, "harmony/design-check.json");
    const issueMsg = JSON.parse(run(ws, "--json", "--info").stdout).issues.find((i) => i.section.startsWith("CRUD"));
    assert("(前提) CRUD の所見がある", !!issueMsg);
    const rules = { version: 1, suppressions: [], rules: [{ id: "tbl-prefix", name: "テーブルは zz_ で始める", target: "table", path: "physicalName", check: { type: "pattern", pattern: "^zz_" }, severity: "warning" }] };
    writeFileSync(checkFile, JSON.stringify(rules));
    const ruled = run(ws, "--strict");
    assert("独自ルールの違反は要確認に出て、--strict で終了コード 1", ruled.status === 1 && ruled.stdout.includes("ルール「テーブルは zz_ で始める」"), ruled.stdout);
    writeFileSync(checkFile, JSON.stringify({ version: 1, suppressions: [{ key: "i-0000000000000000", reason: "", at: "x", severity: "warning" }], rules: [] }));
    const bad = run(ws, "--strict");
    assert("読めない項目 (理由が空の抑制) は、警告として知らせる", bad.status === 1 && bad.stdout.includes("design-check.json: 抑制 1 件目"), bad.stdout);
    writeFileSync(checkFile, "{ not json");
    const broken2 = run(ws);
    assert("design-check.json が壊れていたら、error (終了コード 1)", broken2.status === 1 && broken2.stdout.includes("design-check.json を読めない"), broken2.stdout);
    rmSync(checkFile);

    // 規約カタログ・独自部品の JSON が壊れていたら、原因 (ファイルが壊れている) を error として示す
    const lc = join(ws, "harmony/layout-components.json");
    writeFileSync(lc, "{ not json");
    const lcRes = run(ws);
    assert("独自部品の JSON が壊れていたら、原因を示す error (終了コード 1)", lcRes.status === 1 && lcRes.stdout.includes("layout-components.json を読めない"), lcRes.stdout);
    rmSync(lc);
    writeFileSync(join(ws, "harmony/conventions/catalog.json"), "{ not json");
    const cvRes = run(ws);
    assert("規約カタログの JSON が壊れていたら、原因を示す error (終了コード 1)", cvRes.status === 1 && cvRes.stdout.includes("conventions/catalog.json を読めない"), cvRes.stdout);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// ─────────────────────────────────────────────────────────────
// export-test-viewpoints.mjs (テスト観点表の書き出し)
// ─────────────────────────────────────────────────────────────
group("export-test-viewpoints", () => {
  const repo = resolve(__dirname, "../..");
  const run = (...args) => spawnSync("node", ["scripts/export-test-viewpoints.mjs", ...args], { cwd: repo, encoding: "utf8" });
  const json = run("examples/retail", "--format", "json");
  let sheet = null;
  try { sheet = JSON.parse(json.stdout); } catch { /* 下で失敗にする */ }
  assert("--format json は観点表を返す", json.status === 0 && sheet && sheet.total > 0, json.stderr);
  const ids = sheet ? [...sheet.screens.flatMap((s) => s.cases.map((c) => c.id)), ...sheet.flows.flatMap((f) => f.cases.map((c) => c.id))] : [];
  assert("ID は重複しない", ids.length > 0 && new Set(ids).size === ids.length);
  assert("同じ入力からは同じ結果 (決定的)", run("examples/retail", "--format", "json").stdout === json.stdout);
  const only = run("examples/retail", "--format", "json", "--screen", "cart");
  const onlySheet = JSON.parse(only.stdout);
  assert("--screen で画面を絞れる (処理は絞った画面に関係なく出る)", onlySheet.screens.length === 1 && onlySheet.screens[0].screenId === "cart");
  const csv = run("examples/retail");
  assert("既定は CSV (BOM つき・見出し行つき)", csv.stdout.startsWith("\uFEFFID,対象,区分"));
  assert("規約の上限 (@conv.limit) を解いて境界値を出す (cart.addQuantity の 1000)", /cart\.addQuantity\.max-over,.*,1000\r?\n/.test(csv.stdout));
  assert("--format が不正なら終了コード 2", run("examples/retail", "--format", "xls").status === 2);
  assert("引数なしは終了コード 2", run().status === 2);
});

// ─────────────────────────────────────────────────────────────
// export-design-doc.mjs + document-template.json (CLI の設計書にも、体裁・改訂履歴が効く)
// ─────────────────────────────────────────────────────────────
group("export-design-doc (体裁・改訂履歴)", () => {
  const repo = resolve(__dirname, "../..");
  const tmp = mkdtempSync(join(tmpdir(), "doc-template-"));
  try {
    cpSync(join(repo, "examples/retail"), join(tmp, "ws"), { recursive: true });
    writeFileSync(join(tmp, "ws/harmony/document-template.json"), JSON.stringify({ version: 1, documentTitle: "要件定義書 (CLI)", excludeChapters: ["crud"], revisions: [{ version: "1.0", date: "2026-10-01", summary: "初版 (CLI)" }] }));
    const out = join(tmp, "doc.html");
    const r = spawnSync("node", ["scripts/export-design-doc.mjs", join(tmp, "ws"), "--out", out], { cwd: repo, encoding: "utf8" });
    const html = existsSync(out) ? readFileSync(out, "utf8") : "";
    assert("書き出せる", r.status === 0 && html.length > 1000, r.stderr);
    assert("文書名・改訂履歴が載る", html.includes("要件定義書 (CLI)") && html.includes("初版 (CLI)") && html.includes('id="revisions"'));
    assert("載せない章 (CRUD 図) は載らない", !html.includes('id="crud"'));
    writeFileSync(join(tmp, "ws/harmony/document-template.json"), "{壊れた");
    const broken = spawnSync("node", ["scripts/export-design-doc.mjs", join(tmp, "ws"), "--out", out], { cwd: repo, encoding: "utf8" });
    assert("体裁の JSON が壊れていたら、理由を知らせる (体裁なしで書き出す)", (broken.stderr + broken.stdout).includes("document-template.json を読めない"), broken.stderr);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

// ─────────────────────────────────────────────────────────────
// docs-freshness.mjs (資料の鮮度検査)
// ─────────────────────────────────────────────────────────────
const { brokenLinks, unknownNpmScripts, appRoutes, docRoutes, routeTableDrift, uiReferenceIssues, skillIssues, specIndexGaps, playwrightDrift, specFrontmatterIssues, aiIndexToolIssues, generatedIssues, jsonExampleIssues, codemapPathIssues, normRoute, runChecks } = await import("./docs-freshness.mjs");
const { pickTargets, DOC_SHOT_NAMES } = await import("../dev/docs-shots.mjs");
const { planSetup, versionAtLeast, requiredNode, requiredEngine, nvmrcMajor, runtimeFindings, enginesCheck } = await import("../lib/setup.mjs");
const { toNoteLine, renderNotes } = await import("../release/notes.mjs");

function docsFixture() {
  const tmp = mkdtempSync(join(tmpdir(), "docs-fresh-"));
  const w = (rel, text) => { mkdirSync(dirname(join(tmp, rel)), { recursive: true }); writeFileSync(join(tmp, rel), text); };
  w("package.json", JSON.stringify({ scripts: { check: "x", "check:docs": "y" } }));
  w("frontend/package.json", JSON.stringify({ scripts: { dev: "vite" } }));
  w("frontend/src/components/AppShell.tsx", '<Route path="/w/:wsId" element={<X />}>\n<Route path="screen/list" element={<A />} />\n<Route path="table/edit/:tableId" element={<B />} />\n<Route path="analysis" element={<C />} />\n</Route>\n<Route path="/workspace/list" element={<D />} />\n<Route path="*" element={<E />} />');
  w("AGENTS.md", "# A\n\n### Routing\n\n| Path | 画面 |\n|---|---|\n| `/` | top |\n| `/screen/list` | 一覧 |\n| `/table/edit/:tableId` | 編集 |\n| `/analysis` | 分析 |\n| `/workspace/*` | ワークスペース |\n\n### Key\n");
  w("CLAUDE.md", "# C\n\n### Skills\n\n| コマンド | 用途 |\n|---|---|\n| `/issues <N>` | a |\n| `/ghost` | b |\n\n### Memory\n");
  w("ai-skills/issues/SKILL.md", "x");
  w("ai-skills/extra/SKILL.md", "x");
  w("docs/spec/README.md", "# s\n- [a](a.md)\n");
  w("docs/spec/a.md", "# a\n`npm run dev` と npm run check と [ok](../../AGENTS.md)\n");
  w("docs/spec/b.md", "# b\n");
  w("docs/user-guide/ui-reference/list.md", "# L\n\n> **対象画面**: `ListView` (`frontend/src/components/list.tsx`)\n> **ルート**: `/w/:wsId/screen/list`\n\n![x](../../ui-screenshots/ui-reference/list/01-default.png)\n");
  return tmp;
}

group("docs-freshness (資料の鮮度検査)", () => {
  const tmp = docsFixture();
  try {
    const files = [join(tmp, "docs/spec/a.md"), join(tmp, "AGENTS.md")];
    assert("正しい相対リンク・コードの中のリンクは、問題にしない", brokenLinks(files, tmp).length === 0);
    writeFileSync(join(tmp, "docs/spec/a.md"), "# a\n[壊れ](../nothing.md) [外部](https://example.com/x) [内](#h) `[コード](none.md)`\n```\n[ブロック](none2.md)\n```\n");
    const broken = brokenLinks(files, tmp);
    assert("リンクの先がなければ検出する (外部・ページ内・コードの中は除く)", broken.length === 1 && broken[0].link === "../nothing.md", JSON.stringify(broken));
    writeFileSync(join(tmp, "docs/spec/a.md"), "npm run dev / npm run check:docs / npm run ghost:task / npm run check\n");
    const un = unknownNpmScripts([join(tmp, "docs/spec/a.md")], tmp);
    assert("どの package.json にもない npm run を検出する (ルート・ワークスペースの両方を見る)", un.length === 1 && un[0].script === "ghost:task", JSON.stringify(un));

    const shell = readFileSync(join(tmp, "frontend/src/components/AppShell.tsx"), "utf8");
    const routes = appRoutes(shell);
    assert("画面の経路: ワークスペース配下は /w/:wsId を除き、パラメータ名をそろえ、* は除く", [...routes].sort().join(",") === "/analysis,/screen/list,/table/edit/:x,/workspace/list", [...routes].join(","));
    const agents = readFileSync(join(tmp, "AGENTS.md"), "utf8");
    assert("表と画面が合っていれば、食い違いなし (/workspace/* は、前方一致)", routeTableDrift(shell, agents).missingInDocs.length === 0 && routeTableDrift(shell, agents).missingInApp.length === 0);
    const drift = routeTableDrift(shell + '<Route path="/w/:wsId/new/page" element={<Z />} />', agents.replace("| `/analysis` | 分析 |\n", "| `/gone/page` | 消えた |\n"));
    assert("表にない画面・画面にない表の行を、両方向で検出する", drift.missingInDocs.includes("/analysis") && drift.missingInDocs.includes("/new/page") && drift.missingInApp.includes("/gone/page"), JSON.stringify(drift));
    assert("[/:k[/:n]] の省略形・/* を展開する", (() => { const d = docRoutes("### Routing\n| `/g[/:kind[/:name]]` | x |\n| `/s/*` | y |\n"); return d.exact.has("/g") && d.exact.has("/g/:x") && d.exact.has("/g/:x/:x") && d.prefixes[0] === "/s"; })());
    assert("normRoute", normRoute("/w/:wsId/table/edit/:tableId") === "/table/edit/:x" && normRoute("/w/:wsId/") === "/");

    const ui = uiReferenceIssues(tmp, routes);
    assert("UI 操作リファレンス: 対象画面のファイル・スクリーンショットがなければ検出する", ui.errors.some((e) => e.message.includes("対象画面のファイルがありません")) && ui.errors.some((e) => e.message.includes("スクリーンショットがありません")), JSON.stringify(ui.errors));
    assert("UI 操作リファレンスのない画面を、知らせる", ui.infos.some((i) => i.message.includes("/analysis")) && !ui.infos.some((i) => i.message.includes("/screen/list")));
    writeFileSync(join(tmp, "docs/user-guide/ui-reference/list.md"), "> **対象画面**: `V` (`frontend/src/components/AppShell.tsx`)\n> **ルート**: `/w/:wsId/screen/nothing`\n");
    assert("ルートが画面にないものを検出する", uiReferenceIssues(tmp, routes).errors.some((e) => e.message.includes("ルートが、画面にありません")));

    const sk = skillIssues(readFileSync(join(tmp, "CLAUDE.md"), "utf8"), tmp);
    assert("スキル表のスキルが ai-skills/ になければ error、表にないスキルは知らせる", sk.errors.length === 1 && sk.errors[0].message.includes("/ghost") && sk.infos.some((i) => i.message.includes("ai-skills/extra")), JSON.stringify(sk));
    assert("仕様書の索引にない仕様書を知らせる", specIndexGaps(tmp).length === 1 && specIndexGaps(tmp)[0].message.includes("b.md"));
    const fm = specFrontmatterIssues(tmp);
    assert("仕様書の frontmatter がなければ検出する", fm.length === 3 && fm.every((f) => f.message.includes("frontmatter")), JSON.stringify(fm));
    writeFileSync(join(tmp, "docs/spec/README.md"), '---\ndescription: "索引"\nstatus: current\ncategory: guide\n---\n# README\n| [a.md](a.md) | [b.md](b.md) |\n');
    writeFileSync(join(tmp, "docs/spec/a.md"), '---\ndescription: "A"\nstatus: current\ncategory: ui\n---\n# a\n');
    writeFileSync(join(tmp, "docs/spec/b.md"), '---\ndescription: "B"\nstatus: bogus\ncategory: ui\n---\n# b\n');
    assert("status が決まった値でなければ検出する", specFrontmatterIssues(tmp).some((f) => f.message.includes("status")));
    writeFileSync(join(tmp, "docs/spec/b.md"), '---\ndescription: "B"\nstatus: record\ncategory: record\n---\n# b\n');
    assert("frontmatter が揃っていて索引がなければ、索引のずれを検出する", specFrontmatterIssues(tmp).length === 1 && specFrontmatterIssues(tmp)[0].file === "docs/spec/index.json");
    spawnSync(process.execPath, ["-e", `import("${resolve(dirname(fileURLToPath(import.meta.url)), "../docs/spec-index.mjs").replace(/\\/g, "/")}").then(async (m) => { const fs = await import("node:fs"); const { entries } = m.buildSpecIndex(${JSON.stringify(tmp)}); fs.writeFileSync(${JSON.stringify(join(tmp, "docs/spec/index.json"))}, m.renderIndex(entries)); })`]);
    assert("索引を作り直せば、食い違いなし", specFrontmatterIssues(tmp).length === 0, JSON.stringify(specFrontmatterIssues(tmp)));
    mkdirSync(join(tmp, "backend/src"), { recursive: true });
    writeFileSync(join(tmp, "backend/src/tools.ts"), 'export const tools = [{ name: "designer__check_design" }];');
    writeFileSync(join(tmp, "docs/AI-INDEX.md"), "`check_design` と `designer__check_design` と `designer__ghost_tool` と `other_ghost` と `apply: true` と `HARMONY_MCP_MODE`");
    const ai = aiIndexToolIssues(tmp);
    assert("AI 向けの入口にある tool の名前が MCP になければ検出する (ほかの `…` は見ない)", ai.length === 2 && ai.some((a) => a.message.includes(": ghost_tool")) && ai.some((a) => a.message.includes("other_ghost")), JSON.stringify(ai));
    const all = runChecks(tmp);
    assert("runChecks: 全体を通して、error と知らせを返す", all.errors.length > 0 && all.infos.length > 0 && all.docCount >= 4);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
  const real = runChecks();
  assert("このリポジトリの資料に、食い違いがない", real.errors.length === 0, real.errors.slice(0, 3).map((e) => `${e.file}: ${e.message}`).join(" / "));
});

await group("AI 向けの資料の自動生成と検査 (generated / json-examples / codemap)", async () => {
  const { buildSchemaIndex, buildStepKinds, buildPitfalls, buildGlossary, buildPatterns, firstSentence: fs1, checkGenerated, CORE_TERMS } = await import("../docs/generated.mjs");
  const { collectExamples, checkJsonExamples } = await import("../docs/json-examples.mjs");
  assert("firstSentence: 括弧の中の。では切らない", fs1("汎用定義 (genericDefinition。メッセージ)。次。") === "汎用定義 (genericDefinition。メッセージ)。");
  const kinds = buildStepKinds();
  assert("工程の種類の一覧: 25 の組み込みの種類と拡張が載り、日本語名が付く", /\| `validation` \| 入力チェック \|/.test(kinds) && /\| `setGlobal` \| グローバル設定 \|/.test(kinds) && /namespace:StepName/.test(kinds) && (kinds.match(/^\| `/gm) ?? []).length === 26);
  assert("工程の種類の一覧: 条件つきの必須 (loop は loopKind=count のとき countExpression ほか) を載せ、見出しは『常に必須』", /常に必須の項目/.test(kinds) && /\| `loop` \|[^\n]*`loopKind=count` のとき `countExpression`/.test(kinds) && /`pattern=approval-quorum` のとき `quorum`/.test(kinds));
  const idx = JSON.parse(buildSchemaIndex());
  assert("スキーマの索引: ルートの必須の項目と、汎用定義のスキーマも載る", idx.schemas.find((s) => s.kind === "process-flow").rootRequired?.join() === "meta,actions" && idx.schemas.some((s) => s.kind.startsWith("generic-definitions/")));
  assert("スキーマの索引: 全ファイルと $defs、BranchStep の必須の項目", idx.schemas.length >= 15 && idx.schemas.find((s) => s.kind === "process-flow").defs.some((d) => d.name === "BranchStep" && d.required?.includes("branches")));
  assert("self-check ルールの一覧: 33 件以上、番号と題", (buildPitfalls().match(/^\| \d+[a-z]? \|/gm) ?? []).length >= 33);
  const gl = JSON.parse(buildGlossary());
  assert("用語集: 中心の用語と、工程の種類の用語が両方ある。tool の名前は実在する (作れること自体が検査)", gl.terms.length > CORE_TERMS.length && gl.terms.some((t) => t.term === "判定表") && gl.terms.some((t) => t.generated && t.term === "分岐 (工程の種類)"));
  const names = JSON.parse(buildGlossary()).terms.map((t) => t.term);
  assert("用語集: 用語が重複しない (生成の用語は、中心の用語と同名なら『(工程の種類)』を付ける)", new Set(names).size === names.length && names.includes("分岐 (工程の種類)") && names.includes("分岐"), names.filter((n, i) => names.indexOf(n) !== i).join());
  assert("self-check ルールの題: 注記 (#486 など) と山括弧が残らない", !/#486|schema 制約|<camelCase>/.test(buildPitfalls()));
  assert("サンプルのパターン: 拡張の行にも日本語名が付く", /\| `namespace:StepName` \| 拡張 \|/.test(buildPatterns()));
  assert("サンプルのパターン: 種類ごとの例の場所", /\| `branch` \| 分岐 \| `examples\//.test(buildPatterns()));
  assert("このリポジトリの生成物が、正本と合っている", checkGenerated().length === 0, JSON.stringify(checkGenerated()));
  const tmp = mkdtempSync(join(tmpdir(), "gen-"));
  try {
    mkdirSync(join(tmp, "schemas/v3"), { recursive: true }); mkdirSync(join(tmp, "docs"), { recursive: true }); mkdirSync(join(tmp, "ai-skills/create-flow"), { recursive: true });
    writeFileSync(join(tmp, "schemas/v3/x.v3.schema.json"), JSON.stringify({ $id: "https://example.com/x.v3.schema.json", $defs: { T: { type: "object", required: ["a"], properties: { a: { type: "string" } }, additionalProperties: false } } }));
    writeFileSync(join(tmp, "docs/a.md"), "<!-- schema: x#/$defs/T -->\n```json\n{ \"a\": \"ok\" }\n```\n\n<!-- schema: x#/$defs/T -->\n```json\n{ \"a\": 1 }\n```\n\n<!-- schema: nope -->\n```json\n{}\n```\n\n<!-- schema: x#/$defs/Missing -->\n```json\n{}\n```\n\n<!-- schema: x -->\n\n本文\n\n<!-- schema: x#/$defs/T -->\n```json\n{ 壊れ\n```\n\n```json\n{ \"印のないものは検査しない\": 1 }\n```\n");
    const r = checkJsonExamples(tmp);
    assert("JSON の例: 合うものは通り、合わない・スキーマがない・定義がない・印の次がコードブロックでない・JSON として壊れているものを検出し、印のないものは見ない", r.checked === 2 && r.problems.length === 5 && r.problems.some((p) => p.includes("a.md:6") && p.includes("に合いません")) && r.problems.some((p) => p.includes("スキーマ「nope」")) && r.problems.some((p) => p.includes("x#/$defs/Missing")) && r.problems.some((p) => p.includes("```json のコードブロックではありません")) && r.problems.some((p) => p.includes("JSON として読めません")), JSON.stringify(r));
    assert("collectExamples: 行番号と検査先", collectExamples("a\n<!-- schema: x#/$defs/T -->\n```json\n{}\n```\n")[0].line === 2);
    writeFileSync(join(tmp, "docs/codemap.md"), "`schemas/v3/x.v3.schema.json` と `docs/nope.md` と `npm run check` と `a/*.ts`\n");
    const cm = codemapPathIssues(tmp);
    assert("コードの地図: 実在しないパスだけを検出する (npm の例・ワイルドカードは見ない)", cm.length === 1 && cm[0].message.includes("docs/nope.md"), JSON.stringify(cm));
    writeFileSync(join(tmp, "docs/AI-INDEX.md"), "ツールなし");
    assert("鮮度検査の関数は、材料のないディレクトリでは何も言わない", generatedIssues(tmp).length === 0 && jsonExampleIssues(join(tmp, "nowhere")).length === 0);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

group("docs-shots (スクリーンショットの撮り直しの対象)", () => {
  const existing = () => true;
  assert("--only は、対応のあるものだけ", pickTargets({ all: false, only: ["table-list", "nothing"], staleDocs: [], existing }).join() === "table-list");
  assert("既定は、古くなっているものだけ", pickTargets({ all: false, staleDocs: ["tech-stack", "dashboard"], existing }).join() === "tech-stack,dashboard");
  assert("--all は、対応するものすべて", pickTargets({ all: true, staleDocs: [], existing }).length === Object.keys(DOC_SHOT_NAMES).length);
  assert("撮影済みの画像がない資料は、対象にしない (新しい資料は、手で最初の 1 枚を置く)", pickTargets({ all: true, staleDocs: [], existing: (n) => n === "dashboard" }).join() === "dashboard");
});

group("setup (初回セットアップの計画)", () => {
  const has = (set) => (rel) => set.includes(rel);
  assert("版の比較", versionAtLeast("v22.1.0", "20") && versionAtLeast("20.0.0", "20") && !versionAtLeast("18.19.0", "20") && versionAtLeast("v20.10", "20.9.5"));
  assert("engines が無ければ Node 26 (#1571 で 20 から変更)", requiredNode({}) === "26" && requiredNode({ engines: { node: ">=22.1" } }) === "22.1");
  const none = planSetup({ root: "/r", nodeVersion: "v26.1.0", pkg: {}, has: has([]) });
  assert("何もなければ、install → shared のビルド → workspaces/ の作成", none.steps.map((s) => s.id).join() === "install,build-shared,mkdir-workspaces" && none.problems.length === 0);
  const done = planSetup({ root: "/r", nodeVersion: "v26.1.0", pkg: {}, has: has(["node_modules", "shared/dist/index.js", "workspaces"]) });
  assert("そろっていれば、何もしない", done.steps.length === 0 && done.problems.length === 0);
  assert("Node が古ければ問題にする", planSetup({ root: "/r", nodeVersion: "v20.20.2", pkg: {}, has: has(["node_modules", "shared/dist/index.js", "workspaces"]) }).problems[0].includes("26 以上"));
  assert("--skip-install で node_modules が無ければ問題にする (install はしない)", (() => { const p = planSetup({ root: "/r", nodeVersion: "v26.1.0", pkg: {}, has: has(["shared/dist/index.js", "workspaces"]), skipInstall: true }); return !p.steps.some((s) => s.id === "install") && p.problems.length === 1; })());
  assert("サンプルは、examples/ にあれば複製する・なければ問題・複製済みなら何もしない", (() => {
    const base = ["node_modules", "shared/dist/index.js", "workspaces"];
    const a = planSetup({ root: "/r", nodeVersion: "v26.1.0", pkg: {}, has: has([...base, "examples/retail/harmony.json"]), sample: "retail" });
    const b = planSetup({ root: "/r", nodeVersion: "v26.1.0", pkg: {}, has: has(base), sample: "retail" });
    const c = planSetup({ root: "/r", nodeVersion: "v26.1.0", pkg: {}, has: has([...base, "examples/retail/harmony.json", "workspaces/retail"]), sample: "retail" });
    return a.steps.some((s) => s.id === "copy-sample") && b.problems.length === 1 && c.steps.length === 0;
  })());
});

group("setup (Node と npm の版の判定 #1571)", () => {
  const pkg = { engines: { node: ">=26", npm: ">=12" } };
  const rel = [{ version: "v27.0.0", lts: false }, { version: "v26.13.0", lts: "Lithium" }, { version: "v26.12.0", lts: "Lithium" }, { version: "v24.15.0", lts: "Krypton" }];
  const base = { nodeVersion: "v26.13.0", npmVersion: "12.2.1", nvmrc: "26\n", pkg };
  const f = (o) => runtimeFindings({ ...base, ...o });
  assert("engines の下限と .nvmrc のメジャーを読む", requiredEngine(pkg, "npm") === "12" && requiredEngine({}, "npm") === null && requiredEngine({ engines: { node: "^22.22.2 || >=26.0.0" } }, "node") === "22.22.2" && nvmrcMajor("v26.1.0\n") === 26 && nvmrcMajor("lts/*") === null && nvmrcMajor(undefined) === null);
  assert("そろっていれば、問題も知らせもない (オフライン)", (() => { const r = f({}); return r.problems.length === 0 && r.notices.length === 0; })());
  assert("Node が engines 未満なら問題。includeNodeEngines: false なら重ねない", f({ nodeVersion: "v20.20.2", nvmrc: "20" }).problems.length === 1 && f({ nodeVersion: "v20.20.2", nvmrc: "20", includeNodeEngines: false }).problems.length === 0);
  assert("npm が engines 未満なら問題 (直し方と libc の理由を書く)", (() => { const p = f({ npmVersion: "10.8.2" }).problems; return p.length === 1 && p[0].includes("npm install -g npm@latest") && p[0].includes("libc"); })());
  assert("Node のメジャーが .nvmrc と違うのは知らせだけ (問題にしない)。nvm use と VS Code を書く", (() => { const r = f({ nodeVersion: "v24.15.0", pkg: {} }); return r.problems.length === 0 && r.notices.length === 1 && r.notices[0].includes("nvm use") && r.notices[0].includes("VS Code"); })());
  assert("lts/* の .nvmrc や .nvmrc なしは、メジャーの比較をしない", f({ nodeVersion: "v24.15.0", nvmrc: "lts/*", pkg: {} }).notices.length === 0 && f({ nodeVersion: "v24.15.0", nvmrc: undefined, pkg: {} }).notices.length === 0);
  assert("最新の LTS のメジャーが .nvmrc より新しければ問題 (LTS でない v27 は数えない)", (() => { const ok = f({ releases: rel }); const up = f({ releases: [...rel, { version: "v28.0.0", lts: "Next" }] }); return ok.problems.length === 0 && up.problems.length === 1 && up.problems[0].includes("Node のメジャーを上げる手順"); })());
  assert("同じメジャーの最新パッチより古ければ問題", (() => { const old = f({ nodeVersion: "v26.12.0", releases: rel }); return old.problems.length === 1 && old.problems[0].includes("v26.13.0") && f({ releases: rel }).problems.length === 0; })());
  assert("新しいパッチが出て 14 日までは知らせ、過ぎたら問題 (上流の image が追いつくまでの猶予)", (() => {
    const dated = [{ version: "v26.13.0", lts: "Lithium", date: "2026-10-28" }, { version: "v26.12.1", lts: "Lithium", date: "2026-10-21" }];
    const soon = f({ nodeVersion: "v26.12.1", releases: dated, now: Date.parse("2026-10-30") });
    const late = f({ nodeVersion: "v26.12.1", releases: dated, now: Date.parse("2026-11-12") });
    const older = f({ nodeVersion: "v26.11.0", releases: [...dated, { version: "v26.11.0", lts: false, date: "2026-10-07" }], now: Date.parse("2026-10-30") });
    return soon.problems.length === 0 && soon.notices.length === 1 && soon.notices[0].includes("2 日") && late.problems.length === 1 && older.problems.length === 0 && older.notices.length === 1;
  })());
  assert("npm が最新より古ければ問題・同じか新しければ問題なし", f({ latestNpm: "12.3.0" }).problems.length === 1 && f({ latestNpm: "12.2.1" }).problems.length === 0 && f({ latestNpm: "12.0.0" }).problems.length === 0);
  assert("nvmrcAsProblem なら、.nvmrc との違いを問題にする (check:deps -- runtime)", (() => { const r = f({ nodeVersion: "v24.15.0", pkg: {}, nvmrcAsProblem: true }); return r.problems.length === 1 && r.notices.length === 0 && f({ nvmrcAsProblem: true }).problems.length === 0; })());
  assert("engines の判定 (Node と npm。npm が足りなければ失敗・engines.npm が無ければ見ない)", enginesCheck({ nodeVersion: "v26.13.0", npmVersion: "12.2.1", pkg }).ok && !enginesCheck({ nodeVersion: "v26.13.0", npmVersion: "10.8.2", pkg }).ok && !enginesCheck({ nodeVersion: "v20.20.2", npmVersion: "12.2.1", pkg }).ok && !enginesCheck({ nodeVersion: "v26.13.0", npmVersion: null, pkg }).ok && enginesCheck({ nodeVersion: "v26.13.0", npmVersion: null, pkg: { engines: { node: ">=26" } } }).ok && !enginesCheck({ nodeVersion: "v26.13.0", npmVersion: "12.2.1", pkg: {} }).ok && enginesCheck({ nodeVersion: "v26.13.0", npmVersion: "10.8.2", pkg }).lines.some((l) => l.includes("10.8.2")));
  assert("最新の LTS の表示は、LTS のうち版がいちばん大きいもの (一覧の並びに依らない)", latestLts([{ version: "v24.15.0", lts: "Krypton" }, { version: "v26.13.0", lts: "Lithium" }, { version: "v27.0.0", lts: false }, { version: "v26.12.0", lts: "Lithium" }]) === "v26.13.0 (Lithium)" && latestLts([{ version: "v27.0.0", lts: false }]).includes("見つかりません"));
  assert("一覧が空・取れなかった (undefined) ときは、ネットワークの比較を飛ばす", f({ releases: [], latestNpm: undefined }).problems.length === 0 && f({ releases: undefined }).problems.length === 0);
});

group("開発コンテナの Playwright の版 (#1571)", () => {
  const lock = { packages: { "node_modules/playwright-core": { version: "1.60.0" } } };
  assert("Dockerfile と lock の版が同じなら問題なし", playwrightDrift("RUN npx -y playwright@1.60.0 install --with-deps chromium \\\n  && chown", lock) === null);
  assert("違えば、両方の版と直し方を書く", (() => { const m = playwrightDrift("RUN npx -y playwright@1.59.1 install --with-deps chromium", lock); return m.includes("1.59.1") && m.includes("1.60.0") && m.includes("出し直"); })());
  assert("版が読めない (Dockerfile に無い・lock に無い) ときは何も言わない", playwrightDrift("FROM x", lock) === null && playwrightDrift("playwright@1.59.1 install", {}) === null);
});

group("release:notes (リリースノート)", () => {
  assert("日付・件名・PR 番号 (複数なら最後) を 1 行にする", toNoteLine("2026-10-14\x1f設計の品質 (#1498) (#1500)") === "- 2026-10-14 設計の品質 (#1500)");
  assert("PR 番号がなければ、番号なし", toNoteLine("2026-10-14\x1f直接のコミット") === "- 2026-10-14 直接のコミット");
  assert("マージコミット・空の件名・壊れた行は除く", toNoteLine("2026-10-14\x1fMerge pull request #1 from x") === null && toNoteLine("2026-10-14\x1f (#1)") === null && toNoteLine("壊れた") === null);
  assert("見出しと行を出す", renderNotes(["- 2026-10-14 a (#1)"]).startsWith("# リリースノート") && renderNotes(["- 2026-10-14 a (#1)"]).includes("\n- 2026-10-14 a (#1)\n"));
});

group("no-new-outline-none (フォーカス輪郭の検査)", () => {
  assert("outline: none / 0 を数える (空白の違いも)", countOutlineNone(".a{outline:none}.b{ outline : 0 }.c{outline: 2px solid red}") === 2);
  assert("コメントの中は数えない。outline-offset などは数えない", countOutlineNone("/* outline: none */ .a{outline-offset:0;outline-style:none}") === 0);
});

group("no-secrets (秘密らしい文字列の検査)", () => {
  const fake = (parts) => parts.join("");
  assert("AWS のキー・GitHub のトークン・秘密鍵・JWT を見つける", scanText(fake(["AK", "IA", "ABCDEFGHIJKLMNOP"])).length === 1 && scanText(fake(["gh", "p_", "a".repeat(36)])).length === 1 && scanText(fake(["-----BEGIN ", "PRIVATE KEY-----"])).length === 1 && scanText(fake(["ey", "J", "a".repeat(12), ".ey", "J", "b".repeat(12), ".", "c".repeat(12)])).length === 1);
  assert("ふつうの文字・短い sk- の文字は見つけない。出力には全文を出さない", scanText("sk-learn and AKIA short and ghp_short").length === 0 && !JSON.stringify(scanText(fake(["gh", "p_", "a".repeat(36)]))).includes("a".repeat(20)));
});

group("hygiene (コードの衛生の検査)", () => {
  const files = ["backend/src/a.ts", "backend/src/a.test.ts", "frontend/src/b.tsx"];
  const body = {
    "backend/src/a.ts": "console.log(1);\n// eslint-disable-next-line x -- 理由\n// eslint-disable-next-line y\n// TODO: あとで\n// TODO(#1): ok\nconst s = `// TODO: 文字列`;",
    "backend/src/a.test.ts": "console.log(2);\ndescribe.only('x', () => {});",
    "frontend/src/b.tsx": "const a = 1;",
  };
  const m = measureHygiene(files, (f) => body[f]);
  assert("理由なしの eslint-disable・番号なしの TODO・.only・backend の console を数える (試験の console は除く・理由つき・番号つき・文字列の中は除く)", m.disableWithoutReason.length === 1 && m.badTodo.length === 1 && m.only.length === 1 && m.backendConsole.length === 1, JSON.stringify(m));
  const big = measureHygiene(["backend/src/big.ts", "backend/src/big.test.ts"], () => "x\n".repeat(1600));
  assert("1500 行を超える (試験以外の) ファイルを数える", Object.keys(big.big).join() === "backend/src/big.ts");
});

group("deps-report (ライセンスの判定)", () => {
  assert("許可リストの SPDX・OR・AND を判定する", licenseOk("MIT") && licenseOk("(MIT OR GPL-3.0)") && licenseOk("(MPL-2.0 OR Apache-2.0)") && licenseOk("MIT AND BSD-3-Clause") && !licenseOk("GPL-3.0") && !licenseOk("(GPL-3.0 AND MIT)") && !licenseOk(undefined) && !licenseOk("UNLICENSED"));
});

// ─────────────────────────────────────────────────────────────
// Result summary
// ─────────────────────────────────────────────────────────────
console.log(`\n────────────────────────────────────────────`);
console.log(`Result: ${pass} pass, ${fail} fail`);
if (fail > 0) process.exit(1);
