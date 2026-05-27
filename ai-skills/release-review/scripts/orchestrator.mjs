#!/usr/bin/env node
/**
 * release-review orchestrator script (pure node, no deps)
 *
 * 各 subcommand を Bash 経由で呼び出して state.json / findings.jsonl を操作する。
 * 呼出側 (本 skill SKILL.md / orchestrator-briefing.md) は本 script の出力を JSON で受け取る。
 *
 * Usage:
 *   node orchestrator.mjs init --branch <name> [--max-hours N] [--max-issues N] [--exclude-axes csv]
 *   node orchestrator.mjs status --branch <name>           # state.json を JSON で出力
 *   node orchestrator.mjs status-md --branch <name>        # STATUS.md を再生成
 *   node orchestrator.mjs aggregate --branch <name>        # 未分類 findings を分類して pending-* に振り分け
 *   node orchestrator.mjs next --branch <name> --slots N   # 次 dispatch すべき axis list を JSON 出力
 *   node orchestrator.mjs check-stop --branch <name>       # 停止条件評価、true/false を stdout に
 *   node orchestrator.mjs finalize --branch <name>         # STOPPED.md 生成 + 統計出力
 *   node orchestrator.mjs ingest-finding --branch <name> --json '<finding json>'
 *                                                          # Agent からの追加 finding を手動 push (主に test 用)
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync, readdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";

const AXES = [
  "01-schema-spec-drift",
  "02-process-flow-runtime",
  "03-type-contract",
  "04-backend-storage",
  "05-frontend-store",
  "06-test-coverage",
  "07-security",
  "08-dogfood-smoke",
];

const ZERO_ROUNDS_TO_STOP = 3;  // 3 巡連続 0 件で軸 completed
const DEFAULT_MAX_HOURS = 36;

function artDir(branch) {
  return resolve(".tmp/release-review", branch);
}

function statePath(branch) {
  return join(artDir(branch), "state.json");
}

function findingsPath(branch) {
  return join(artDir(branch), "findings.jsonl");
}

function loadState(branch) {
  const p = statePath(branch);
  if (!existsSync(p)) {
    throw new Error(`state.json not found: ${p}. Run 'init' first.`);
  }
  return JSON.parse(readFileSync(p, "utf-8"));
}

function saveState(branch, state) {
  const p = statePath(branch);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(state, null, 2));
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) {
        args[key] = true;
      } else {
        args[key] = next;
        i++;
      }
    }
  }
  return args;
}

function cmdInit(args) {
  const branch = args.branch || `feat/release-review-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}`;
  const maxHours = parseInt(args["max-hours"] || DEFAULT_MAX_HOURS, 10);
  const maxIssues = args["max-issues"] && args["max-issues"] !== "0" ? parseInt(args["max-issues"], 10) : null;
  const excludeAxes = (args["exclude-axes"] || "").split(",").filter(Boolean);

  const state = {
    branch,
    started_at: new Date().toISOString(),
    max_hours: maxHours,
    max_issues: maxIssues,
    excluded_axes: excludeAxes,
    stop_flag: false,
    stop_reason: null,
    axes: {},
    consecutive_global_zero_rounds: 0,
    issued_count: 0,
    auto_fix_count: 0,
    last_wake_at: null,
    last_dispatched_axes: [],
  };

  for (const axis of AXES) {
    if (excludeAxes.includes(axis)) {
      state.axes[axis] = { round: 0, status: "excluded", consecutive_zero: 0, last_findings: null, total_findings: 0 };
    } else {
      state.axes[axis] = { round: 0, status: "pending", consecutive_zero: 0, last_findings: null, total_findings: 0 };
    }
  }

  mkdirSync(artDir(branch), { recursive: true });
  saveState(branch, state);
  // findings.jsonl を初期化 (空)
  writeFileSync(findingsPath(branch), "");
  // auto-fixes.log / issues.log も初期化
  writeFileSync(join(artDir(branch), "auto-fixes.log"), "");
  writeFileSync(join(artDir(branch), "issues.log"), "");

  console.log(JSON.stringify({ ok: true, branch, art_dir: artDir(branch) }));
}

function cmdStatus(args) {
  const state = loadState(args.branch);
  console.log(JSON.stringify(state));
}

function readFindings(branch) {
  const p = findingsPath(branch);
  if (!existsSync(p)) return [];
  return readFileSync(p, "utf-8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => {
      try { return JSON.parse(l); } catch { return null; }
    })
    .filter(Boolean);
}

function cmdAggregate(args) {
  const state = loadState(args.branch);
  const findings = readFindings(args.branch);

  // state.axes[axis].last_processed_index で「ここまで処理済」を管理
  // findings.jsonl の append-only 順序を信頼して index 比較
  const pendingAutofix = [];
  const pendingIssue = [];
  const pendingSpecPending = [];

  // axis 毎に新規 finding を集計
  const newFindingsByAxis = {};
  for (const axis of Object.keys(state.axes)) {
    newFindingsByAxis[axis] = 0;
  }

  for (let i = 0; i < findings.length; i++) {
    const f = findings[i];
    const ax = state.axes[f.axis];
    if (!ax) continue;
    const lastIdx = ax.last_processed_index ?? -1;
    if (i <= lastIdx) continue;  // 既処理 skip

    switch (f.classification) {
      case "auto-fix":
        pendingAutofix.push(f);
        break;
      case "issue":
        pendingIssue.push(f);
        break;
      case "spec-pending":
        pendingSpecPending.push(f);
        break;
      default:
        pendingIssue.push({ ...f, classification: "issue", _defaulted: true });
    }

    newFindingsByAxis[f.axis]++;
    ax.total_findings = (ax.total_findings || 0) + 1;
    ax.last_processed_index = i;
  }

  // dispatched axis に対し new findings 数を反映、consecutive_zero / status を更新
  for (const [axis, ax] of Object.entries(state.axes)) {
    if (ax.status !== "dispatched") continue;
    const cnt = newFindingsByAxis[axis] || 0;
    ax.last_findings = cnt;
    if (cnt === 0) {
      ax.consecutive_zero = (ax.consecutive_zero || 0) + 1;
    } else {
      ax.consecutive_zero = 0;
    }
    // 枯渇判定: 3 連続 0 件で completed
    if (ax.consecutive_zero >= ZERO_ROUNDS_TO_STOP) {
      ax.status = "completed";
    } else {
      ax.status = "pending";  // 次 dispatch 可能状態に戻す
    }
  }

  // pending queue を file 出力
  writeFileSync(
    join(artDir(args.branch), "pending-autofix.jsonl"),
    pendingAutofix.map((f) => JSON.stringify(f)).join("\n") + (pendingAutofix.length ? "\n" : ""),
  );
  writeFileSync(
    join(artDir(args.branch), "pending-issue.jsonl"),
    pendingIssue.map((f) => JSON.stringify(f)).join("\n") + (pendingIssue.length ? "\n" : ""),
  );
  writeFileSync(
    join(artDir(args.branch), "pending-spec-pending.jsonl"),
    pendingSpecPending.map((f) => JSON.stringify(f)).join("\n") + (pendingSpecPending.length ? "\n" : ""),
  );

  saveState(args.branch, state);

  console.log(JSON.stringify({
    autofix: pendingAutofix.length,
    issue: pendingIssue.length,
    spec_pending: pendingSpecPending.length,
  }));
}

function cmdNext(args) {
  const state = loadState(args.branch);
  const slots = parseInt(args.slots || 3, 10);

  if (state.stop_flag) {
    console.log(JSON.stringify([]));
    return;
  }

  // 次 dispatch すべき axis を選ぶ:
  //   - status != excluded && status != completed
  //   - consecutive_zero < ZERO_ROUNDS_TO_STOP
  //   - 重い軸 (08) は同時 1 本固定
  const candidates = [];
  for (const [axis, ax] of Object.entries(state.axes)) {
    if (ax.status === "excluded" || ax.status === "completed") continue;
    if (ax.consecutive_zero >= ZERO_ROUNDS_TO_STOP) {
      // この axis は枯渇判定 → completed
      ax.status = "completed";
      continue;
    }
    candidates.push({ axis, current_round: ax.round, priority: heavyAxisPriority(axis) });
  }

  // priority 順 (重い軸を後回し or 単独) でソート
  candidates.sort((a, b) => a.priority - b.priority);

  // 8 軸の dogfood-smoke (heavy) は単独 dispatch 推奨
  const next = [];
  let heavyInSlot = false;
  for (const c of candidates) {
    if (next.length >= slots) break;
    if (c.axis === "08-dogfood-smoke") {
      if (next.length > 0) continue;  // 他軸と並列しない
      next.push({ axis: c.axis, round: c.current_round + 1 });
      heavyInSlot = true;
      break;
    }
    if (heavyInSlot) break;
    next.push({ axis: c.axis, round: c.current_round + 1 });
  }

  // 各 axis の status を dispatched に
  for (const { axis, round } of next) {
    state.axes[axis].status = "dispatched";
    state.axes[axis].round = round;
    state.axes[axis].last_findings = 0;  // 新 round の findings カウント開始
  }

  state.last_wake_at = new Date().toISOString();
  state.last_dispatched_axes = next.map((n) => n.axis);
  saveState(args.branch, state);

  console.log(JSON.stringify(next));
}

function heavyAxisPriority(axis) {
  if (axis === "08-dogfood-smoke") return 100;
  if (axis === "02-process-flow-runtime") return 50;
  return 10;
}

function cmdCheckStop(args) {
  const state = loadState(args.branch);

  if (state.stop_flag) {
    console.log(JSON.stringify({ stop: true, reason: state.stop_reason }));
    return;
  }

  // wall-clock cap
  const elapsed = (Date.now() - new Date(state.started_at).getTime()) / 1000 / 3600;
  if (elapsed >= state.max_hours) {
    state.stop_flag = true;
    state.stop_reason = `max_hours_cap (${elapsed.toFixed(1)}h >= ${state.max_hours}h)`;
    saveState(args.branch, state);
    console.log(JSON.stringify({ stop: true, reason: state.stop_reason }));
    return;
  }

  // max-issues cap
  if (state.max_issues !== null && state.issued_count >= state.max_issues) {
    state.stop_flag = true;
    state.stop_reason = `max_issues_cap (${state.issued_count} >= ${state.max_issues})`;
    saveState(args.branch, state);
    console.log(JSON.stringify({ stop: true, reason: state.stop_reason }));
    return;
  }

  // 全 axis が completed or excluded か
  const remaining = Object.entries(state.axes).filter(
    ([_, ax]) => ax.status !== "completed" && ax.status !== "excluded"
  );
  if (remaining.length === 0) {
    state.stop_flag = true;
    state.stop_reason = "all_axes_completed";
    saveState(args.branch, state);
    console.log(JSON.stringify({ stop: true, reason: state.stop_reason }));
    return;
  }

  console.log(JSON.stringify({ stop: false, remaining_axes: remaining.length, elapsed_hours: elapsed.toFixed(2) }));
}

function cmdFinalize(args) {
  const state = loadState(args.branch);
  const findings = readFindings(args.branch);
  const branch = args.branch;

  const totalFindings = findings.length;
  const byClass = findings.reduce((acc, f) => {
    acc[f.classification] = (acc[f.classification] || 0) + 1;
    return acc;
  }, {});
  const bySeverity = findings.reduce((acc, f) => {
    acc[f.severity] = (acc[f.severity] || 0) + 1;
    return acc;
  }, {});

  const elapsed = ((Date.now() - new Date(state.started_at).getTime()) / 1000 / 3600).toFixed(2);

  const md = `# release-review STOPPED — ${branch}

Started: ${state.started_at}
Stopped: ${new Date().toISOString()} (elapsed: ${elapsed}h)
Reason: ${state.stop_reason || "n/a"}

## 統計

- 総 findings: ${totalFindings}
- by classification: ${JSON.stringify(byClass)}
- by severity: ${JSON.stringify(bySeverity)}
- auto-fix commits: ${state.auto_fix_count}
- issues 起票: ${state.issued_count}

## 軸別

${Object.entries(state.axes).map(([axis, ax]) =>
  `- ${axis}: round=${ax.round} status=${ax.status} total=${ax.total_findings || 0}`
).join("\n")}

## 次のアクション (ユーザー判断)

- [ ] 本 STOPPED.md の停止理由を確認
- [ ] auto-fix commit 一覧を \`cat .tmp/release-review/${branch}/auto-fixes.log\` で確認
- [ ] 起票 ISSUE 一覧を \`gh issue list --label release-review --state open\` で確認
- [ ] 再開する場合: \`/release-review --resume --branch ${branch}\`
- [ ] 中止する場合: branch を削除 or PR を draft のまま放置
`;

  writeFileSync(join(artDir(branch), "STOPPED.md"), md);
  console.log(JSON.stringify({ ok: true, stopped_md: join(artDir(branch), "STOPPED.md"), stats: { totalFindings, byClass, bySeverity } }));
}

function cmdStatusMd(args) {
  const state = loadState(args.branch);
  const findings = readFindings(args.branch);
  const elapsed = ((Date.now() - new Date(state.started_at).getTime()) / 1000 / 3600).toFixed(2);

  const recentActions = [];
  // auto-fixes.log と issues.log の末尾を取り込む
  for (const log of ["auto-fixes.log", "issues.log"]) {
    const p = join(artDir(args.branch), log);
    if (existsSync(p)) {
      const lines = readFileSync(p, "utf-8").split("\n").filter((l) => l.trim()).slice(-5);
      recentActions.push(...lines.map((l) => `[${log}] ${l}`));
    }
  }

  const md = `# release-review status — ${args.branch}

Started: ${state.started_at} (elapsed: ${elapsed}h / ${state.max_hours}h cap)
Stop flag: ${state.stop_flag} ${state.stop_reason ? `(reason: ${state.stop_reason})` : ""}

## 軸別進捗

| 軸 | round | status | last findings | total | consec_zero |
|---|---|---|---|---|---|
${Object.entries(state.axes).map(([axis, ax]) =>
  `| ${axis} | ${ax.round} | ${ax.status} | ${ax.last_findings ?? "-"} | ${ax.total_findings || 0} | ${ax.consecutive_zero || 0} |`
).join("\n")}

## 全体統計

- Total findings: ${findings.length}
- auto-fix commits: ${state.auto_fix_count}
- ISSUE 起票: ${state.issued_count}
- last wake: ${state.last_wake_at || "n/a"}
- last dispatched axes: ${(state.last_dispatched_axes || []).join(", ") || "(none)"}

## 直近 actions (auto-fix / ISSUE)

${recentActions.length ? recentActions.join("\n") : "(none yet)"}
`;

  writeFileSync(join(artDir(args.branch), "STATUS.md"), md);
  console.log(JSON.stringify({ ok: true, path: join(artDir(args.branch), "STATUS.md") }));
}

function cmdIngestFinding(args) {
  // 主に dry-run test 用、Agent 側は直接 findings.jsonl に append する想定
  const branch = args.branch;
  if (!existsSync(artDir(branch))) throw new Error(`branch dir not initialized: ${branch}`);
  const f = JSON.parse(args.json);
  if (!f.discovered_at) f.discovered_at = new Date().toISOString();
  appendFileSync(findingsPath(branch), JSON.stringify(f) + "\n");
  console.log(JSON.stringify({ ok: true, finding: f }));
}

// ── dispatch ──
const [, , cmd, ...rest] = process.argv;
const args = parseArgs(rest);

switch (cmd) {
  case "init": cmdInit(args); break;
  case "status": cmdStatus(args); break;
  case "status-md": cmdStatusMd(args); break;
  case "aggregate": cmdAggregate(args); break;
  case "next": cmdNext(args); break;
  case "check-stop": cmdCheckStop(args); break;
  case "finalize": cmdFinalize(args); break;
  case "ingest-finding": cmdIngestFinding(args); break;
  default:
    console.error(`Unknown command: ${cmd}`);
    console.error(`Usage: node orchestrator.mjs <init|status|status-md|aggregate|next|check-stop|finalize|ingest-finding> [--args]`);
    process.exit(1);
}
