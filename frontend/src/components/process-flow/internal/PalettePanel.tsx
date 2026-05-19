// Phase-3 (#1145): ProcessFlowEditor.tsx 左サイドバー (パレット) を抽出。
// 基本ステップ button / カスタムステップ button / テンプレート dropdown。

import type { StepKind as StepType } from "../../../types/v3";
import { STEP_TEMPLATES } from "../../../utils/processFlowMetadata";
import { ToolbarStepButton, CustomStepButton } from "./PaletteButtons";

export interface PalettePanelProps {
  stepFilter: string;
  onChangeStepFilter: (q: string) => void;
  filteredStepTypes: StepType[];
  customStepCards: [string, { label: string; icon: string; description: string }][];
  showTemplates: boolean;
  onToggleTemplates: () => void;
  onAddStep: (kind: StepType) => void;
  onAddTemplate: (templateId: string) => void;
  isReadonly: boolean;
}

export function PalettePanel({
  stepFilter,
  onChangeStepFilter,
  filteredStepTypes,
  customStepCards,
  showTemplates,
  onToggleTemplates,
  onAddStep,
  onAddTemplate,
  isReadonly,
}: PalettePanelProps) {
  return (
    <aside className="process-flow-palette-pane">
      <div className="process-flow-pane-header">
        <div>
          <span className="process-flow-pane-kicker">Blocks</span>
          <h6>ブロック</h6>
        </div>
        {!isReadonly && <span className="process-flow-pane-badge">D&D</span>}
      </div>
      <div className="process-flow-palette-search">
        <i className="bi bi-search" />
        <input
          value={stepFilter}
          onChange={(e) => onChangeStepFilter(e.target.value)}
          placeholder="ブロックを検索"
          aria-label="ブロックを検索"
        />
      </div>
      <div className="step-toolbar">
        <div className="process-flow-palette-section">基本ステップ</div>
        {filteredStepTypes.map((type) => (
          <ToolbarStepButton
            key={type}
            type={type}
            onClick={() => onAddStep(type)}
            disabled={isReadonly}
          />
        ))}
        {filteredStepTypes.length === 0 && (
          <div className="process-flow-palette-empty">該当するブロックがありません</div>
        )}
        {customStepCards.length > 0 && (
          <>
            <div className="step-toolbar-sep" />
            <div className="process-flow-palette-section">カスタム</div>
            {customStepCards.map(([id, step]) => (
              <CustomStepButton
                key={id}
                id={id}
                label={step.label}
                icon={step.icon}
                description={step.description}
              />
            ))}
          </>
        )}
        <div className="step-toolbar-sep" />
        <div className="process-flow-template-anchor">
          <button
            className="step-template-btn"
            onClick={onToggleTemplates}
            disabled={isReadonly}
          >
            <i className="bi bi-collection" />
            テンプレート
          </button>
          {showTemplates && (
            <div className="template-dropdown">
              {STEP_TEMPLATES.map((tpl) => (
                <div
                  key={tpl.id}
                  className="template-dropdown-item"
                  onClick={() => onAddTemplate(tpl.id ?? "")}
                >
                  <div className="template-dropdown-item-label">{tpl.label}</div>
                  <div className="template-dropdown-item-desc">{tpl.description}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
