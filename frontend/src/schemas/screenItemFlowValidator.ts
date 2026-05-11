/**
 * 画面項目イベント ↔ 処理フロー連携の整合検査 (#619 / #624 / #1019)。
 *
 * 検査観点:
 * 1. UNKNOWN_HANDLER_FLOW         — ScreenItem.events[].handlerFlowId が指す
 *                                   ProcessFlow が同プロジェクト内に実在するか
 * 2. UNKNOWN_HANDLER_ACTION       — events[].handlerActionId が指す action が
 *                                   target ProcessFlow.actions[] に実在するか (#1019)
 * 3. AMBIGUOUS_HANDLER_ACTION     — handlerActionId 省略時、target ProcessFlow が
 *                                   複数 action を持つ (どれを実行するか不定) (#1019)
 * 4. MISSING_REQUIRED_ARGUMENT    — handlerActionId が指す action の required input が
 *                                   argumentMapping で渡されているか
 * 5. EXTRA_ARGUMENT               — argumentMapping のキーが action.inputs[]
 *                                   に存在しないものを参照していないか
 * 6. PRIMARY_INVOKER_MISMATCH     — ProcessFlow.meta.primaryInvoker (宣言時)
 *                                   が指す ScreenItem イベントが、画面項目側でも
 *                                   handlerFlowId+handlerActionId: <本フロー>+<本 action>
 *                                   で逆参照されているか
 * 7. INCONSISTENT_ARGUMENT_CONTRACT — 1 (ProcessFlow, action) が複数イベントから呼ばれる
 *                                     場合の argumentMapping キー集合の整合 (warning)
 * 8. DUPLICATE_EVENT_ID            — 画面項目内 events[].id 重複検出
 */

import type { ProcessFlow, StructuredField, Screen, ScreenItem, ScreenItemEvent } from "../types/v3";

export type ScreenItemFlowIssueCode =
  | "UNKNOWN_HANDLER_FLOW"
  | "UNKNOWN_HANDLER_ACTION"
  | "AMBIGUOUS_HANDLER_ACTION"
  | "MISSING_REQUIRED_ARGUMENT"
  | "EXTRA_ARGUMENT"
  | "PRIMARY_INVOKER_MISMATCH"
  | "INCONSISTENT_ARGUMENT_CONTRACT"
  | "DUPLICATE_EVENT_ID";

/**
 * 本 validator は他 4 validator (sqlColumnValidator / conventionsValidator /
 * referentialIntegrity / identifierScope) と異なり severity を持つ最初の validator。
 * INCONSISTENT_ARGUMENT_CONTRACT が「設計上問題ない場合もある」 (異なるユースケースで
 * 意図的に異なる引数集合を渡したい) 性質のため warning とする。他観点はすべて error。
 * 将来他 validator に warning 観点が追加される際は本パターンに揃える。
 */
export interface ScreenItemFlowIssue {
  path: string;
  code: ScreenItemFlowIssueCode;
  severity: "error" | "warning";
  message: string;
}

interface CallSite {
  path: string;
  argKeys: Set<string>;
}

function getFlowId(flow: ProcessFlow): string | null {
  return flow.meta?.id ?? null;
}

function getScreenId(screen: Screen): string | null {
  return (screen.id as string | undefined) ?? null;
}

/**
 * #1019: handlerActionId が指す action の inputs[] を取得する。
 * - actionId 指定時: 該当 action の inputs[] (action 不在時 null)
 * - actionId 省略時: actions が 1 件のみなら actions[0].inputs[] (それ以外は null = AMBIGUOUS)
 */
function resolveActionInputs(
  flow: ProcessFlow,
  actionId: string | undefined,
): { inputs: StructuredField[]; resolution: "found" | "ambiguous" | "unknown-action" } {
  const actions = flow.actions ?? [];
  if (actionId) {
    const action = actions.find((a) => a.id === actionId);
    if (!action) return { inputs: [], resolution: "unknown-action" };
    return { inputs: action.inputs ?? [], resolution: "found" };
  }
  if (actions.length === 1) {
    return { inputs: actions[0].inputs ?? [], resolution: "found" };
  }
  return { inputs: [], resolution: "ambiguous" };
}

/**
 * 全プロジェクトの ProcessFlow と Screen を入力に、画面項目イベントと処理フロー
 * 連携の整合を検証。空配列なら問題なし。
 */
