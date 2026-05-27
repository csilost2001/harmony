#!/usr/bin/env node
// scripts/verify/regression-trace-check.mjs
// #1346 (case A): full-suite Playwright failure ↔ trace ISSUE の機械照合 gate.
//
// #1299 Round 12-14 で「full regression に failure が残ったまま merge-ready 判定」
// 「単一 spec の strict-mode 違反を isolation pass = flake と誤判定」の事故が
// 連続再発したことを受け、private memory ベースの完了判定ルールを repo tracked
// な script に昇格したもの。
//
// === 目的 ===
//
// 1. Playwright JSON reporter 出力を parse し、unexpected な (= 期待 passed なのに
//    failed/timedOut した) test を抽出する。
// 2. 各 failure について `gh issue list --search "<spec-basename>"` で OPEN ISSUE が
//    trace 済か照合する。spec ファイル名または `file:line` が title / body に存在する
//    OPEN ISSUE が 1 件以上あれば「trace 済」と判定。
// 3. flake 扱いするには `--flake <spec>` flag を明示し、isolation 3 回連続 pass の
//    証跡 (frontend/test-results/isolation-<sanitized>.json) または `--auto-isolation-rerun`
//    での自動再走を要件化する。
// 4. trace なし fail が 1 件でも残れば exit 1 (gate fail)。
//
// === Usage ===
//
//   node scripts/verify/regression-trace-check.mjs <results.json> [options]
//   node scripts/verify/regression-trace-check.mjs --auto-run [options]
//   cat results.json | node scripts/verify/regression-trace-check.mjs - [options]
//
// === Options ===
//
//   --flake <spec>            Failed spec を flake 扱いする (例: e2e/foo.spec.ts)。
//                             repeat 可能。isolation 3x pass 証跡を要求。
//   --auto-run                regression suite を JSON reporter で先に走らせる
//                             (`npm run test:e2e:regression -- --reporter=json`)
//   --auto-isolation-rerun    --flake 指定の spec を自動で isolation 3 回走らせる
//                             (`npx playwright test <spec> --workers=1`)。3 回全 pass で
//                             flake 確定、それ以外は実 fail と判定。
//   --isolation-evidence-dir <dir>
//                             isolation 3x pass 証跡 JSON の格納先 (default:
//                             frontend/test-results)。
//   --no-gh                   gh CLI 呼び出しを skip (オフライン / test 用)。
//                             この場合 trace 済判定は外部 input (--traced) に依存。
//   --traced <spec>           trace 済として手動 mark (test 用、本来 gh で判定すべき)。
//                             repeat 可能。
//   --json                    machine-readable JSON で出力。
//   --verbose, -v             詳細出力 (gh 呼出しの引数 / 反復ループ等)。
//   --help, -h                このヘルプ。
//
// === Exit codes ===
//
//   0  すべての failure が trace 済 (OPEN ISSUE 参照あり) または flake 確認済
//   1  trace なし fail が 1 件以上残る (= gate fail)
//   2  入力 / 設定エラー (results 読めない、gh コマンドなし、等)
//
// === 出力例 ===
//
// (人間 format)
//   ⚠ 8 failed tests detected:
//     ✓ e2e/foo.spec.ts:10 — TRACED to #1342, #1344
//     ✓ e2e/bar.spec.ts:25 — FLAKE confirmed (isolation 3/3 pass at frontend/test-results/...)
//     ✗ e2e/baz.spec.ts:42 — UNTRACED: no OPEN ISSUE found
//   Result: 2 traced, 1 flake-confirmed, 5 UNTRACED → gate FAILED.
//
// === AGENTS.md / PR template から呼ばれる前提 ===
//
// PR 作成 / merge 判断時、AI orchestrator は本 script を必ず通過させる。

import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, basename, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "../..");
const FRONTEND_DIR = join(REPO_ROOT, "frontend");
const DEFAULT_EVIDENCE_DIR = join(FRONTEND_DIR, "test-results");
const ISOLATION_REQUIRED_PASS_COUNT = 3;

// ─────────────────────────────────────────────────────────────
// CLI parsing
// ─────────────────────────────────────────────────────────────

