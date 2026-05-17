/**
 * OutputFields — 画面項目の「出力設定」(表示フォーマット + valueFrom kind 別 binder)
 * (#1145 Phase-6)
 *
 * 1 行の screen item に対する出力設定 sub-form。valueFrom の kind に応じて 4 種類の
 * UI (flowVariable / tableColumn / viewColumn / expression) を切替える。
 * Phase-6 前は ScreenItemsView.tsx 内に inline 定義 (~227 行)。
 */
import type {
  ScreenItem,
  ValueSource,
  IdentifierPath,
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
import { VALUE_SOURCE_KINDS } from "../screenItemsConstants";

export type OutputFieldsProps = {
  item: ScreenItem;
  idx: number;
  onUpdate: (idx: number, patch: Partial<ScreenItem>) => void;
  onCommit: () => void;
  tables: Table[];
  views: View[];
  isReadonly?: boolean;
};

export function OutputFields({
  item, idx, onUpdate, onCommit, tables, views, isReadonly,
}: OutputFieldsProps) {
  const kind = item.valueFrom?.kind ?? "";

  const handleKindChange = (newKind: string) => {
    if (!newKind) {
      onUpdate(idx, { valueFrom: undefined });
    } else if (newKind === "flowVariable") {
      onUpdate(idx, { valueFrom: { kind: "flowVariable", variableName: "" as IdentifierPath } });
    } else if (newKind === "tableColumn") {
      onUpdate(idx, {
        valueFrom: {
          kind: "tableColumn",
          ref: { tableId: "" as TableId, columnId: "" as LocalId },
        },
      });
    } else if (newKind === "viewColumn") {
      onUpdate(idx, {
        valueFrom: {
          kind: "viewColumn",
          ref: { viewId: "" as ViewId, columnPhysicalName: "" as PhysicalName },
        },
      });
    } else if (newKind === "expression") {
      onUpdate(idx, { valueFrom: { kind: "expression", expression: "" } });
    }
    onCommit();
  };

  const handleValueFromPatch = (patch: Partial<ValueSource>) => {
    if (!item.valueFrom) return;
    onUpdate(idx, { valueFrom: { ...item.valueFrom, ...patch } as ValueSource });
  };

  return (
    <div className="screen-items-output-section">
      <div className="screen-items-output-title">出力設定</div>
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
        <div className="screen-items-valuefrom">
          <label className="screen-items-detail-field" style={{ minWidth: "10em", maxWidth: "14em" }}>
            <span className="screen-items-detail-label">バインド元 (種別)</span>
            <select
              className="form-select form-select-sm"
              value={kind}
              onChange={(e) => handleKindChange(e.target.value)}
              disabled={isReadonly}
            >
              <option value="">— 未設定 —</option>
              {VALUE_SOURCE_KINDS.map((k) => (
                <option key={k.value} value={k.value}>{k.label}</option>
              ))}
            </select>
          </label>
          {kind === "flowVariable" && (() => {
            const vf = item.valueFrom as Extract<ValueSource, { kind: "flowVariable" }>;
            return (
              <>
                <label className="screen-items-detail-field" style={{ minWidth: "12em" }}>
                  <span className="screen-items-detail-label">処理フロー</span>
                  <input
                    type="text"
                    list="screen-items-process-flow-list"
                    className="form-control form-control-sm"
                    value={vf.processFlowId ?? ""}
                    onChange={(e) =>
                      handleValueFromPatch({
                        processFlowId: (e.target.value || undefined) as ProcessFlowId | undefined,
                      } as Partial<ValueSource>)
                    }
                    onBlur={onCommit}
                    placeholder="省略可"
                    disabled={isReadonly}
                  />
                </label>
                <label className="screen-items-detail-field" style={{ minWidth: "12em" }}>
                  <span className="screen-items-detail-label">変数名</span>
                  <input
                    className="form-control form-control-sm"
                    value={vf.variableName as string}
                    onChange={(e) =>
                      handleValueFromPatch({
                        variableName: e.target.value as IdentifierPath,
                      } as Partial<ValueSource>)
                    }
                    onBlur={onCommit}
                    placeholder="createdOrder.order_number"
                    disabled={isReadonly}
                  />
                </label>
              </>
            );
          })()}
          {kind === "tableColumn" && (() => {
            const vf = item.valueFrom as Extract<ValueSource, { kind: "tableColumn" }>;
            const selectedTable = tables.find((t) => t.id === vf.ref.tableId);
            return (
              <>
                <label className="screen-items-detail-field" style={{ minWidth: "12em" }}>
                  <span className="screen-items-detail-label">テーブル</span>
                  <select
                    className="form-select form-select-sm"
                    value={vf.ref.tableId as string}
                    onChange={(e) =>
                      handleValueFromPatch({
                        ref: {
                          tableId: e.target.value as TableId,
                          columnId: "" as LocalId,
                        } as TableColumnRef,
                      } as Partial<ValueSource>)
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
                    value={vf.ref.columnId as string}
                    onChange={(e) =>
                      handleValueFromPatch({
                        ref: {
                          tableId: vf.ref.tableId,
                          columnId: e.target.value as LocalId,
                        } as TableColumnRef,
                      } as Partial<ValueSource>)
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
            const vf = item.valueFrom as Extract<ValueSource, { kind: "viewColumn" }>;
            const selectedView = views.find((v) => v.id === vf.ref.viewId);
            return (
              <>
                <label className="screen-items-detail-field" style={{ minWidth: "12em" }}>
                  <span className="screen-items-detail-label">ビュー</span>
                  <select
                    className="form-select form-select-sm"
                    value={vf.ref.viewId as string}
                    onChange={(e) =>
                      handleValueFromPatch({
                        ref: {
                          viewId: e.target.value as ViewId,
                          columnPhysicalName: "" as PhysicalName,
                        } as ViewColumnRef,
                      } as Partial<ValueSource>)
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
                    value={vf.ref.columnPhysicalName as string}
                    onChange={(e) =>
                      handleValueFromPatch({
                        ref: {
                          viewId: vf.ref.viewId,
                          columnPhysicalName: e.target.value as PhysicalName,
                        } as ViewColumnRef,
                      } as Partial<ValueSource>)
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
          {kind === "expression" && (
            <label className="screen-items-detail-field" style={{ minWidth: "18em", flex: 2 }}>
              <span className="screen-items-detail-label">計算式</span>
              <input
                className="form-control form-control-sm"
                value={(item.valueFrom as Extract<ValueSource, { kind: "expression" }>).expression}
                onChange={(e) => handleValueFromPatch({ expression: e.target.value } as Partial<ValueSource>)}
                onBlur={onCommit}
                placeholder="@inputs.price * @inputs.qty"
                disabled={isReadonly}
              />
            </label>
          )}
        </div>
      </div>
    </div>
  );
}