export function checkScreenItemFlowConsistency(
  flows: ProcessFlow[],
  screens: Screen[],
): ScreenItemFlowIssue[] {
  const issues: ScreenItemFlowIssue[] = [];

  // ProcessFlow を id 索引に
  const flowById = new Map<string, ProcessFlow>();
  for (const flow of flows) {
    const id = getFlowId(flow);
    if (id) flowById.set(id, flow);
  }

  // 1. ScreenItem.events[] 検査 + 多重定義検出のための collect
  const flowToCallSites = new Map<string, CallSite[]>();

  screens.forEach((screen, si) => {
    const screenLabel = getScreenId(screen) ?? `screens[${si}]`;
    const items = screen.items ?? [];

    items.forEach((item: ScreenItem, ii) => {
      const events = item.events ?? [];

      // events[].id 重複検査 (画面項目内ユニーク制約、JSON Schema 標準では表現不能のため validator で担保)
      const eventIdCounts = new Map<string, number>();
      for (const event of events) {
        eventIdCounts.set(event.id, (eventIdCounts.get(event.id) ?? 0) + 1);
      }
      for (const [eid, count] of eventIdCounts) {
        if (count > 1) {
          issues.push({
            path: `${screenLabel}.items[${ii}=${item.id}]`,
            code: "DUPLICATE_EVENT_ID",
            severity: "error",
            message: `event ID '${eid}' が画面項目内で ${count} 回出現しています (画面項目内ユニーク制約違反)。`,
          });
        }
      }

      events.forEach((event: ScreenItemEvent, ei) => {
        const path = `${screenLabel}.items[${ii}=${item.id}].events[${ei}=${event.id}]`;

        // 1.1 handlerFlowId 実在検査
        const targetFlow = flowById.get(event.handlerFlowId);
        if (!targetFlow) {
          issues.push({
            path,
            code: "UNKNOWN_HANDLER_FLOW",
            severity: "error",
            message: `handlerFlowId '${event.handlerFlowId}' が指す処理フローが見つかりません。`,
          });
          return;
        }

        // 1.2 handlerActionId 解決 (#1019)
        const { inputs, resolution } = resolveActionInputs(targetFlow, event.handlerActionId);
        if (resolution === "unknown-action") {
          issues.push({
            path,
            code: "UNKNOWN_HANDLER_ACTION",
            severity: "error",
            message: `handlerActionId '${event.handlerActionId}' が処理フロー '${event.handlerFlowId}' の actions[] に存在しません。`,
          });
          return;
        }
        if (resolution === "ambiguous") {
          const actionIds = (targetFlow.actions ?? []).map((a) => a.id).join(", ");
          issues.push({
            path,
            code: "AMBIGUOUS_HANDLER_ACTION",
            severity: "error",
            message: `handlerActionId が省略されていますが処理フロー '${event.handlerFlowId}' は複数 action を持ちます (${actionIds})。handlerActionId で指定してください。`,
          });
          return;
        }

        // 1.3 引数 contract 整合 (action 単位)
        const argMapping = event.argumentMapping ?? {};
        // StructuredField.name は v3 で Identifier brand 型のため、Set<string> として比較するため cast
        const inputNames = new Set<string>(inputs.map((i) => i.name as string));

        // 必須引数欠落
        for (const input of inputs) {
          if (input.required && !(input.name in argMapping)) {
            issues.push({
              path,
              code: "MISSING_REQUIRED_ARGUMENT",
              severity: "error",
              message: `argumentMapping に action '${event.handlerActionId ?? targetFlow.actions?.[0]?.id ?? ""}' の必須引数 '${input.name}' が欠落しています。`,
            });
          }
        }

        // 余剰引数
        for (const argKey of Object.keys(argMapping)) {
          if (!inputNames.has(argKey)) {
            issues.push({
              path: `${path}.argumentMapping.${argKey}`,
              code: "EXTRA_ARGUMENT",
              severity: "error",
              message: `argumentMapping のキー '${argKey}' が action '${event.handlerActionId ?? targetFlow.actions?.[0]?.id ?? ""}' の inputs[] に存在しません。`,
            });
          }
        }

        // 多重定義検出のために collect ((flow, action) 単位 #1019)
        const resolvedActionId = event.handlerActionId ?? targetFlow.actions?.[0]?.id ?? "";
        const callSiteKey = `${event.handlerFlowId}#${resolvedActionId}`;
        const sites = flowToCallSites.get(callSiteKey) ?? [];
        sites.push({ path, argKeys: new Set(Object.keys(argMapping)) });
        flowToCallSites.set(callSiteKey, sites);
      });
    });
  });

  // 2. ProcessFlow.meta.primaryInvoker 双方向整合検査
  flows.forEach((flow, fi) => {
    const flowId = getFlowId(flow);
    const primaryInvoker = flow.meta?.primaryInvoker;
    if (!primaryInvoker || !flowId) return;
    if (primaryInvoker.kind !== "screen-item-event") return;

    const path = `flows[${fi}=${flowId}].meta.primaryInvoker`;

    const screen = screens.find((s) => getScreenId(s) === primaryInvoker.screenId);
    if (!screen) {
      issues.push({
        path,
        code: "PRIMARY_INVOKER_MISMATCH",
        severity: "error",
        message: `primaryInvoker.screenId '${primaryInvoker.screenId}' が指す画面が見つかりません。`,
      });
      return;
    }

    const item = screen.items?.find((i) => i.id === primaryInvoker.itemId);
    if (!item) {
      issues.push({
        path,
        code: "PRIMARY_INVOKER_MISMATCH",
        severity: "error",
        message: `primaryInvoker.itemId '${primaryInvoker.itemId}' が画面 '${primaryInvoker.screenId}' に存在しません。`,
      });
      return;
    }

    const event = item.events?.find((e) => e.id === primaryInvoker.eventId);
    if (!event) {
      issues.push({
        path,
        code: "PRIMARY_INVOKER_MISMATCH",
        severity: "error",
        message: `primaryInvoker.eventId '${primaryInvoker.eventId}' が画面項目 '${primaryInvoker.itemId}' に存在しません。`,
      });
      return;
    }

    if (event.handlerFlowId !== flowId) {
      issues.push({
        path,
        code: "PRIMARY_INVOKER_MISMATCH",
        severity: "error",
        message: `primaryInvoker が指す画面項目イベントの handlerFlowId は '${event.handlerFlowId}' で、本フロー ID '${flowId}' と一致しません (双方向整合)。`,
      });
      return;
    }

    // #1019: actionId が宣言されている場合、画面項目側 event の handlerActionId と一致するか
    // (両者省略時 = actions[0] 黙示一致は OK、片側のみ宣言は不整合)
    const invokerActionId = (primaryInvoker as { actionId?: string }).actionId;
    const eventActionId = event.handlerActionId;
    if ((invokerActionId ?? null) !== (eventActionId ?? null)) {
      issues.push({
        path,
        code: "PRIMARY_INVOKER_MISMATCH",
        severity: "error",
        message: `primaryInvoker.actionId '${invokerActionId ?? "(省略)"}' と画面項目イベント側 handlerActionId '${eventActionId ?? "(省略)"}' が一致しません。`,
      });
    }
  });

  // 3. 多重定義検出 (warning) — (flow, action) 単位 (#1019)
  // 比較は sites[0] を基点とする単純実装。3+ サイトある場合 sites[0] と sites[2] が同一でも
  // sites[1] が異なれば sites[1] のみ検出される (全ペア比較ではない)。実用上 1 (flow, action) を呼ぶ
  // 全 site は同一引数集合であるべきなので sites[0] 基点で十分。将来全ペア比較が必要なら拡張。
  // また UNKNOWN_HANDLER_FLOW / UNKNOWN_HANDLER_ACTION / AMBIGUOUS_HANDLER_ACTION で early return
  // した event は collect されないため、エラー event は多重定義の比較基点にならない。
  for (const [callSiteKey, sites] of flowToCallSites) {
    if (sites.length <= 1) continue;
    const baseKeys = sites[0].argKeys;
    for (let i = 1; i < sites.length; i++) {
      const keys = sites[i].argKeys;
      const sameSize = keys.size === baseKeys.size;
      const sameKeys = sameSize && [...keys].every((k) => baseKeys.has(k));
      if (!sameKeys) {
        issues.push({
          path: sites[i].path,
          code: "INCONSISTENT_ARGUMENT_CONTRACT",
          severity: "warning",
          message: `処理フロー action '${callSiteKey}' を呼ぶ複数イベント間で argumentMapping のキー集合が異なります。最初の site '${sites[0].path}' と整合確認を推奨。`,
        });
      }
    }
  }

  return issues;
}
