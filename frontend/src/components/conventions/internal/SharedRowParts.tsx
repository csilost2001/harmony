/**
 * Conventions catalog editor — 共通行/セル部品 (#1145 Phase-5)
 *
 * `DeleteBtn` / `NewKeyRow` / `EntriesWrapper` / `DefaultCell` を category panel から
 * 再利用するための共有 component。Phase-5 前は ConventionsCatalogView.tsx 内に inline 定義。
 */
import React from "react";

export function DeleteBtn({ onClick, isReadonly }: { onClick: () => void; isReadonly?: boolean }) {
  return (
    <button
      type="button"
      className="btn btn-sm btn-link text-danger p-0"
      onClick={onClick}
      title="削除"
      aria-label="削除"
      disabled={isReadonly}
    >
      <i className="bi bi-x" />
    </button>
  );
}

export function NewKeyRow({
  placeholder, value, setValue, onAdd, disabled, isReadonly,
}: {
  placeholder: string;
  value: string;
  setValue: (v: string) => void;
  onAdd: () => void;
  disabled: boolean;
  isReadonly?: boolean;
}) {
  return (
    <div className="conventions-new-key-row">
      <input
        className="form-control form-control-sm conventions-new-key-input"
        placeholder={placeholder}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && !disabled && !isReadonly) { e.preventDefault(); onAdd(); } }}
        disabled={isReadonly}
      />
      <button
        type="button"
        className="btn btn-sm btn-outline-primary"
        onClick={onAdd}
        disabled={disabled || isReadonly}
      >
        <i className="bi bi-plus-lg" /> 追加
      </button>
    </div>
  );
}

export function EntriesWrapper({ children, empty }: { children: React.ReactNode; empty: boolean }) {
  return (
    <div className="conventions-entries">
      {empty && <div className="conventions-empty">エントリがありません。下の入力欄から追加してください。</div>}
      {children}
    </div>
  );
}

export function DefaultCell<T extends { default?: boolean }>({
  entry, onUpdate, onCommit,
}: {
  entry: T;
  onUpdate: (patch: Partial<T>) => void;
  onCommit: () => void;
}) {
  return (
    <td className="text-center" title="プロジェクト全体の ambient default として扱う">
      <input
        type="checkbox"
        checked={entry.default ?? false}
        onChange={(e) => {
          onUpdate({ default: e.target.checked || undefined } as Partial<T>);
          onCommit();
        }}
      />
    </td>
  );
}
