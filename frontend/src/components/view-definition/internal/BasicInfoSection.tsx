/**
 * BasicInfoSection — Section 1: 基本情報 (Phase-4 抽出)
 *
 * id / name / description / kind (builtin or 拡張参照) / Level radio / maturity
 */
import type { ViewDefinition } from "../../../types/v3/view-definition";
import type { Maturity } from "../../../types/v3";
import { MaturityBadge } from "../../process-flow/MaturityBadge";
import { migrateToLevel, type ViewLevel } from "../viewDefinitionLevels";
import {
  KIND_LABELS,
  LEVEL_LABELS,
  isBuiltinKind,
} from "./viewDefinitionConstants";
import type { TableOption } from "./useViewDefinitionTables";
import type { BuiltinViewDefinitionKind } from "../../../types/v3/view-definition";

interface Props {
  viewDefinition: ViewDefinition;
  currentLevel: ViewLevel;
  tableOptions: TableOption[];
  isReadonly: boolean;
  kindExtMode: boolean;
  setKindExtMode: (fn: (prev: boolean) => boolean) => void;
  updateWithDraft: (fn: (s: ViewDefinition) => void) => void;
  updateSilentWithDraft: (fn: (s: ViewDefinition) => void) => void;
  commit: () => void;
}

export function BasicInfoSection({
  viewDefinition,
  currentLevel,
  tableOptions,
  isReadonly,
  kindExtMode,
  setKindExtMode,
  updateWithDraft,
  updateSilentWithDraft,
  commit,
}: Props) {
  return (
    <section className="seq-editor-section">
      <h3 className="seq-editor-section-title">基本情報</h3>
      <div className="seq-editor-grid">

        {/* ID (read-only) */}
        <label className="tbl-field">
          <span>ID</span>
          <input
            type="text"
            value={viewDefinition.id}
            readOnly
            className="seq-readonly"
            title="ID は変更できません"
          />
        </label>

        {/* 表示名 */}
        <label className="tbl-field">
          <span>表示名 <span className="vd-editor-required">*</span></span>
          <input
            type="text"
            value={viewDefinition.name}
            onChange={(e) => updateSilentWithDraft((d) => { d.name = e.target.value as ViewDefinition["name"]; })}
            onBlur={() => { if (!isReadonly) commit(); }}
            placeholder="顧客一覧"
            disabled={isReadonly}
          />
        </label>

        {/* 説明 */}
        <label className="tbl-field">
          <span>説明</span>
          <textarea
            value={viewDefinition.description ?? ""}
            onChange={(e) => updateSilentWithDraft((d) => {
              d.description = e.target.value || undefined;
            })}
            onBlur={() => { if (!isReadonly) commit(); }}
            rows={2}
            placeholder="このビュー定義の用途を記述..."
            disabled={isReadonly}
          />
        </label>

        {/* viewer 種別 */}
        <div className="tbl-field">
          <span>viewer 種別 <span className="vd-editor-required">*</span></span>
          <div className="vd-editor-kind-row">
            {!kindExtMode ? (
              <select
                value={isBuiltinKind(viewDefinition.kind) ? viewDefinition.kind : "list"}
                onChange={(e) => updateWithDraft((d) => { d.kind = e.target.value; })}
                disabled={isReadonly}
              >
                {(Object.entries(KIND_LABELS) as [BuiltinViewDefinitionKind, string][]).map(([v, label]) => (
                  <option key={v} value={v}>{label}</option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                value={viewDefinition.kind}
                onChange={(e) => updateSilentWithDraft((d) => { d.kind = e.target.value; })}
                onBlur={() => { if (!isReadonly) commit(); }}
                placeholder="namespace:kindName (例: retail:storefront)"
                disabled={isReadonly}
              />
            )}
            <button
              type="button"
              className="tbl-btn tbl-btn-ghost tbl-btn-sm"
              onClick={() => {
                setKindExtMode((v) => !v);
                if (kindExtMode) {
                  updateWithDraft((d) => { d.kind = "list"; });
                }
              }}
              title={kindExtMode ? "組み込み種別に戻す" : "拡張参照を入力"}
              disabled={isReadonly}
            >
              {kindExtMode ? "組み込みに戻す" : "拡張参照"}
            </button>
          </div>
        </div>

        {/* Level 切替 (#748、3 レベル DSL) */}
        <div className="tbl-field">
          <span>クエリ Level <span className="vd-editor-required">*</span></span>
          <div className="vd-editor-level-row">
            {([1, 2, 3] as ViewLevel[]).map((lv) => (
              <label key={lv} className="vd-editor-level-radio" title={LEVEL_LABELS[lv]}>
                <input
                  type="radio"
                  name="vd-level"
                  checked={currentLevel === lv}
                  onChange={() => {
                    if (currentLevel === lv || isReadonly) return;
                    const tableName = (id: string) =>
                      tableOptions.find((t) => t.id === id)?.name;
                    updateWithDraft((d) => {
                      const migrated = migrateToLevel(d, lv, tableName);
                      d.sourceTableId = migrated.sourceTableId;
                      d.query = migrated.query;
                    });
                  }}
                  disabled={isReadonly}
                />
                {" "}{LEVEL_LABELS[lv]}
              </label>
            ))}
          </div>
          <small className="vd-editor-level-hint">
            Level 切替時は <code>sourceTableId</code> と <code>query</code> が排他的に書き換わります (既存の columns / sort / filter は維持)。
          </small>
        </div>

        {/* 成熟度 */}
        <label className="tbl-field">
          <span>成熟度</span>
          <div className="vd-editor-maturity-row">
            <MaturityBadge
              maturity={viewDefinition.maturity}
              size="md"
              onChange={isReadonly ? undefined : (m: Maturity) => updateWithDraft((d) => { d.maturity = m; })}
            />
            <span className="vd-editor-maturity-label">
              {viewDefinition.maturity ?? "draft"}
            </span>
          </div>
        </label>

      </div>
    </section>
  );
}
