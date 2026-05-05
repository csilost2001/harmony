import { useState, useEffect } from "react";
import type { ScreenType } from "../../types/flow";
import { SCREEN_TYPE_LABELS } from "../../types/flow";
import type { EditorKind } from "../../utils/resolveEditorKind";
import type { CssFramework } from "../../types/v3/project";

export interface ScreenFormData {
  name: string;
  type: ScreenType;
  path: string;
  description: string;
  /** 画面作成時のみ有効。isCreate=false の場合は無視される。 */
  editorKind?: EditorKind;
  /** 画面作成時のみ有効。isCreate=false の場合は無視される。 */
  cssFramework?: CssFramework;
}

interface Props {
  open: boolean;
  initial?: Partial<ScreenFormData>;
  title: string;
  /** true のとき editorKind / cssFramework ラジオを表示する。false は編集モード (非表示)。 */
  isCreate?: boolean;
  /** 画面作成ダイアログのエディタ種別デフォルト選択値 (project.design から取得)。 */
  defaultEditorKind?: EditorKind;
  /** 画面作成ダイアログの CSS フレームワークデフォルト選択値 (project.design から取得)。 */
  defaultCssFramework?: CssFramework;
  onSave: (data: ScreenFormData) => void;
  onClose: () => void;
}

const defaultData: ScreenFormData = {
  name: "",
  type: "other",
  path: "",
  description: "",
};

export function ScreenEditModal({
  open,
  initial,
  title,
  isCreate = false,
  defaultEditorKind = "grapesjs",
  defaultCssFramework = "bootstrap",
  onSave,
  onClose,
}: Props) {
  const [form, setForm] = useState<ScreenFormData>({
    ...defaultData,
    editorKind: defaultEditorKind,
    cssFramework: defaultCssFramework,
    ...initial,
  });

  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- modal open は外部イベント (open prop 変化) と同期する用途
      setForm({
        ...defaultData,
        editorKind: defaultEditorKind,
        cssFramework: defaultCssFramework,
        ...initial,
      });
    }
  }, [open, initial, defaultEditorKind, defaultCssFramework]);

  if (!open) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    onSave({ ...form, name: form.name.trim() });
  };

  return (
    <div className="flow-modal-overlay" onClick={onClose}>
      <div className="flow-modal" onClick={(e) => e.stopPropagation()}>
        <div className="flow-modal-header">
          <h3>{title}</h3>
          <button className="flow-modal-close" onClick={onClose}>
            <i className="bi bi-x-lg" />
          </button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="flow-modal-body">
            <label htmlFor="screen-name">画面名 *</label>
            <input
              id="screen-name"
              type="text"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="例: 顧客一覧"
              autoFocus
            />

            <label htmlFor="screen-type">画面種別</label>
            <select
              id="screen-type"
              value={form.type}
              onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as ScreenType }))}
            >
              {(Object.entries(SCREEN_TYPE_LABELS) as [ScreenType, string][]).map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </select>

            <label htmlFor="screen-path">想定URL</label>
            <input
              id="screen-path"
              type="text"
              value={form.path}
              onChange={(e) => setForm((f) => ({ ...f, path: e.target.value }))}
              placeholder="例: /customers"
            />

            {isCreate && (
              <div className="screen-create-design-options">
                <div className="screen-create-design-group">
                  <span className="screen-create-design-label">エディタ</span>
                  <div className="screen-create-radio-group">
                    <label className="screen-create-radio-option">
                      <input
                        type="radio"
                        name="screen-editor-kind"
                        value="grapesjs"
                        checked={form.editorKind === "grapesjs"}
                        onChange={() => setForm((f) => ({ ...f, editorKind: "grapesjs" }))}
                      />
                      GrapesJS
                    </label>
                    <label className="screen-create-radio-option">
                      <input
                        type="radio"
                        name="screen-editor-kind"
                        value="puck"
                        checked={form.editorKind === "puck"}
                        onChange={() => setForm((f) => ({ ...f, editorKind: "puck" }))}
                      />
                      Puck
                    </label>
                  </div>
                </div>

                <div className="screen-create-design-group">
                  <span className="screen-create-design-label">CSS フレームワーク</span>
                  <div className="screen-create-radio-group">
                    <label className="screen-create-radio-option">
                      <input
                        type="radio"
                        name="screen-css-framework"
                        value="bootstrap"
                        checked={form.cssFramework === "bootstrap"}
                        onChange={() => setForm((f) => ({ ...f, cssFramework: "bootstrap" }))}
                      />
                      Bootstrap
                    </label>
                    <label className="screen-create-radio-option">
                      <input
                        type="radio"
                        name="screen-css-framework"
                        value="tailwind"
                        checked={form.cssFramework === "tailwind"}
                        onChange={() => setForm((f) => ({ ...f, cssFramework: "tailwind" }))}
                      />
                      Tailwind
                    </label>
                  </div>
                </div>

                <p className="screen-create-design-note">
                  <i className="bi bi-info-circle" /> 作成後は変更できません
                </p>
              </div>
            )}

            <label htmlFor="screen-desc">説明</label>
            <textarea
              id="screen-desc"
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="画面の用途や備考"
              rows={3}
            />
          </div>
          <div className="flow-modal-footer">
            <button type="button" className="flow-btn flow-btn-secondary" onClick={onClose}>
              キャンセル
            </button>
            <button
              type="submit"
              className="flow-btn flow-btn-primary"
              disabled={!form.name.trim()}
            >
              <i className="bi bi-check-lg" /> 保存
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
