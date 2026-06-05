/**
 * OutputFields — 画面項目の表示書式 + binding 設定。
 *
 * #1445: ScreenItem.binding を編集する。
 */
import type {
  ScreenItem,
  ScreenItemBinding,
  ScreenItemBindingKind,
  TableId,
  ViewId,
  LocalId,
  PhysicalName,
  ProcessFlowId,
  TableColumnRef,
  ViewColumnRef,
  Table,
  View,
} from "../../../../types/v3";
import { BINDING_KINDS } from "../screenItemsConstants";

export type OutputFieldsProps = {
  item: ScreenItem;
  idx: number;
  onUpdate: (idx: number, patch: Partial<ScreenItem>) => void;
  onCommit: () => void;
  tables: Table[];
  views: View[];
  isReadonly?: boolean;
};

function bindingWith(kind: ScreenItemBindingKind): ScreenItemBinding {
  if (kind === "tableColumn") {
    return { kind, ref: { tableId: "" as TableId, columnId: "" as LocalId } };
  }
  if (kind === "viewColumn") {
    return { kind, ref: { viewId: "" as ViewId, columnPhysicalName: "" as PhysicalName } };
  }
  return { kind, path: "" };
}

export function OutputFields({
  item, idx, onUpdate, onCommit, tables, views, isReadonly,
}: OutputFieldsProps) {
  const binding = item.binding;
  const kind = binding?.kind ?? "";

  const handleKindChange = (newKind: string) => {
    if (!newKind) {
      onUpdate(idx, { binding: undefined });
    } else {
      onUpdate(idx, { binding: bindingWith(newKind as ScreenItemBindingKind) });
    }
    onCommit();
  };

  const handleBindingPatch = (patch: Partial<ScreenItemBinding>) => {
    if (!binding) return;
    onUpdate(idx, { binding: { ...binding, ...patch } as ScreenItemBinding });
  };

  return (
    <div className="screen-items-output-section">
      <div className="screen-items-output-title">Binding 設定</div>
      <div className="screen-items-output-fields">
        <label className="screen-items-detail-field" style={{ minWidth: "14em", maxWidth: "20em" }}>
          <span className="screen-items-detail-label">表示フォーマット</span>
          <input
            type="text"
            list="screen-items-display-format-list"
            className="form-control form-control-sm"
            value={item.displayFormat ?? ""}
            onChange={(e) => onUpdate(idx, { displayFormat: e.target.value || undefined })}
            onBlur={onCommit}
            placeholder="YYYY/MM/DD"
            disabled={isReadonly}
          />
        </label>
        <div className="screen-items-binding">
          <label className="screen-items-detail-field" style={{ minWidth: "10em", maxWidth: "14em" }}>
            <span className="screen-items-detail-label">Binding 種別</span>
            <select
              className="form-select form-select-sm"
              value={kind}
              onChange={(e) => handleKindChange(e.target.value)}
              disabled={isReadonly}
            >
              <option value="">— 未設定 —</option>
              {BINDING_KINDS.map((k) => (
                <option key={k.value} value={k.value}>{k.label}</option>
              ))}
            </select>
          </label>

          {kind === "flowVariable" && (
            <>
              <label className="screen-items-detail-field" style={{ minWidth: "12em" }}>
                <span className="screen-items-detail-label">処理フロー</span>
                <input
                  type="text"
                  list="screen-items-process-flow-list"
                  className="form-control form-control-sm"
                  value={binding?.processFlowId ?? ""}
                  onChange={(e) =>
                    handleBindingPatch({ processFlowId: (e.target.value || undefined) as ProcessFlowId | undefined })
                  }
                  onBlur={onCommit}
                  placeholder="省略可"
                  disabled={isReadonly}
                />
              </label>
              <label className="screen-items-detail-field" style={{ minWidth: "12em" }}>
                <span className="screen-items-detail-label">Path</span>
                <input
                  className="form-control form-control-sm"
                  value={binding?.path ?? ""}
                  onChange={(e) => handleBindingPatch({ path: e.target.value })}
                  onBlur={onCommit}
                  placeholder="createdOrder.order_number"
                  disabled={isReadonly}
                />
              </label>
            </>
          )}

          {kind === "tableColumn" && (() => {
            const ref = binding?.ref as TableColumnRef | undefined;
            const selectedTable = tables.find((t) => t.id === ref?.tableId);
            return (
              <>
                <label className="screen-items-detail-field" style={{ minWidth: "12em" }}>
                  <span className="screen-items-detail-label">テーブル</span>
                  <select
                    className="form-select form-select-sm"
                    value={(ref?.tableId as string | undefined) ?? ""}
                    onChange={(e) =>
                      handleBindingPatch({
                        ref: {
                          tableId: e.target.value as TableId,
                          columnId: "" as LocalId,
                        } as TableColumnRef,
                      })
                    }
                    onBlur={onCommit}
                    disabled={isReadonly}
                  >
                    <option value="">— テーブル選択 —</option>
                    {tables.map((t) => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                </label>
                <label className="screen-items-detail-field" style={{ minWidth: "12em" }}>
                  <span className="screen-items-detail-label">列</span>
                  <select
                    className="form-select form-select-sm"
                    value={(ref?.columnId as string | undefined) ?? ""}
                    onChange={(e) =>
                      handleBindingPatch({
                        ref: {
                          tableId: ref?.tableId ?? ("" as TableId),
                          columnId: e.target.value as LocalId,
                        } as TableColumnRef,
                      })
                    }
                    onBlur={onCommit}
                    disabled={isReadonly || !selectedTable}
                  >
                    <option value="">— 列選択 —</option>
                    {selectedTable?.columns?.map((c) => (
                      <option key={c.id} value={c.id}>{c.name || c.physicalName}</option>
                    ))}
                  </select>
                </label>
              </>
            );
          })()}

          {kind === "viewColumn" && (() => {
            const ref = binding?.ref as ViewColumnRef | undefined;
            const selectedView = views.find((v) => v.id === ref?.viewId);
            return (
              <>
                <label className="screen-items-detail-field" style={{ minWidth: "12em" }}>
                  <span className="screen-items-detail-label">ビュー</span>
                  <select
                    className="form-select form-select-sm"
                    value={(ref?.viewId as string | undefined) ?? ""}
                    onChange={(e) =>
                      handleBindingPatch({
                        ref: {
                          viewId: e.target.value as ViewId,
                          columnPhysicalName: "" as PhysicalName,
                        } as ViewColumnRef,
                      })
                    }
                    onBlur={onCommit}
                    disabled={isReadonly}
                  >
                    <option value="">— ビュー選択 —</option>
                    {views.map((v) => (
                      <option key={v.id} value={v.id}>{v.name}</option>
                    ))}
                  </select>
                </label>
                <label className="screen-items-detail-field" style={{ minWidth: "12em" }}>
                  <span className="screen-items-detail-label">列 (物理名)</span>
                  <select
                    className="form-select form-select-sm"
                    value={(ref?.columnPhysicalName as string | undefined) ?? ""}
                    onChange={(e) =>
                      handleBindingPatch({
                        ref: {
                          viewId: ref?.viewId ?? ("" as ViewId),
                          columnPhysicalName: e.target.value as PhysicalName,
                        } as ViewColumnRef,
                      })
                    }
                    onBlur={onCommit}
                    disabled={isReadonly || !selectedView}
                  >
                    <option value="">— 列選択 —</option>
                    {selectedView?.outputColumns.map((c) => (
                      <option key={c.physicalName} value={c.physicalName}>
                        {c.name ?? c.physicalName}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            );
          })()}

          {kind && !["flowVariable", "tableColumn", "viewColumn"].includes(kind) && (
            <label className="screen-items-detail-field" style={{ minWidth: "18em", flex: 2 }}>
              <span className="screen-items-detail-label">Path</span>
              <input
                className="form-control form-control-sm"
                value={binding?.path ?? ""}
                onChange={(e) => handleBindingPatch({ path: e.target.value })}
                onBlur={onCommit}
                placeholder={kind === "expression" ? "@inputs.price * @inputs.qty" : "orderForm.fieldName"}
                disabled={isReadonly}
              />
            </label>
          )}
        </div>
      </div>
    </div>
  );
}