/**
 * @typedef {Object} CliOptions
 * @property {string|null} resultsPath
 * @property {string[]} flakeSpecs
 * @property {string[]} tracedSpecs
 * @property {boolean} autoRun
 * @property {boolean} autoIsolationRerun
 * @property {string} isolationEvidenceDir
 * @property {boolean} useGh
 * @property {boolean} jsonOutput
 * @property {boolean} verbose
 * @property {boolean} help
 */

/**
 * @param {string[]} argv
 * @returns {CliOptions}
 */
export function parseArgs(argv) {
  /** @type {CliOptions} */
  const opt = {
    resultsPath: null,
    flakeSpecs: [],
    tracedSpecs: [],
    autoRun: false,
    autoIsolationRerun: false,
    isolationEvidenceDir: DEFAULT_EVIDENCE_DIR,
    useGh: true,
    jsonOutput: false,
    verbose: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--flake") {
      const v = argv[++i];
      if (!v) throw new Error("--flake requires a spec path");
      opt.flakeSpecs.push(v);
      continue;
    }
    if (a === "--traced") {
      const v = argv[++i];
      if (!v) throw new Error("--traced requires a spec path");
      opt.tracedSpecs.push(v);
      continue;
    }
    if (a === "--auto-run") { opt.autoRun = true; continue; }
    if (a === "--auto-isolation-rerun") { opt.autoIsolationRerun = true; continue; }
    if (a === "--isolation-evidence-dir") {
      const v = argv[++i];
      if (!v) throw new Error("--isolation-evidence-dir requires a path");
      opt.isolationEvidenceDir = resolve(REPO_ROOT, v);
      continue;
    }
    if (a === "--no-gh") { opt.useGh = false; continue; }
    if (a === "--json") { opt.jsonOutput = true; continue; }
    if (a === "--verbose" || a === "-v") { opt.verbose = true; continue; }
    if (a === "--help" || a === "-h") { opt.help = true; continue; }
    if (a.startsWith("--")) { throw new Error(`Unknown option: ${a}`); }
    if (!opt.resultsPath) { opt.resultsPath = a; continue; }
    throw new Error(`Unexpected positional argument: ${a}`);
  }

  return opt;
}

// ─────────────────────────────────────────────────────────────
// Playwright JSON 解析
// ─────────────────────────────────────────────────────────────

/**
 * @typedef {Object} FailedTest
 * @property {string} file         spec ファイル path (例: "e2e/foo.spec.ts")
 * @property {number} line         test 行番号
 * @property {string} title        spec title
 * @property {string} status       "failed" | "timedOut"
 * @property {string|null} errorMessage
 */

/**
 * Playwright JSON reporter 出力から failed test を抽出。
 * `ok: false` の spec のうち、test results に "failed" / "timedOut" を含むものを採用。
 *
 * spec.file は Playwright が testDir 起点の相対 path で出力する (e.g., "e2e/foo.spec.ts")。
 * 古い report が "foo.spec.ts" のように prefix なしの場合は呼び出し側で補正する。
 *
 * @param {unknown} report
 * @returns {FailedTest[]}
 */
export function extractFailedTests(report) {
  /** @type {FailedTest[]} */
  const failed = [];
  if (!report || typeof report !== "object") return failed;
  const suites = /** @type {any} */ (report).suites;
  if (!Array.isArray(suites)) return failed;

  /** @param {any} suite */
  const walk = (suite) => {
    if (!suite || typeof suite !== "object") return;
    if (Array.isArray(suite.specs)) {
      for (const spec of suite.specs) {
        if (!spec || typeof spec !== "object") continue;
        if (spec.ok !== false) continue;
        const tests = Array.isArray(spec.tests) ? spec.tests : [];
        let status = null;
        let errorMessage = null;
        for (const t of tests) {
          const results = Array.isArray(t?.results) ? t.results : [];
          for (const r of results) {
            if (r?.status === "failed" || r?.status === "timedOut") {
              status = r.status;
              if (!errorMessage) {
                const err = r.error ?? (Array.isArray(r.errors) ? r.errors[0] : null);
                if (err) {
                  errorMessage = typeof err === "string" ? err : (err.message ?? err.value ?? null);
                }
              }
            }
          }
        }
        if (status) {
          failed.push({
            file: typeof spec.file === "string" ? spec.file : "",
            line: typeof spec.line === "number" ? spec.line : 0,
            title: typeof spec.title === "string" ? spec.title : "(no title)",
            status,
            errorMessage,
          });
        }
      }
    }
    if (Array.isArray(suite.suites)) {
      for (const child of suite.suites) walk(child);
    }
  };

  for (const top of suites) walk(top);
  return failed;
}

