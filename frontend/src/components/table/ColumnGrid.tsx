/**
 * カラムの「表で編集」。表計算ソフトのように、セルを選んでその場で編集する。
 * - Ctrl+D = 上の行の値を写す、Ctrl+Enter = 下に行を挿入、Ctrl+Shift+Enter = 行を複製、Alt+Delete = 行を削除 (useGridKeyboard)
 * - Tab / Shift+Tab = 次 / 前のセル、Enter = 下の行の同じ列 (最後の行の Enter で、値があればカラムを追加)、Shift+Enter = 上、
 *   ↑ / ↓ = 文字を打つセルから上下の行の同じ列へ、Esc = セルから出る (useGridKeyboard)
 * - 文字のセルは、セルを出る (Tab・Enter・クリック) ときに 1 回だけ反映する (1 文字ずつ元に戻す履歴にしない)。
 *   選ぶ・チェックするセルは、すぐ反映する
 * 並べ替え・コピー・貼り付け・一括変更などは、従来の一覧 (「一覧で編集」) で行う。
 */
import { useGridKeyboard } from "../../hooks/useGridKeyboard";
import { useRowDragReorder } from "../../hooks/useRowDragReorder";
import type { BuiltinDataType, Column, DisplayName, PhysicalName } from "../../types/v3";
import { DATA_TYPE_LABELS, DATA_TYPES_WITH_LENGTH, DATA_TYPES_WITH_SCALE } from "./tableConstants";
import type { ColumnNameHint } from "../../utils/columnSuggestion";
import "../../styles/columnGrid.css";
import { GridFillHandle } from "../common/GridFillHandle";
import { asciiFieldProps } from "../../utils/fieldNormalize";
import { identifierHint, isValidIdentifier } from "../../utils/identifierHints";
import { FieldHint } from "../common/FieldHint";
import { changedKeys } from "../../utils/fieldDiff";

/** 保存済みの値を、戻すボタンの説明に出す短い文字にする */
const shownValue = (v: unknown): string => (v === undefined || v === null || v === "" ? "空" : v === true ? "あり" : v === false ? "なし" : String(v));

interface Props {
  columns: readonly Column[];
  readonly: boolean;
  onUpdateColumn: (id: string, patch: Partial<Column>) => void;
  /** 最後の行の Enter (値があるとき) で、カラムを 1 つ追加する */
  onAppend: () => void;
  /** Ctrl+Enter: i 行目 (0 始まり) の下に、空のカラムを挿入する */
  onInsertBelow?: (index: number) => void;
  /** Ctrl+Shift+Enter: i 行目を複製する (元の行の下) */
  onDuplicate?: (index: number) => void;
  /** Alt+Delete: i 行目を削除する */
  onDelete?: (index: number) => void;
  /** 行のつまみのドラッグ / Alt+↑↓: from 行目を、to の位置へ動かす */
  onMove?: (from: number, to: number) => void;
  /** カラムごとの未解決のマーカーの件数 (anchor.fieldPath = $.columns[<id>])。あれば行にバッジを出す */
  markerCounts?: Map<string, number>;
  onOpenMarkers?: (anchorPath?: string) => void;
  /** 物理名についてのヒント (用語・表記のずれ)。あれば行に電球を出し、クリックで合わせる */
  hintsFor?: (c: Column) => ColumnNameHint[];
  /** 読み込んだ (または最後に保存した) カラム。渡すと、変更した欄に色と「↺」(その欄だけ戻す) を、新しい行に「新規」を出す (UI 改善提案 第 5 弾 #84) */
  baseline?: readonly Column[];
}

/** 文字のセル。セルを出るときに、変わっていれば 1 回だけ反映する (外から値が変わったら、作り直して追従する) */
function TextCell({ value, label, readonly, mono, placeholder, ascii, onCommit }: { value: string; label: string; readonly: boolean; mono?: boolean; placeholder?: string; ascii?: boolean; onCommit: (v: string) => void }) {
  return (
    <input key={value} type="text" defaultValue={value} readOnly={readonly} aria-label={label} placeholder={placeholder} spellCheck={false} {...(ascii ? asciiFieldProps : {})}
      aria-invalid={ascii && value !== "" && !isValidIdentifier(value, "snake") ? true : undefined}
      className={`cg-input${mono ? " is-mono" : ""}`}
      onBlur={(e) => { if (!readonly && e.currentTarget.value !== value) onCommit(e.currentTarget.value); }} />
  );
}

function NumberCell({ value, label, readonly, disabled, onCommit }: { value: number | undefined; label: string; readonly: boolean; disabled: boolean; onCommit: (v: number | undefined) => void }) {
  return (
    <input key={String(value ?? "")} type="number" min={0} defaultValue={value ?? ""} readOnly={readonly} disabled={disabled} aria-label={label}
      className="cg-input is-num" placeholder={disabled ? "—" : ""}
      onBlur={(e) => {
        const raw = e.currentTarget.value;
        const next = raw === "" ? undefined : Number(raw);
        if (!readonly && next !== value && !(typeof next === "number" && Number.isNaN(next))) onCommit(next);
      }} />
  );
}

