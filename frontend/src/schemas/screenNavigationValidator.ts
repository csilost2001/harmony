/**
 * 画面遷移整合検査 (#650, Phase 4 子 2)。
 *
 * 画面フロー edges (project.entities.screenTransitions) × ScreenTransitionStep
 * (ProcessFlow 内) × URL ルーティング (Screen.path / Screen.auth) の三者を交差検査する。
 *
 * 検査観点 (7 件):
 *   1. UNKNOWN_TARGET_SCREEN     — error   ScreenTransitionStep.targetScreenId が画面実在しない
 *   2. MISSING_FLOW_EDGE         — warning step の (source→target) を指す ScreenTransitionEntry が無い
 *                                          (グラフ図に出ない実行時遷移)
 *   3. MISSING_FLOW_TRANSITION   — error   kind="flow-driven" な edge に対応する
 *                                          ScreenTransitionStep が一切ない (#744、旧 ORPHAN_FLOW_EDGE
 *                                          を再定義: kind="navigation" は純 UI 遷移なので検出対象外)
 *   4. DUPLICATE_SCREEN_PATH     — error   複数 Screen が同一 path を宣言 (URL 衝突)
 *   5. PATH_PARAM_MISMATCH       — warning target.path に :param があり source.path に同 :param が
 *                                          存在しない (実行時パラメータ取得不能の候補)
 *   6. AUTH_TRANSITION_VIOLATION — error   auth=none → auth=required への直接遷移
 *                                          (kind=login / kind=error への遷移は例外)
 *   7. DEAD_END_SCREEN           — warning kind が complete / error 以外の画面で、edge / step の
 *                                          source にも一切登場しない遷移先のみの画面
 *
 * source 画面の決定 (優先順):
 *   1. flow.meta.screenId (kind=screen のフロー)
 *   2. flow.meta.primaryInvoker.screenId (kind=screen-item-event)
 *   3. screen.items[].events[].handlerFlowId 経由の逆引き
 *
 * source 不明の場合、source を要する観点 (2 / 5 / 6) はスキップ。観点 1 / 3 / 4 / 7 は
 * source 不要 (target のみ / edge 一覧のみ / 全画面 / 全画面 + 全 source 集合) で実施可能。
 *
 * (e)(f)(g)(h)(i) 設計判断 (設計者承認済):
 *   (e) MISSING_FLOW_EDGE — warning (draft-state ポリシー準拠)。
 *       旧 ORPHAN_FLOW_EDGE は #744 で MISSING_FLOW_TRANSITION (error) に再定義
 *       (kind="flow-driven" のみ対象、kind="navigation" は純 UI 遷移として検出対象外)
 *   (f) forward / replace / popup の遷移種別拡張 — 本 ISSUE スコープ外
 *   (g) AUTH_TRANSITION_VIOLATION 例外 — kind=login / kind=error のみ例外
 *   (h) PATH_PARAM_MISMATCH 厳密度 — 軽量 (source.path に同 :param が無ければ warning のみ)
 *   (i) サンプル投入範囲 — healthcare 完備 + welfare-benefit 1 edge (retail 完備は子1 マージ後 rebase)
 */

import type { ProcessFlow, Screen, Step, ScreenTransitionStep } from "../types/v3";
import type { ScreenTransitionEntry } from "../types/v3/project";
import { isBuiltinStep } from "./stepGuards";

// ─── 出力型 ────────────────────────────────────────────────────────────────

export type ScreenNavigationIssueCode =
  | "UNKNOWN_TARGET_SCREEN"
  | "MISSING_FLOW_EDGE"
  | "MISSING_FLOW_TRANSITION"
  | "DUPLICATE_SCREEN_PATH"
  | "PATH_PARAM_MISMATCH"
  | "AUTH_TRANSITION_VIOLATION"
  | "DEAD_END_SCREEN";

export interface ScreenNavigationIssue {
  path: string;
  code: ScreenNavigationIssueCode;
  severity: "error" | "warning";
  message: string;
}

// ─── ヘルパー ──────────────────────────────────────────────────────────────