// ─────────────────────────────────────────────────────────────
// gh issue list 照合
// ─────────────────────────────────────────────────────────────

/**
 * @typedef {Object} IssueRef
 * @property {number} number
 * @property {string} title
 * @property {string} url
 */

/**
 * gh issue list を spec basename で検索し、title / body / comments に
 * file path or "file:line" を含む OPEN ISSUE を返す。
 *
 * GitHub search はトークン化 (`/` で分割等) されるため、search で取得後
 * client side で `text.includes(name)` の precise filter を必ずかける。
 *
 * @param {string} specFile             spec の相対 path (e.g., "e2e/foo.spec.ts")
 * @param {number} line                 spec の行番号 (0 なら無視)
 * @param {(cmd: string, args: string[]) => string} runGh  injectable for testing
 * @returns {IssueRef[]}
 */
export function findTracingIssues(specFile, line, runGh) {
  const name = basename(specFile);
  if (!name) return [];
  const out = runGh("gh", [
    "issue", "list",
    "--state", "open",
    "--search", name,
    "--json", "number,title,body,url",
    "--limit", "50",
  ]);
  /** @type {Array<{number:number,title:string,body?:string,url:string}>} */
  let issues;
  try {
    issues = JSON.parse(out);
  } catch (err) {
    throw new Error(`gh issue list output was not JSON: ${err.message}`);
  }
  /** @type {IssueRef[]} */
  const matches = [];
  for (const issue of issues) {
    const text = `${issue.title || ""}\n${issue.body || ""}`;
    // file or basename を必ず含む (title/body precise filter)
    if (text.includes(specFile) || text.includes(name)) {
      matches.push({ number: issue.number, title: issue.title || "", url: issue.url });
    }
  }
  return matches;
}

/**
 * gh CLI 実行 (sync)。stderr は捨てる。non-zero exit でも stdout を返す
 * (gh は 0 件ヒットでも 0 exit するため、err 判定は呼び出し側で JSON parse fail に委ねる)。
 *
 * @param {string} cmd
 * @param {string[]} args
 * @returns {string}
 */
function runGhCli(cmd, args) {
  const result = spawnSync(cmd, args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    timeout: 30_000,
  });
  if (result.error) {
    throw new Error(`Failed to run ${cmd}: ${result.error.message}`);
  }
  if (typeof result.status === "number" && result.status !== 0) {
    // gh search が miss でも status 0 のはずだが、念のため err message を含めて throw
    const tail = (result.stderr || "").trim().slice(0, 400);
    throw new Error(`${cmd} exited with status ${result.status}: ${tail}`);
  }
  return result.stdout || "";
}

// ─────────────────────────────────────────────────────────────
// isolation 証跡 / 自動再走
// ─────────────────────────────────────────────────────────────

/**
 * spec path を file system safe な sanitized 名に変換 (証跡 file 名用)。
 * @param {string} spec
 * @returns {string}
 */
