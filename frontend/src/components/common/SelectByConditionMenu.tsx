/**
 * 一覧の「条件で選ぶ」(UI 改善提案 第 3 弾 #57)。列と条件を選び、該当する行を、選択に反映する。
 * 選んだ行は、既存の一括の操作 (削除・一括変更・コピーなど) にそのまま使える。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { CONDITION_OPS, combineSelection, matchRowIds, type ConditionOp, type SelectMode } from "../../utils/selectByCondition";

export interface SelectByConditionMenuProps<T> {
  items: readonly T[];
  getId: (t: T) => string;
  /** 条件に使える列 (見出しの文字と、値の取り出し方) */
  columns: Array<{ key: string; label: string; accessor: (t: T) => string | number | null | undefined }>;
  selectedIds: ReadonlySet<string>;
  onSelect: (ids: Set<string>) => void;
  onClose: () => void;
}

export function SelectByConditionMenu<T>({ items, getId, columns, selectedIds, onSelect, onClose }: SelectByConditionMenuProps<T>) {
  const ref = useRef<HTMLDivElement>(null);
  const [colKey, setColKey] = useState(columns[0]?.key ?? "");
  const [op, setOp] = useState<ConditionOp>("contains");
  const [value, setValue] = useState("");
  const col = columns.find((c) => c.key === colKey) ?? columns[0];
  const spec = CONDITION_OPS.find((o) => o.op === op)!;

  useEffect(() => {
    ref.current?.querySelector<HTMLElement>("select,input")?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onClose(); } };
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    window.addEventListener("keydown", onKey, { capture: true });
    window.addEventListener("mousedown", onDown, { capture: true });
    return () => { window.removeEventListener("keydown", onKey, { capture: true }); window.removeEventListener("mousedown", onDown, { capture: true }); };
  }, [onClose]);

  const matched = useMemo(
    () => (col ? matchRowIds(items, getId, col.accessor, op, value, selectedIds) : []),
    [items, getId, col, op, value, selectedIds],
  );
  const apply = (mode: SelectMode) => { onSelect(combineSelection(selectedIds, matched, mode)); if (mode === "replace") onClose(); };
  const ready = matched.length > 0;

  return (
    <div ref={ref} className="select-by-condition" role="group" aria-label="条件で選ぶ" data-testid="select-by-condition">
      <div className="column-prefs-title">条件で行を選ぶ</div>
      <div className="sbc-row">
        <select aria-label="列" value={colKey} onChange={(e) => setColKey(e.target.value)} data-testid="sbc-column">
          {columns.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
        </select>
        <select aria-label="条件" value={op} onChange={(e) => setOp(e.target.value as ConditionOp)} data-testid="sbc-op">
          {CONDITION_OPS.map((o) => <option key={o.op} value={o.op}>{o.label}</option>)}
        </select>
      </div>
      {spec.needsValue && (
        <input type="text" className="sbc-value" aria-label="値" placeholder="例: 一覧" value={value} onChange={(e) => setValue(e.target.value)} data-testid="sbc-value"
          onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing && ready) { e.preventDefault(); apply("replace"); } }} />
      )}
      <div className="sbc-count" aria-live="polite" data-testid="sbc-count">{matched.length} 行が該当 (全 {items.length} 行)</div>
      <div className="column-prefs-foot">
        <button type="button" className="btn btn-sm btn-primary" disabled={!ready} onClick={() => apply("replace")} data-testid="sbc-replace">選ぶ</button>
        <button type="button" className="btn btn-sm btn-outline-secondary" disabled={!ready} onClick={() => apply("add")} data-testid="sbc-add">選択に加える</button>
        <button type="button" className="btn btn-sm btn-outline-secondary" disabled={!ready} onClick={() => apply("remove")} data-testid="sbc-remove">選択から外す</button>
      </div>
    </div>
  );
}