export function ColumnGrid({ columns, readonly, onUpdateColumn, onAppend, onInsertBelow, onDuplicate, onDelete, onMove, hintsFor, markerCounts, onOpenMarkers, baseline }: Props) {
  const rowDrag = useRowDragReorder({ onMove: (f, t) => { onMove?.(f, t); focusRow(t); }, disabled: readonly || !onMove });
  // 挿入・複製のあと、新しい行の表示名の欄へ移る (すぐ打ち始められるように)
  const focusRow = (index: number) => setTimeout(() => {
    document.querySelector<HTMLInputElement>(`.cg-table tr[data-grid-row="${index}"] input[aria-label$="の表示名"]`)?.focus();
  }, 0);
  const grid = useGridKeyboard({
    onMoveRow: readonly || !onMove ? undefined : (i, dir) => { if (i + dir >= 0 && i + dir < columns.length) { onMove(i, i + dir); focusRow(i + dir); } },
    onAppendRow: readonly ? undefined : onAppend,
    onInsertRowBelow: readonly || !onInsertBelow ? undefined : (i) => { onInsertBelow(i); focusRow(i + 1); },
    onDuplicateRow: readonly || !onDuplicate ? undefined : (i) => { onDuplicate(i); focusRow(i + 1); },
    onDeleteRow: readonly || !onDelete ? undefined : (i) => { onDelete(i); focusRow(Math.max(0, Math.min(i, columns.length - 2))); },
  });
  const baseById = new Map((baseline ?? []).map((b) => [b.id as string, b]));
  /** 変更した欄の印: セルのクラスと、その欄だけ保存した値に戻す「↺」 */
  const track = (c: Column, field: keyof Column, label: string) => {
    const base = baselineOf(c);
    const changed = !!base && changedKeys(c as Column, base, [field]).has(field);
    const revert = changed && !readonly ? (
      <button type="button" className="cg-revert" title={`保存済みの値 (${shownValue(base![field])}) に戻す`} aria-label={`${label}を保存済みの値に戻す`} data-testid={`cg-revert-${String(field)}-${c.physicalName}`}
        onClick={() => onUpdateColumn(c.id, { [field]: base![field] } as Partial<Column>)}>
        <i className="bi bi-arrow-counterclockwise" />
      </button>
    ) : null;
    return { cls: changed ? "cg-changed" : undefined, revert };
  };
  const baselineOf = (c: Column): Column | undefined => baseById.get(c.id as string);
  const flag = (c: Column, key: "notNull" | "primaryKey" | "unique" | "autoIncrement", label: string) => (
    <input type="checkbox" checked={c[key] ?? false} disabled={readonly} aria-label={`${c.physicalName}の${label}`}
      onChange={(e) => onUpdateColumn(c.id, key === "primaryKey" ? { primaryKey: e.target.checked, notNull: e.target.checked ? true : c.notNull } : { [key]: e.target.checked })} />
  );

  return (
    <div className="cg-wrap" data-testid="column-grid">
      <GridFillHandle />
      <table className="cg-table" onKeyDown={grid.onKeyDown}>
        <thead>
          <tr>
            <th className="cg-no">No</th><th>物理名</th><th>表示名</th><th>データ型</th><th className="cg-num">長さ</th><th className="cg-num">スケール</th>
            <th className="cg-flag" title="NOT NULL">NN</th><th className="cg-flag" title="PRIMARY KEY">PK</th><th className="cg-flag" title="UNIQUE">UK</th><th className="cg-flag" title="AUTO INCREMENT">AI</th>
            <th>デフォルト</th><th>備考</th>
          </tr>
        </thead>
        <tbody>
          {columns.map((c, i) => (
            <tr key={c.id} className={`${rowDrag.rowClass(i)}${baseline && !baseById.has(c.id as string) ? " cg-new" : ""}`.trim()} data-testid="column-grid-row" data-grid-row={i} data-column-id={c.id} data-deeplink={`column:${c.id}`} {...rowDrag.rowProps(i)}>
              <td className="cg-no">
                {baseline && !baseById.has(c.id as string) && <span className="cg-new-mark" title="保存していない、新しいカラム">新規</span>}
                {!readonly && onMove && <span className="row-grip" role="button" tabIndex={-1} aria-label={`${i + 1} 行目をドラッグして並べ替え (Alt+↑↓ でも動かせます)`} title="ドラッグして並べ替え (Alt+↑↓)" data-testid={`row-grip-${i}`} {...rowDrag.gripProps(i)}><i className="bi bi-grip-vertical" /></span>}
                {i + 1}
              </td>
              <td className={track(c, "physicalName", "物理名").cls}>
                <div className="cg-name-cell">
                  <TextCell value={c.physicalName} label={`${i + 1} 行目の物理名`} readonly={readonly} mono ascii onCommit={(v) => onUpdateColumn(c.id, { physicalName: v as PhysicalName })} />
                  {track(c, "physicalName", "物理名").revert}
                  {!readonly && <FieldHint hint={c.physicalName ? identifierHint(c.physicalName, "snake") : null} onFix={(v) => onUpdateColumn(c.id, { physicalName: v as PhysicalName })} testId={`column-name-hint-${i}`} />}
                  {(markerCounts?.get(`$.columns[${c.id}]`) ?? 0) > 0 && (
                    <button type="button" className="col-marker-badge" title="このカラムへの、未解決のマーカー (クリックで開く)" data-testid={`col-marker-badge-${c.physicalName}`}
                      onClick={() => onOpenMarkers?.(`$.columns[${c.id}]`)}>
                      <i className="bi bi-megaphone" /> {markerCounts?.get(`$.columns[${c.id}]`)}
                    </button>
                  )}
                  {(hintsFor?.(c) ?? []).slice(0, 1).map((h) => (
                    <button key={h.kind} type="button" className="cg-hint-btn" disabled={readonly} data-testid={`column-hint-${h.kind}`}
                      title={`${h.message}。クリックで ${h.fix} に合わせます`} aria-label={`${h.message}。${h.fix} に合わせる`}
                      onClick={() => onUpdateColumn(c.id, { physicalName: h.fix as PhysicalName })}>
                      <i className="bi bi-lightbulb" />
                    </button>
                  ))}
                </div>
              </td>
              <td className={track(c, "name", "表示名").cls}><TextCell value={c.name} label={`${i + 1} 行目の表示名`} readonly={readonly} onCommit={(v) => onUpdateColumn(c.id, { name: v as DisplayName })} />{track(c, "name", "表示名").revert}</td>
              <td className={track(c, "dataType", "データ型").cls}>
                <select className="cg-input" value={c.dataType} disabled={readonly} aria-label={`${c.physicalName}のデータ型`} onChange={(e) => onUpdateColumn(c.id, { dataType: e.target.value })}>
                  {Object.entries(DATA_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  {!(c.dataType in DATA_TYPE_LABELS) && <option value={c.dataType}>{c.dataType}</option>}
                </select>
                {track(c, "dataType", "データ型").revert}
              </td>
              <td className={track(c, "length", "長さ").cls}><NumberCell value={c.length} label={`${c.physicalName}の長さ`} readonly={readonly} disabled={!DATA_TYPES_WITH_LENGTH.includes(c.dataType as BuiltinDataType)} onCommit={(v) => onUpdateColumn(c.id, { length: v })} />{track(c, "length", "長さ").revert}</td>
              <td className={track(c, "scale", "スケール").cls}><NumberCell value={c.scale} label={`${c.physicalName}のスケール`} readonly={readonly} disabled={!DATA_TYPES_WITH_SCALE.includes(c.dataType as BuiltinDataType)} onCommit={(v) => onUpdateColumn(c.id, { scale: v })} />{track(c, "scale", "スケール").revert}</td>
              <td className={`cg-flag ${track(c, "notNull", "NOT NULL").cls ?? ""}`.trim()}>{flag(c, "notNull", "NOT NULL")}{track(c, "notNull", "NOT NULL").revert}</td>
              <td className={`cg-flag ${track(c, "primaryKey", "主キー").cls ?? ""}`.trim()}>{flag(c, "primaryKey", "主キー")}{track(c, "primaryKey", "主キー").revert}</td>
              <td className={`cg-flag ${track(c, "unique", "ユニーク").cls ?? ""}`.trim()}>{flag(c, "unique", "ユニーク")}{track(c, "unique", "ユニーク").revert}</td>
              <td className={`cg-flag ${track(c, "autoIncrement", "自動採番").cls ?? ""}`.trim()}>{flag(c, "autoIncrement", "自動採番")}{track(c, "autoIncrement", "自動採番").revert}</td>
              <td className={track(c, "defaultValue", "デフォルト値").cls}><TextCell value={c.defaultValue ?? ""} label={`${c.physicalName}のデフォルト値`} readonly={readonly} mono onCommit={(v) => onUpdateColumn(c.id, { defaultValue: v || undefined })} />{track(c, "defaultValue", "デフォルト値").revert}</td>
              <td className={track(c, "comment", "備考").cls}><TextCell value={c.comment ?? ""} label={`${c.physicalName}の備考`} readonly={readonly} onCommit={(v) => onUpdateColumn(c.id, { comment: v || undefined })} />{track(c, "comment", "備考").revert}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="cg-hint">Tab = 次のセル / Enter = 下の行 (最後の行では、カラムを追加) / ↑↓ = 上下のセル / Esc = セルから出る / Ctrl+D = 上の行の値を写す / Ctrl+Enter = 下に行を挿入 / Ctrl+Shift+Enter = 行を複製 / Alt+Delete = 行を削除 / Alt+↑↓ = 行を動かす (行頭のつまみのドラッグでも)。文字のセルは、セルを出るときに反映されます。</p>
    </div>
  );
}
