// Phase-3 (#1145): ProcessFlowEditor.tsx 右サイドバー (詳細インスペクタ) を抽出。
// AI 依頼パネル / Meta タブ (ActionMetaTabBar) / HTTP contract / SLA / 入出力データ。

import type { RefObject } from "react";
import type { ActionDefinition, ProcessFlow } from "../../../types/v3";
import { AiRequestPanel } from "../AiRequestPanel";
import { ActionMetaTabBar } from "../ActionMetaTabBar";
import { ActionHttpContractPanel } from "../ActionHttpContractPanel";
import { SlaPanel } from "../SlaPanel";
import { StructuredFieldsEditor, type ScreenItemPickResult } from "../StructuredFieldsEditor";
import type { UseAiContextChipsResult } from "../../../hooks/useAiContextChips";

export interface InspectorPanelProps {
  group: ProcessFlow | null;
  activeAction: ActionDefinition | null;
  activeActionId: string | null;
  isReadonly: boolean;
  /** ProcessFlow ID (AI チップ追加用) */
  processFlowId: string | undefined;
  /** AI 依頼パネル */
  aiChips: UseAiContextChipsResult;
  handleAiSubmit: (prompt: string) => Promise<void>;
  aiRequestBusy: boolean;
  aiRequestError: string | null;
  isCodexConnected: boolean;
  aiPanelRef: RefObject<HTMLDivElement | null>;
  /** ProcessFlow 全体 mutation */
  updateGroup: (fn: (g: ProcessFlow) => void) => void;
  updateGroupSilent: (fn: (g: ProcessFlow) => void) => void;
  commitGroup: () => void;
  /** 画面項目ピッカー */
  handlePickScreenItem: () => Promise<ScreenItemPickResult | null>;
}

export function InspectorPanel({
  group,
  activeAction,
  activeActionId,
  isReadonly,
  processFlowId,
  aiChips,
  handleAiSubmit,
  aiRequestBusy,
  aiRequestError,
  isCodexConnected,
  aiPanelRef,
  updateGroup,
  updateGroupSilent,
  commitGroup,
  handlePickScreenItem,
}: InspectorPanelProps) {
  return (
    <aside className="process-flow-inspector-pane">
      <div className="process-flow-pane-header">
        <div>
          <span className="process-flow-pane-kicker">Inspector</span>
          <h6>詳細</h6>
        </div>
      </div>
      <div className="process-flow-inspector-scroll">
        {/* #1076 AI 依頼パネル */}
        <div className="process-flow-inspector-section">
          <AiRequestPanel
            chips={aiChips.chips}
            onRemoveChip={aiChips.removeChip}
            onClearChips={aiChips.clearChips}
            onSubmit={handleAiSubmit}
            busy={aiRequestBusy}
            error={aiRequestError}
            isConnected={isCodexConnected}
            panelRef={aiPanelRef}
            actionLabel={activeAction?.name}
            onAddActionContext={
              activeAction
                ? () => {
                    aiChips.addActionChip(
                      String(activeAction.id),
                      activeAction.name,
                      activeAction,
                    );
                  }
                : undefined
            }
            onAddFlowContext={
              group
                ? () => {
                    const flowName = group.meta?.name ?? "処理フロー";
                    const flowId = processFlowId ?? "flow";
                    aiChips.addFlowChip(flowId, flowName, group);
                  }
                : undefined
            }
          />
        </div>
        {isReadonly ? (
          <div className="process-flow-inspector-section">
            <div className="text-muted small">
              詳細項目の編集は「編集開始」後に利用できます。
            </div>
          </div>
        ) : group ? (
          <ActionMetaTabBar
            group={group}
            updateGroup={updateGroup}
            updateGroupSilent={updateGroupSilent}
          />
        ) : null}
        {!isReadonly && activeAction && (
          <>
            <div className="process-flow-inspector-section">
              <ActionHttpContractPanel
                action={activeAction}
                onChange={(patch) => {
                  updateGroupSilent((g) => {
                    const act = g.actions.find((a) => a.id === activeActionId);
                    if (act) Object.assign(act, patch);
                  });
                  commitGroup();
                }}
              />
            </div>
            <div className="process-flow-inspector-section">
              <SlaPanel
                label="アクション SLA / Timeout"
                sla={activeAction.sla}
                onChange={(sla) => {
                  updateGroupSilent((g) => {
                    const act = g.actions.find((a) => a.id === activeActionId);
                    if (act) act.sla = sla;
                  });
                  commitGroup();
                }}
              />
            </div>
            <div className="process-flow-io-panel">
              <div className="process-flow-io-field">
                <StructuredFieldsEditor
                  label="入力データ"
                  fields={activeAction.inputs}
                  onChange={(val) => {
                    updateGroupSilent((g) => {
                      const act = g.actions.find((a) => a.id === activeActionId);
                      if (act) act.inputs = typeof val === "string" ? undefined : val;
                    });
                  }}
                  onCommit={commitGroup}
                  placeholder="例: ユーザID、パスワード（改行で複数項目）"
                  onPickScreenItem={handlePickScreenItem}
                />
              </div>
              <div className="process-flow-io-field">
                <StructuredFieldsEditor
                  label="出力データ"
                  fields={activeAction.outputs}
                  onChange={(val) => {
                    updateGroupSilent((g) => {
                      const act = g.actions.find((a) => a.id === activeActionId);
                      if (act) act.outputs = typeof val === "string" ? undefined : val;
                    });
                  }}
                  onCommit={commitGroup}
                  placeholder="例: セッションID、認証トークン（改行で複数項目）"
                  onPickScreenItem={handlePickScreenItem}
                />
              </div>
            </div>
          </>
        )}
      </div>
    </aside>
  );
}
