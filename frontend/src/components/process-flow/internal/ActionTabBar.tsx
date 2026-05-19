// Phase-3 (#1145): ProcessFlowEditor.tsx からアクションタブ + 検索 + ActionHelpPopover 統合を抽出。
// 「コマンドバー」エリア全体 (アクション名 / 検索ボックス / タブ / popover / EditLevelToggle)。

import type { ActionDefinition, ProcessFlow } from "../../../types/v3";
import { MaturityBadge } from "../MaturityBadge";
import { EditLevelToggle } from "../EditLevelToggle";
import { ActionHelpPopover } from "./ActionHelpPopover";
import { getActionTriggerIcon, getActionTriggerLabel } from "./actionTriggerConstants";
import type { ActionHelpState } from "./useActionHelpPopover";

export interface ActionTabBarProps {
  group: ProcessFlow | null;
  activeAction: ActionDefinition | null;
  activeActionId: string | null;
  visibleActions: ActionDefinition[];
  commandQuery: string;
  onChangeCommandQuery: (q: string) => void;
  onSelectAction: (id: string) => void;
  onDeleteAction: (id: string) => void;
  onAddActionClick: () => void;
  isReadonly: boolean;
  /** EditLevelToggle */
  editLevel: import("../../../hooks/useEditLevel").EditLevel;
  onChangeEditLevel: (lv: import("../../../hooks/useEditLevel").EditLevel) => void;
  /** アクション maturity の更新 */
  onChangeActionMaturity: (actionId: string, maturity: string) => void;
  /** ActionHelpPopover */
  actionHelp: ActionHelpState | null;
  actionHelpTarget: ActionDefinition | null;
  actionHelpTargetIndex: number;
  openActionHelp: (actionId: string, anchor: HTMLElement) => void;
  scheduleCloseActionHelp: () => void;
  clearActionHelpCloseTimer: () => void;
}

export function ActionTabBar({
  group,
  activeAction,
  activeActionId,
  visibleActions,
  commandQuery,
  onChangeCommandQuery,
  onSelectAction,
  onDeleteAction,
  onAddActionClick,
  isReadonly,
  editLevel,
  onChangeEditLevel,
  onChangeActionMaturity,
  actionHelp,
  actionHelpTarget,
  actionHelpTargetIndex,
  openActionHelp,
  scheduleCloseActionHelp,
  clearActionHelpCloseTimer,
}: ActionTabBarProps) {
  return (
    <div className="process-flow-command-bar">
      <div className="process-flow-command-title">
        <span className="process-flow-command-eyebrow">Action</span>
        <strong>{activeAction?.name ?? "アクション未選択"}</strong>
        {activeAction && (
          <span className="text-muted small">{getActionTriggerLabel(activeAction.trigger)}</span>
        )}
      </div>
      <div className="process-flow-command-search">
        <i className="bi bi-search" />
        <input
          value={commandQuery}
          onChange={(e) => onChangeCommandQuery(e.target.value)}
          placeholder="アクションを検索"
          aria-label="アクションを検索"
        />
      </div>
      <div className="process-flow-tabs">
        {visibleActions.map((act) => (
          <div
            key={act.id}
            className={`process-flow-tab-wrap${activeActionId === act.id ? " active" : ""}`}
          >
            <button
              className={`process-flow-tab ${activeActionId === act.id ? "active" : ""}`}
              onClick={() => onSelectAction(act.id)}
              onPointerEnter={(e) => openActionHelp(act.id, e.currentTarget)}
              onPointerLeave={scheduleCloseActionHelp}
              onFocus={(e) => openActionHelp(act.id, e.currentTarget)}
              onBlur={scheduleCloseActionHelp}
              aria-describedby={
                actionHelp?.actionId === act.id ? `action-help-${act.id}` : undefined
              }
              aria-label={`${act.name} (${getActionTriggerLabel(act.trigger)})`}
            >
              <span className="process-flow-tab-trigger-icon" aria-hidden="true">
                <i className={`bi ${getActionTriggerIcon(act.trigger)}`} />
              </span>
              <MaturityBadge
                maturity={act.maturity}
                onChange={(next) => onChangeActionMaturity(act.id, next)}
              />
              {act.name}
              <span className="process-flow-tab-trigger-label">
                {getActionTriggerLabel(act.trigger)}
              </span>
            </button>
            {!isReadonly && (
              <button
                className="process-flow-tab-remove"
                onClick={() => onDeleteAction(act.id)}
                title="アクション削除"
              >
                <i className="bi bi-x" />
              </button>
            )}
          </div>
        ))}
        {visibleActions.length === 0 && (
          <span className="process-flow-tab-empty">一致するアクションがありません</span>
        )}
        {!isReadonly && (
          <button
            className="process-flow-tab-add"
            onClick={onAddActionClick}
            title="アクション追加"
          >
            <i className="bi bi-plus-lg" />
          </button>
        )}
      </div>
      {actionHelpTarget && actionHelp && (
        <ActionHelpPopover
          action={actionHelpTarget}
          actionIndex={actionHelpTargetIndex}
          markers={group?.authoring?.markers ?? []}
          position={actionHelp}
          onPointerEnter={clearActionHelpCloseTimer}
          onPointerLeave={scheduleCloseActionHelp}
        />
      )}
      <div className="process-flow-command-hints">
        {!isReadonly && (
          <>
            <span><kbd>Ctrl</kbd>+<kbd>C</kbd> コピー</span>
            <span><kbd>Ctrl</kbd>+<kbd>V</kbd> 貼付</span>
            <span><kbd>右クリック</kbd> 操作</span>
          </>
        )}
      </div>
      <EditLevelToggle value={editLevel} onChange={onChangeEditLevel} disabled={isReadonly} />
    </div>
  );
}