export function sanitizeSpecName(spec) {
  return spec.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

/**
 * isolation 証跡 JSON を読み、ISOLATION_REQUIRED_PASS_COUNT 回連続 pass を確認。
 *
 * 証跡 file format:
 *   { "spec": "e2e/foo.spec.ts", "runs": [ { "status": "passed", "duration": 1234 }, ... ] }
 *
 * @param {string} spec
 * @param {string} dir
 * @returns {{ ok: boolean, reason: string, evidencePath: string }}
 */
export function checkIsolationEvidence(spec, dir) {
  const path = join(dir, `isolation-${sanitizeSpecName(spec)}.json`);
  if (!existsSync(path)) {
    return { ok: false, reason: `evidence file not found: ${path}`, evidencePath: path };
  }
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    return { ok: false, reason: `evidence file is not JSON: ${err.message}`, evidencePath: path };
  }
  const runs = Array.isArray(parsed?.runs) ? parsed.runs : null;
  if (!runs || runs.length < ISOLATION_REQUIRED_PASS_COUNT) {
    return {
      ok: false,
      reason: `expected at least ${ISOLATION_REQUIRED_PASS_COUNT} runs, found ${runs?.length ?? 0}`,
      evidencePath: path,
    };
  }
  const lastN = runs.slice(-ISOLATION_REQUIRED_PASS_COUNT);
  const allPass = lastN.every((r) => r?.status === "passed");
  if (!allPass) {
    return {
      ok: false,
      reason: `last ${ISOLATION_REQUIRED_PASS_COUNT} runs not all passed: ${lastN.map((r) => r?.status).join(", ")}`,
      evidencePath: path,
    };
  }
  return { ok: true, reason: `isolation ${ISOLATION_REQUIRED_PASS_COUNT}/${ISOLATION_REQUIRED_PASS_COUNT} pass`, evidencePath: path };
}

/**
 * spec を isolation で 3 回走らせ、証跡 file に書き出す。
 * 既存 evidence が 3 回連続 pass なら skip。
 *
 * @param {string} spec
 * @param {string} dir
 * @param {(cmd: string, args: string[], opts?: {cwd?:string}) => {status: number, stdout: string, stderr: string}} runProc
 * @param {boolean} verbose
 * @returns {{ ok: boolean, reason: string, evidencePath: string }}
 */
export function runIsolationLoop(spec, dir, runProc, verbose) {
  mkdirSync(dir, { recursive: true });
  const evidencePath = join(dir, `isolation-${sanitizeSpecName(spec)}.json`);
  /** @type {Array<{status: string, duration: number, ranAt: string}>} */
  const runs = [];
  for (let i = 1; i <= ISOLATION_REQUIRED_PASS_COUNT; i++) {
    if (verbose) console.error(`  isolation run ${i}/${ISOLATION_REQUIRED_PASS_COUNT}: ${spec}`);
    const r = runProc("npx", [
      "playwright", "test", spec,
      "--workers=1",
      "--reporter=json",
    ], { cwd: FRONTEND_DIR });
    let status = "failed";
    let duration = 0;
    if (r.status === 0) {
      try {
        const report = JSON.parse(r.stdout);
        const fails = extractFailedTests(report);
        if (fails.length === 0) status = "passed";
        duration = report?.stats?.duration ?? 0;
      } catch {
        status = "failed";
      }
    }
    runs.push({ status, duration, ranAt: new Date().toISOString() });
    if (status !== "passed") {
      // fail at any run → cease, write evidence anyway
      writeFileSync(evidencePath, JSON.stringify({ spec, runs }, null, 2));
      return {
        ok: false,
        reason: `isolation run ${i} did not pass (status=${status})`,
        evidencePath,
      };
    }
  }
  writeFileSync(evidencePath, JSON.stringify({ spec, runs }, null, 2));
  return { ok: true, reason: `isolation ${ISOLATION_REQUIRED_PASS_COUNT}/${ISOLATION_REQUIRED_PASS_COUNT} pass`, evidencePath };
}

// ─────────────────────────────────────────────────────────────
// main pipeline
// ─────────────────────────────────────────────────────────────

/**
 * @typedef {Object} Evaluation
 * @property {FailedTest} failed
 * @property {"traced"|"flake-confirmed"|"untraced"} verdict
 * @property {string} detail
 * @property {IssueRef[]} tracingIssues
 */

/**
 * @typedef {Object} Pipeline
 * @property {CliOptions} options
 * @property {(path: string) => unknown} loadReport
 * @property {() => unknown} runRegressionSuite
 * @property {(cmd: string, args: string[]) => string} runGh
 * @property {(cmd: string, args: string[], opts?: {cwd?: string}) => {status: number, stdout: string, stderr: string}} runProc
 */

/**
 * core pipeline. injectable for testing。
 *
 * @param {Pipeline} ctx
 * @returns {{ evaluations: Evaluation[], gateOk: boolean }}
 */
