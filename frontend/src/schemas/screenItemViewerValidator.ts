/**
 * viewer screen-item 整合検証 (#762)
 *
 * 検査観点 (3 件):
 * 1. UNKNOWN_VIEWER_VIEW_DEFINITION (error)  — direction='viewer' の viewDefinitionId が
 *    プロジェクト内の ViewDefinition に存在しない
 * 2. MISSING_VIEWER_VIEW_DEFINITION (error)  — direction='viewer' だが viewDefinitionId が無い
 *    (schema レベルで弾かれるが、partial JSON 編集中も検出する保険)
 * 3. VIEWER_FLOW_VARIABLE_NOT_DECLARED (warning) — valueFrom.kind='flowVariable' の variableName が
 *    参照先 ProcessFlow の variables / outputs / inputs のいずれにも宣言されていない
 */

import type { Screen } from "../types/v3/screen.js";
import type { ScreenItem } from "../types/v3/screen-item.js";
import type { ProcessFlow } from "../types/v3/process-flow.js";
import type { ViewDefinition } from "../types/v3/view-definition.js";

export type ScreenItemViewerIssueCode =
  | "UNKNOWN_VIEWER_VIEW_DEFINITION"
  | "MISSING_VIEWER_VIEW_DEFINITION"
  | "VIEWER_FLOW_VARIABLE_NOT_DECLARED";

export interface ScreenItemViewerIssue {
  path: string;
  code: ScreenItemViewerIssueCode;
  severity: "error" | "warning";
  message: string;
}

function getScreenId(screen: Screen): string {
  return (screen.id as string | undefined) ?? "<unknown>";
}

function getFlowId(flow: ProcessFlow): string | null {
  return flow.meta?.id ?? null;
}

/**
 * ProcessFlow から宣言された全変数名を収集する。
 * actions[0] の inputs[] / outputs[] と、context.variables 相当を収集対象とする。
 * 全 v3 sample で actions 数 = 1 のため actions[0] を primary とする。
 */
function collectFlowVariableNames(flow: ProcessFlow): Set<string> {
  const names = new Set<string>();
  const action = flow.actions?.[0];
  if (!action) return names;

  for (const input of action.inputs ?? []) {
    if (typeof input.name === "string") names.add(input.name);
  }
  for (const output of action.outputs ?? []) {
    if (typeof output.name === "string") names.add(output.name);
  }

  // steps 内の outputBinding も変数として収集 (簡易走査)
  function collectFromSteps(steps: unknown[]): void {
    for (const step of steps ?? []) {
      const s = step as Record<string, unknown>;
      const binding = s.outputBinding as Record<string, unknown> | undefined;
      if (binding && typeof binding.name === "string") {
        names.add(binding.name);
      }
      // ネスト steps (branch.branches[].steps / elseBranch.steps / loop.steps 等)
      if (Array.isArray(s.steps)) collectFromSteps(s.steps as unknown[]);
      if (Array.isArray(s.branches)) {
        for (const br of s.branches as Array<Record<string, unknown>>) {
          if (Array.isArray(br.steps)) collectFromSteps(br.steps as unknown[]);
        }
      }
      const elseBranch = s.elseBranch as Record<string, unknown> | undefined;
      if (elseBranch && Array.isArray(elseBranch.steps)) {
        collectFromSteps(elseBranch.steps as unknown[]);
      }
      const inlineBranch = s.inlineBranch as Record<string, unknown> | undefined;
      if (inlineBranch) {
        if (Array.isArray(inlineBranch.ok)) collectFromSteps(inlineBranch.ok as unknown[]);
        if (Array.isArray(inlineBranch.ng)) collectFromSteps(inlineBranch.ng as unknown[]);
      }
    }
  }
  collectFromSteps(action.steps ?? []);

  return names;
}

/**
 * 全プロジェクトの ProcessFlow / Screen / ViewDefinition を入力に、
 * viewer screen-item の整合を検証する。空配列なら問題なし。
 */
export function checkScreenItemViewer(
  screens: Screen[],
  flows: ProcessFlow[],
  viewDefinitions: ViewDefinition[],
): ScreenItemViewerIssue[] {
  const issues: ScreenItemViewerIssue[] = [];

  // ViewDefinition を id 索引に
  const vdById = new Map<string, ViewDefinition>();
  for (const vd of viewDefinitions) {
    const id = vd.id as string | undefined;
    if (id) vdById.set(id, vd);
  }

  // ProcessFlow を id 索引に
  const flowById = new Map<string, ProcessFlow>();
  for (const flow of flows) {
    const id = getFlowId(flow);
    if (id) flowById.set(id, flow);
  }

  screens.forEach((screen) => {
    const screenLabel = getScreenId(screen);
    const items = (screen.items ?? []) as ScreenItem[];

    items.forEach((item: ScreenItem, ii) => {
      if (item.direction !== "viewer") return;

      const itemPath = `${screenLabel}.items[${ii}=${item.id}]`;
      const vdId = item.viewDefinitionId as string | undefined;

      // 2. MISSING_VIEWER_VIEW_DEFINITION
      if (!vdId) {
        issues.push({
          path: itemPath,
          code: "MISSING_VIEWER_VIEW_DEFINITION",
          severity: "error",
          message: `direction='viewer' の画面項目 '${item.id}' に viewDefinitionId がありません。viewer には viewDefinitionId が必須です。`,
        });
        return;
      }

      // 1. UNKNOWN_VIEWER_VIEW_DEFINITION
      if (!vdById.has(vdId)) {
        issues.push({
          path: `${itemPath}.viewDefinitionId`,
          code: "UNKNOWN_VIEWER_VIEW_DEFINITION",
          severity: "error",
          message: `viewDefinitionId '${vdId}' が指す ViewDefinition が同プロジェクト内に存在しません。`,
        });
      }

      // 3. VIEWER_FLOW_VARIABLE_NOT_DECLARED
      const valueFrom = item.valueFrom as Record<string, unknown> | undefined;
      if (valueFrom?.kind === "flowVariable") {
        const processFlowId = valueFrom.processFlowId as string | undefined;
        const variableName = valueFrom.variableName as string | undefined;

        if (variableName) {
          // processFlowId が省略されている場合は全フローを対象とする (簡易実装: 1 フローでも宣言があれば OK)
          let declared = false;
          if (processFlowId) {
            const flow = flowById.get(processFlowId);
            if (flow) {
              const varNames = collectFlowVariableNames(flow);
              // variableName は IdentifierPath (ドット区切り) — 先頭セグメントで照合
              const rootName = variableName.split(".")[0];
              declared = varNames.has(rootName);
            }
          } else {
            // processFlowId 省略時は全フロー中いずれかで宣言されていれば pass
            for (const flow of flows) {
              const varNames = collectFlowVariableNames(flow);
              const rootName = variableName.split(".")[0];
              if (varNames.has(rootName)) {
                declared = true;
                break;
              }
            }
          }

          if (!declared) {
            issues.push({
              path: `${itemPath}.valueFrom`,
              code: "VIEWER_FLOW_VARIABLE_NOT_DECLARED",
              severity: "warning",
              message: `valueFrom.variableName '${variableName}' が${processFlowId ? ` ProcessFlow '${processFlowId}' の` : "プロジェクト内いずれの ProcessFlow の"} variables / outputs / inputs に宣言されていません。`,
            });
          }
        }
      }
    });
  });

  return issues;
}