/** path 文字列から `:param` 名を全抽出 (順序保持、重複も保持)。 */
function extractPathParams(path: string): string[] {
  const out: string[] = [];
  if (!path) return out;
  const re = /:([a-zA-Z_][a-zA-Z0-9_]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(path)) !== null) out.push(m[1]);
  return out;
}

/** Screen の id 取得 (cast helper)。 */
function getScreenId(screen: Screen): string | null {
  return (screen.id as string | undefined) ?? null;
}

/** Step 列を再帰的に走査して visitor を呼ぶ (sqlOrderValidator.walkStepsInOrder と同じ構造)。 */
function walkAllSteps(
  steps: Step[],
  basePath: string,
  visitor: (step: Step, path: string) => void,
): void {
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const path = `${basePath}[${i}]`;
    visitor(step, path);
    if (!isBuiltinStep(step)) continue;
    if (step.kind === "branch") {
      step.branches.forEach((b, bi) =>
        walkAllSteps(b.steps, `${path}.branches[${bi}].steps`, visitor),
      );
      if (step.elseBranch) walkAllSteps(step.elseBranch.steps, `${path}.elseBranch.steps`, visitor);
    }
    if (step.kind === "loop") walkAllSteps(step.steps, `${path}.steps`, visitor);
    if (step.kind === "transactionScope") {
      walkAllSteps(step.steps, `${path}.steps`, visitor);
      if (step.onCommit) walkAllSteps(step.onCommit, `${path}.onCommit`, visitor);
      if (step.onRollback) walkAllSteps(step.onRollback, `${path}.onRollback`, visitor);
    }
    if (step.kind === "externalSystem") {
      Object.entries(step.outcomes ?? {}).forEach(([k, spec]) => {
        if (spec?.sideEffects) walkAllSteps(spec.sideEffects, `${path}.outcomes.${k}.sideEffects`, visitor);
      });
    }
  }
}

// ─── source 画面決定ロジック ───────────────────────────────────────────────

/**
 * フローの source 画面 ID を決定する (3 段階フォールバック)。
 *
 * 1. flow.meta.screenId (kind=screen)
 * 2. flow.meta.primaryInvoker.screenId (kind=screen-item-event)
 * 3. event 逆引き: handlerFlowId === flow.id を持つ画面
 *    (画面項目 events 経由で flow を呼ぶ画面)
 */
function determineSourceScreenId(
  flow: ProcessFlow,
  screens: Screen[],
): string | null {
  // 1. flow.meta.screenId (kind=screen のフロー)
  if (flow.meta?.screenId) return flow.meta.screenId as string;

  // 2. primaryInvoker.screenId (kind=screen-item-event)
  const inv = flow.meta?.primaryInvoker;
  if (inv && inv.kind === "screen-item-event" && inv.screenId) {
    return inv.screenId as string;
  }

  // 3. event 逆引き
  const flowId = flow.meta?.id;
  if (!flowId) return null;
  for (const screen of screens) {
    const items = screen.items ?? [];
    for (const item of items) {
      const events = item.events ?? [];
      for (const ev of events) {
        if (ev.handlerFlowId === flowId) {
          return getScreenId(screen);
        }
      }
    }
  }
  return null;
}

// ─── メイン関数 ────────────────────────────────────────────────────────────

/**
 * プロジェクト全体を入力に、画面遷移整合の問題を返す。空配列なら問題なし。
 */