export function evaluate(ctx) {
  const { options, loadReport, runRegressionSuite, runGh, runProc } = ctx;

  let report;
  if (options.autoRun) {
    report = runRegressionSuite();
  } else if (options.resultsPath === "-" || options.resultsPath === "/dev/stdin") {
    // stdin はラッパー側で読む方が安全。ここでは明示エラー化。
    throw new Error("stdin reading is handled outside evaluate(); pass resultsPath = a temp file");
  } else {
    if (!options.resultsPath) {
      throw new Error("results path is required unless --auto-run is set");
    }
    report = loadReport(options.resultsPath);
  }

  const failed = extractFailedTests(report);
  /** @type {Evaluation[]} */
  const evaluations = [];

  /** flake spec の正規化 (basename / 相対 path 両対応) */
  const flakeSet = new Set();
  for (const s of options.flakeSpecs) {
    flakeSet.add(s);
    flakeSet.add(basename(s));
  }
  const tracedManualSet = new Set();
  for (const s of options.tracedSpecs) {
    tracedManualSet.add(s);
    tracedManualSet.add(basename(s));
  }

  for (const f of failed) {
    const fileKeys = [f.file, basename(f.file)];

    // 1. manual traced
    if (fileKeys.some((k) => tracedManualSet.has(k))) {
      evaluations.push({
        failed: f,
        verdict: "traced",
        detail: "manually marked via --traced",
        tracingIssues: [],
      });
      continue;
    }

    // 2. flake (要証跡)
    if (fileKeys.some((k) => flakeSet.has(k))) {
      let result;
      if (options.autoIsolationRerun) {
        result = runIsolationLoop(f.file, options.isolationEvidenceDir, runProc, options.verbose);
      } else {
        result = checkIsolationEvidence(f.file, options.isolationEvidenceDir);
      }
      evaluations.push({
        failed: f,
        verdict: result.ok ? "flake-confirmed" : "untraced",
        detail: result.ok
          ? `flake-confirmed (${result.reason}, evidence: ${result.evidencePath})`
          : `flake claim REJECTED: ${result.reason}`,
        tracingIssues: [],
      });
      continue;
    }

    // 3. gh issue trace
    if (options.useGh) {
      const issues = findTracingIssues(f.file, f.line, runGh);
      if (issues.length > 0) {
        evaluations.push({
          failed: f,
          verdict: "traced",
          detail: `OPEN ISSUE: ${issues.map((i) => `#${i.number}`).join(", ")}`,
          tracingIssues: issues,
        });
        continue;
      }
    }

    evaluations.push({
      failed: f,
      verdict: "untraced",
      detail: options.useGh
        ? "no OPEN ISSUE found referencing this spec"
        : "--no-gh mode and no --traced / --flake mark",
      tracingIssues: [],
    });
  }

  const gateOk = evaluations.every((e) => e.verdict !== "untraced");
  return { evaluations, gateOk };
}

// ─────────────────────────────────────────────────────────────
// CLI entry
// ─────────────────────────────────────────────────────────────

function printHelp() {
  // top コメントから抽出するのは面倒なので簡易版を出す
  console.log(`Usage:
  node scripts/verify/regression-trace-check.mjs <results.json> [options]
  node scripts/verify/regression-trace-check.mjs --auto-run [options]
  cat results.json | node scripts/verify/regression-trace-check.mjs - [options]

Options:
  --flake <spec>            failed spec を flake 扱い (isolation 3x pass 証跡必須)
  --auto-run                regression suite を JSON reporter で先に走らせる
  --auto-isolation-rerun    --flake 指定 spec を自動 isolation 3 回再走
  --isolation-evidence-dir  証跡 dir (default: frontend/test-results)
  --no-gh                   gh CLI 呼び出し skip (test 用)
  --traced <spec>           手動 trace mark (test 用)
  --json                    JSON 出力
  --verbose, -v             詳細出力
  --help, -h                このヘルプ

Exit codes:
  0  全 failure が trace 済 or flake 確認済
  1  trace なし fail が 1 件以上
  2  入力 / 設定エラー

詳細: scripts/verify/regression-trace-check.mjs top コメント参照。`);
}

/**
 * @param {string} path
 * @returns {unknown}
 */
