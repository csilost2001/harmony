/**
 * 処理フローのマーカーのパネル (#261)
 *
 * 見た目と操作は、どの設計でも共通の MarkerListPanel (components/common)。ここでは、処理フローに固有の
 * 「工程の位置 (anchor.stepId)」の表示と、紐付く工程が消えたマーカーの印だけを足す。
 *
 * Claude Code が /designer-work でこれを MCP 経由で読み取り、
 * 対応後 resolvedAt を埋めて resolution コメントを付ける。
 */
import { useMemo } from "react";
import type { ProcessFlow, Marker, Step } from "../../types/v3";
import { MarkerListPanel } from "../common/MarkerListPanel";
import type { StepWithSubSteps } from "../../utils/actionUtils";
import {
  isBranchStep,
  isExtensionStep,
  isLoopStep,
  isTransactionScopeStep,
} from "../../utils/actionUtils";

/** ProcessFlow 内の全 step.id を再帰的に収集 (anchor orphan 判定用) */
function collectStepIds(group: ProcessFlow): Set<string> {
  const ids = new Set<string>();
  const visit = (steps: Step[]) => {
    for (const s of steps) {
      ids.add(s.id);
      const sw = s as StepWithSubSteps;
      if (sw.subSteps) visit(sw.subSteps);
      if (isBranchStep(s)) {
        for (const b of s.branches) visit(b.steps);
        if (s.elseBranch) visit(s.elseBranch.steps);
      }
      if (isLoopStep(s)) visit(s.steps);
      if (isTransactionScopeStep(s)) {
        visit(s.steps);
        if (s.onCommit) visit(s.onCommit);
        if (s.onRollback) visit(s.onRollback);
      }
      if (s.kind === "externalSystem" && !isExtensionStep(s) && s.errorHandling?.outcomes) {
        for (const oc of Object.values(s.errorHandling?.outcomes)) {
          if (oc?.sideEffects) visit(oc.sideEffects);
        }
      }
    }
  };
  for (const a of group.actions) visit(a.steps);
  return ids;
}

interface Props {
  group: ProcessFlow;
  onChange: (group: ProcessFlow) => void;
  /** 親から排他展開を制御する場合に指定 (undefined なら内部 state) */
  expanded?: boolean;
  onExpandedChange?: (next: boolean) => void;
  /** ActionMetaTabBar から toggle / body を別 DOM 位置に描画する場合に使用 */
  render?: "full" | "toggleOnly" | "bodyOnly";
  /** 増えるたびに、パネルを開いて追加欄へフォーカスする */
  focusToken?: number;
}

export function MarkerPanel({ group, onChange, expanded, onExpandedChange, render = "full", focusToken }: Props) {
  const markers = useMemo<Marker[]>(() => group.authoring?.markers ?? [], [group.authoring?.markers]);
  // anchor の追跡先 step が現存するかを判定するために step id セットを memo 化
  const existingStepIds = useMemo(() => collectStepIds(group), [group]);
  const isOrphanAnchor = (m: Marker): boolean => {
    const anchorId = m.anchor?.stepId;
    if (!anchorId) return false;
    // ActionMetaTabBar の body (基本情報タブ/カタログタブ) に描画された場合の擬似 ID (#309 フォローアップ)
    // これは group.actions[*].steps に存在しないが orphan ではなく「タブが閉じている」状態なので除外
    if (anchorId.startsWith("__meta-tab-")) return false;
    return !existingStepIds.has(anchorId);
  };
  const entityId = String((group as { meta?: { id?: string } }).meta?.id ?? "");
  const entityName = (group as { meta?: { name?: string } }).meta?.name;

  return (
    <MarkerListPanel
      markers={markers}
      onChange={(next) => onChange({ ...group, authoring: { ...(group.authoring ?? {}), markers: next.length > 0 ? next : undefined } })}
      entity={{ type: "processFlow", id: entityId, name: entityName }}
      expanded={expanded}
      onExpandedChange={onExpandedChange}
      render={render}
      focusToken={focusToken}
      isOrphan={isOrphanAnchor}
      orphanTitle="紐付く step が削除されたため、描画マーカーは画面に表示されません"
      anchorText={(m) => (m.anchor?.stepId ? `step: ${m.anchor.stepId}${m.anchor.fieldPath ? `.${m.anchor.fieldPath}` : ""}` : m.anchor?.fieldPath ?? null)}
      help={(
        <>
          <br />
          <strong>committed な内容を編集させたい場合は kind=TODO + 命令形</strong>で
          (「〜を追加して」「〜を削除して」)。質問や注目は AI が保守的に保留します。
        </>
      )}
    />
  );
}