export function checkScreenNavigation(
  flows: ProcessFlow[],
  screens: Screen[],
  screenTransitions: ScreenTransitionEntry[],
): ScreenNavigationIssue[] {
  const issues: ScreenNavigationIssue[] = [];

  // 画面 id → Screen インデックス
  const screenById = new Map<string, Screen>();
  for (const screen of screens) {
    const id = getScreenId(screen);
    if (id) screenById.set(id, screen);
  }

  // ── 観点 4: DUPLICATE_SCREEN_PATH ──
  const pathToScreens = new Map<string, Screen[]>();
  for (const screen of screens) {
    const path = screen.path;
    if (!path) continue;
    const arr = pathToScreens.get(path) ?? [];
    arr.push(screen);
    pathToScreens.set(path, arr);
  }
  for (const [path, group] of pathToScreens) {
    if (group.length <= 1) continue;
    const ids = group.map((s) => getScreenId(s) ?? "(unknown)").join(", ");
    for (const screen of group) {
      const sid = getScreenId(screen) ?? "(unknown)";
      issues.push({
        path: `screens[${sid}].path`,
        code: "DUPLICATE_SCREEN_PATH",
        severity: "error",
        message: `URL path '${path}' が複数画面で重複宣言されています (${ids})。一意である必要があります。`,
      });
    }
  }

  // ── ScreenTransitionStep 収集 (観点 1 / 2 / 5 / 6 / 7 で利用) ──
  // step ごとの (sourceScreenId | null, targetScreenId, path) を蓄積
  interface CollectedStep {
    sourcePath: string; // issue 報告用 path
    sourceScreenId: string | null;
    targetScreenId: string;
    flowId: string | null;
  }
  const collectedSteps: CollectedStep[] = [];

  flows.forEach((flow, fi) => {
    const flowId = (flow.meta?.id ?? null) as string | null;
    const flowLabel = flowId ?? `flows[${fi}]`;
    const sourceScreenId = determineSourceScreenId(flow, screens);

    flow.actions?.forEach((action, ai) => {
      walkAllSteps(action.steps ?? [], `${flowLabel}.actions[${ai}].steps`, (step, path) => {
        if (!isBuiltinStep(step)) return;
        if (step.kind !== "screenTransition") return;
        const stStep = step as ScreenTransitionStep;
        const targetScreenId = stStep.targetScreenId as string;
        if (!targetScreenId) return;

        collectedSteps.push({
          sourcePath: path,
          sourceScreenId,
          targetScreenId,
          flowId,
        });

        // ── 観点 1: UNKNOWN_TARGET_SCREEN ──
        if (!screenById.has(targetScreenId)) {
          issues.push({
            path,
            code: "UNKNOWN_TARGET_SCREEN",
            severity: "error",
            message: `targetScreenId '${targetScreenId}' が指す画面がプロジェクトに存在しません。`,
          });
          return;
        }

        const targetScreen = screenById.get(targetScreenId)!;

        // ── 観点 5: PATH_PARAM_MISMATCH (軽量実装、source 必要) ──
        if (sourceScreenId) {
          const sourceScreen = screenById.get(sourceScreenId);
          if (sourceScreen) {
            const targetParams = extractPathParams(targetScreen.path ?? "");
            const sourceParams = new Set(extractPathParams(sourceScreen.path ?? ""));
            const missing = targetParams.filter((p) => !sourceParams.has(p));
            if (missing.length > 0) {
              issues.push({
                path,
                code: "PATH_PARAM_MISMATCH",
                severity: "warning",
                message: `target '${targetScreen.path}' は path パラメータ [:${missing.join(", :")}] を要求しますが、source '${sourceScreen.path}' に同パラメータがありません。実行時に値を解決できない可能性があります。`,
              });
            }
          }
        }

        // ── 観点 6: AUTH_TRANSITION_VIOLATION (source 必要) ──
        // (g) 例外: target.kind が 'login' または 'error' なら除外
        if (sourceScreenId) {
          const sourceScreen = screenById.get(sourceScreenId);
          if (sourceScreen) {
            const sourceAuth = sourceScreen.auth ?? "required";
            const targetAuth = targetScreen.auth ?? "required";
            const targetKind = String(targetScreen.kind ?? "");
            const isExempt = targetKind === "login" || targetKind === "error";
            if (sourceAuth === "none" && targetAuth === "required" && !isExempt) {
              issues.push({
                path,
                code: "AUTH_TRANSITION_VIOLATION",
                severity: "error",
                message: `auth=none 画面 '${sourceScreen.path}' から auth=required 画面 '${targetScreen.path}' (kind=${targetKind || "?"}) への直接遷移は不正です。中間に login 画面を挟む必要があります。`,
              });
            }
          }
        }
      });
    });
  });

  // ── 観点 2: MISSING_FLOW_EDGE / 観点 3: MISSING_FLOW_TRANSITION ──
  // edge 集合 (sourceScreenId → targetScreenId) の Set
  const edgeSet = new Set<string>();
  for (const entry of screenTransitions) {
    const src = entry.sourceScreenId as string;
    const tgt = entry.targetScreenId as string;
    if (src && tgt) edgeSet.add(`${src}→${tgt}`);
  }

  // step 側の (source, target) Set (source 不明はスキップ)
  const stepEdgeSet = new Set<string>();
  for (const cs of collectedSteps) {
    if (!cs.sourceScreenId) continue;
    if (!screenById.has(cs.targetScreenId)) continue; // 観点 1 で報告済
    stepEdgeSet.add(`${cs.sourceScreenId}→${cs.targetScreenId}`);
  }

  // 観点 2: step が edge に存在しない
  for (const cs of collectedSteps) {
    if (!cs.sourceScreenId) continue;
    if (!screenById.has(cs.targetScreenId)) continue;
    const key = `${cs.sourceScreenId}→${cs.targetScreenId}`;
    if (!edgeSet.has(key)) {
      issues.push({
        path: cs.sourcePath,
        code: "MISSING_FLOW_EDGE",
        severity: "warning",
        message: `ScreenTransitionStep が遷移する (${cs.sourceScreenId} → ${cs.targetScreenId}) に対応する画面フロー edge が screenTransitions に宣言されていません。グラフ図に出ない実行時遷移になります。`,
      });
    }
  }

  // 観点 3: MISSING_FLOW_TRANSITION (kind="flow-driven" のみ対象、#744)
  // kind 省略 / "navigation" は純 UI 遷移として処理不要なので検出対象外。
  for (const entry of screenTransitions) {
    const src = entry.sourceScreenId as string;
    const tgt = entry.targetScreenId as string;
    if (!src || !tgt) continue;
    const kind = entry.kind ?? "navigation";
    if (kind !== "flow-driven") continue;
    const key = `${src}→${tgt}`;
    if (!stepEdgeSet.has(key)) {
      issues.push({
        path: `screenTransitions[${entry.id}]`,
        code: "MISSING_FLOW_TRANSITION",
        severity: "error",
        message: `kind="flow-driven" な画面フロー edge (${src} → ${tgt}) に対応する ScreenTransitionStep がいずれの ProcessFlow にも存在しません。処理を伴わない純 UI 遷移なら kind="navigation" にしてください。`,
      });
    }
  }

  // ── 観点 7: DEAD_END_SCREEN ──
  // source として登場した画面集合 (edge.source ∪ step.source)
  const sourceScreenIds = new Set<string>();
  for (const entry of screenTransitions) {
    if (entry.sourceScreenId) sourceScreenIds.add(entry.sourceScreenId as string);
  }
  for (const cs of collectedSteps) {
    if (cs.sourceScreenId) sourceScreenIds.add(cs.sourceScreenId);
  }
  // target として登場した画面集合
  const targetScreenIds = new Set<string>();
  for (const entry of screenTransitions) {
    if (entry.targetScreenId) targetScreenIds.add(entry.targetScreenId as string);
  }
  for (const cs of collectedSteps) {
    if (screenById.has(cs.targetScreenId)) {
      targetScreenIds.add(cs.targetScreenId);
    }
  }

  for (const screen of screens) {
    const sid = getScreenId(screen);
    if (!sid) continue;
    const kind = String(screen.kind ?? "");
    if (kind === "complete" || kind === "error") continue; // 終端画面は除外
    // 遷移先のみで source に一切登場しない場合 dead-end (target にもならない孤立画面は別問題なので
    // target に登場することは必須としない — 「target になっているのに source にならない」が dead-end)
    if (!targetScreenIds.has(sid)) continue; // target にもならない画面 (≒孤立画面、別観点で扱う想定)
    if (sourceScreenIds.has(sid)) continue; // source にもなる → OK
    issues.push({
      path: `screens[${sid}]`,
      code: "DEAD_END_SCREEN",
      severity: "warning",
      message: `画面 '${screen.path ?? sid}' (kind=${kind}) は遷移先になっていますが、ここから先への遷移が一切定義されていません (kind=complete/error の終端画面ではないのに行き止まりになっています)。`,
    });
  }

  return issues;
}