function loadReportFromFile(path) {
  if (path === "-" || path === "/dev/stdin") {
    return JSON.parse(readFileSync(0, "utf8"));
  }
  const resolved = resolve(REPO_ROOT, path);
  return JSON.parse(readFileSync(resolved, "utf8"));
}

/**
 * @returns {unknown}
 */
function runRegressionSuiteImpl() {
  const r = spawnSync(
    "npx",
    ["playwright", "test", "--grep", "@regression", "--reporter=json"],
    { cwd: FRONTEND_DIR, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  if (r.error) {
    throw new Error(`Failed to run playwright: ${r.error.message}`);
  }
  // playwright は fail 時に non-zero で抜けるが JSON は stdout に出る
  return JSON.parse(r.stdout);
}

/**
 * @param {string} cmd
 * @param {string[]} args
 * @param {{cwd?: string}} [opts]
 */
function runProcImpl(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    cwd: opts.cwd ?? REPO_ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return {
    status: typeof r.status === "number" ? r.status : (r.error ? 127 : 1),
    stdout: r.stdout || "",
    stderr: r.stderr || "",
  };
}

/**
 * @param {Evaluation[]} evaluations
 * @param {boolean} gateOk
 * @param {boolean} jsonOutput
 */
function emitReport(evaluations, gateOk, jsonOutput) {
  if (jsonOutput) {
    console.log(JSON.stringify({
      gateOk,
      summary: {
        total: evaluations.length,
        traced: evaluations.filter((e) => e.verdict === "traced").length,
        flakeConfirmed: evaluations.filter((e) => e.verdict === "flake-confirmed").length,
        untraced: evaluations.filter((e) => e.verdict === "untraced").length,
      },
      evaluations: evaluations.map((e) => ({
        file: e.failed.file,
        line: e.failed.line,
        title: e.failed.title,
        status: e.failed.status,
        verdict: e.verdict,
        detail: e.detail,
        tracingIssues: e.tracingIssues,
      })),
    }, null, 2));
    return;
  }
  if (evaluations.length === 0) {
    console.log("✓ No failed tests in report — gate PASS.");
    return;
  }
  console.log(`⚠ ${evaluations.length} failed tests detected:`);
  for (const e of evaluations) {
    const icon = e.verdict === "untraced" ? "✗" : "✓";
    const tag =
      e.verdict === "traced" ? "TRACED"
      : e.verdict === "flake-confirmed" ? "FLAKE confirmed"
      : "UNTRACED";
    console.log(`  ${icon} ${e.failed.file}:${e.failed.line} [${e.failed.status}] — ${tag}: ${e.detail}`);
  }
  const summary = {
    traced: evaluations.filter((e) => e.verdict === "traced").length,
    flake: evaluations.filter((e) => e.verdict === "flake-confirmed").length,
    untraced: evaluations.filter((e) => e.verdict === "untraced").length,
  };
  console.log(
    `\nResult: ${summary.traced} traced, ${summary.flake} flake-confirmed, ${summary.untraced} UNTRACED → gate ${gateOk ? "PASS" : "FAILED"}.`,
  );
}

/** CLI entry — `node scripts/verify/regression-trace-check.mjs ...` で直接起動された時のみ走る */
async function main() {
  /** @type {CliOptions} */
  let opt;
  try {
    opt = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`Error: ${err.message}`);
    printHelp();
    process.exit(2);
  }
  if (opt.help) {
    printHelp();
    process.exit(0);
  }
  if (!opt.autoRun && !opt.resultsPath) {
    console.error("Error: results.json path or --auto-run is required.");
    printHelp();
    process.exit(2);
  }

  try {
    const result = evaluate({
      options: opt,
      loadReport: loadReportFromFile,
      runRegressionSuite: runRegressionSuiteImpl,
      runGh: runGhCli,
      runProc: runProcImpl,
    });
    emitReport(result.evaluations, result.gateOk, opt.jsonOutput);
    process.exit(result.gateOk ? 0 : 1);
  } catch (err) {
    console.error(`Error: ${err.message}`);
    if (opt.verbose) console.error(err.stack);
    process.exit(2);
  }
}

// import される時 (test から) は main() を起動しない
const invokedDirectly = (() => {
  try {
    return resolve(process.argv[1] ?? "") === resolve(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();
if (invokedDirectly) {
  main();
}
