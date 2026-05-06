// @ts-nocheck
/**
 * ProcessFlow.context.catalogs.errors 編集パネル (#278 / #570 v3 移行)
 *
 * errorCode → { httpStatus, defaultMessage, responseRef, description } のマップ編集。
 * キー追加・削除、各フィールドの行編集。
 */
import { useState } from "react";
import type { ProcessFlow, ErrorCatalogEntry } from "../../types/action";

interface Props {
  group: ProcessFlow;
  onChange: (group: ProcessFlow) => void;
  expanded?: boolean;
  onExpandedChange?: (next: boolean) => void;
  render?: "full" | "toggleOnly" | "bodyOnly";
}

export function ErrorCatalogPanel({ group, onChange, expanded: expandedProp, onExpandedChange, render = "full" }: Props) {
  const [expandedState, setExpandedState] = useState(false);
  const isControlled = expandedProp !== undefined;
  const expanded = isControlled ? expandedProp : expandedState;
  const setExpanded = (next: boolean) => {
    if (!isControlled) setExpandedState(next);
    onExpandedChange?.(next);
  };
  const [newKey, setNewKey] = useState("");
  const catalog = group.context?.catalogs?.errors ?? {};
  const keys = Object.keys(catalog);

  // ProcessFlow 内の全 response ID を収集 (responseRef ドロップダウン用)
  const responseIds = Array.from(new Set(
    group.actions.flatMap((a) => (a.responses ?? []).map((r) => r.id).filter((x): x is string => !!x)),
  ));

  const setCatalog = (next: Record<string, ErrorCatalogEntry> | undefined) => {
    onChange({ ...group, context: { ...(group.context ?? {}), catalogs: { ...(group.context?.catalogs ?? {}), errors: next } } });
  };

  const updateEntry = (key: string, patch: Partial<ErrorCatalogEntry>) => {
    setCatalog({ ...catalog, [key]: { ...catalog[key], ...patch } });
  };

  const removeEntry = (key: string) => {
    const next = { ...catalog };
    delete next[key];
    setCatalog(Object.keys(next).length > 0 ? next : undefined);
  };

  const addEntry = () => {
    const key = newKey.trim();
    if (!key || catalog[key]) return;
    setCatalog({ ...catalog, [key]: {} });
    setNewKey("");
  };

  const showToggle = render !== "bodyOnly";
  const showBody = render === "bodyOnly" || (render !== "toggleOnly" && expanded);
  return (
    <div className="catalog-panel error-catalog-panel">
      {showToggle && (
        <button
          type="button"
          className="catalog-panel-toggle"
          onClick={() => setExpanded(!expanded)}
        >
          <i className={`bi bi-chevron-${expanded ? "down" : "right"}`} />
          <i className="bi bi-exclamation-diamond" />
          {" "}エラーカタログ (errors: {keys.length} 件)
        </button>
      )}
      {showBody && (
        <div className="catalog-panel-body">
          <div className="catalog-help">
            errorCode を 1 箇所に集約。affectedRowsCheck.errorCode /
            BranchConditionVariant.tryCatch.errorCode から参照される。
          </div>
          {keys.length === 0 && (
            <div className="catalog-empty">まだエントリがありません。</div>
          )}
          {keys.map((k) => {
            const e = catalog[k];
            return (
              <div className="catalog-row" key={k}>
                <div className="catalog-row-header">
                  <span className="catalog-key-badge">{k}</span>
                  <button
                    type="button"
                    className="btn btn-sm btn-link text-danger"
                    onClick={() => removeEntry(k)}
                    title="削除"
                  >
                    <i className="bi bi-trash" />
                  </button>
                </div>
                <div className="catalog-row-fields">
                  <label>
                    httpStatus
                    <input
                      type="number"
                      className="form-control form-control-sm"
                      value={e.httpStatus ?? ""}
                      min={100}
                      max={599}
                      onChange={(ev) =>
                        updateEntry(k, {
                          httpStatus: ev.target.value === "" ? undefined : Number(ev.target.value),
                        })
                      }
                    />
                  </label>
                  <label>
                    responseRef
                    <select
                      className="form-select form-select-sm"
                      value={e.responseRef ?? ""}
                      onChange={(ev) => updateEntry(k, { responseRef: ev.target.value || undefined })}
                    >
                      <option value="">—</option>
                      {responseIds.map((id) => (
                        <option key={id} value={id}>{id}</option>
                      ))}
                    </select>
                  </label>
                  <label className="catalog-wide">
                    defaultMessage
                    <input
                      className="form-control form-control-sm"
                      value={e.defaultMessage ?? ""}
                      onChange={(ev) => updateEntry(k, { defaultMessage: ev.target.value || undefined })}
                      placeholder="例: 在庫不足"
                    />
                  </label>
                  <label className="catalog-wide">
                    description
                    <input
                      className="form-control form-control-sm"
                      value={e.description ?? ""}
                      onChange={(ev) => updateEntry(k, { description: ev.target.value || undefined })}
                      placeholder="例: 引当 UPDATE で rowCount=0"
                    />
                  </label>
                </div>
              </div>
            );
          })}
          <div className="catalog-row catalog-row-add">
            <input
              className="form-control form-control-sm catalog-new-key"
              placeholder="新規 errorCode (例: STOCK_SHORTAGE)"
              value={newKey}
              onChange={(ev) => setNewKey(ev.target.value)}
              onKeyDown={(ev) => { if (ev.key === "Enter") { ev.preventDefault(); addEntry(); } }}
            />
            <button
              type="button"
              className="btn btn-sm btn-outline-primary"
              onClick={addEntry}
              disabled={!newKey.trim() || Object.hasOwn(catalog, newKey.trim())}
            >
              <i className="bi bi-plus-lg" /> 追加
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
