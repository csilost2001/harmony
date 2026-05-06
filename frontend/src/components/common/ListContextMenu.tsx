import { useEffect, useLayoutEffect, useRef, useState, type ReactElement } from "react";

/**
 * docs/spec/list-common.md §3.11 / §4.6 / §5.10
 * 一覧画面共通の右クリックメニュー。
 */

export interface ContextMenuItem {
  /** 一意キー (React key) */
  key: string;
  /** 表示ラベル。省略 + separator=true でセパレータとして動作 */
  label?: string;
  /** Bootstrap Icons クラス名 (例: "bi-trash") */
  icon?: string;
  /** キーボードショートカット表示 (右寄せ、例: "Ctrl+C")。動作は結び付けない (既存 useListKeyboard に任せる) */
  shortcut?: string;
  disabled?: boolean;
  /** disabled 時の説明 (tooltip 用) */
  disabledReason?: string;
  /** true ならセパレータ (水平線)。label / icon / onClick は無視される */
  separator?: boolean;
  onClick?: () => void;
  /** 破壊的操作 (削除系) の視覚強調。true で danger スタイル */
  danger?: boolean;
}

interface Props {
  items: ContextMenuItem[];
  /** 表示座標 (CSS px)。clientX / clientY 相当 */
  x: number;
  y: number;
  onClose: () => void;
}

export function ListContextMenu({ items, x, y, onClose }: Props): ReactElement {
  const menuRef = useRef<HTMLDivElement | null>(null);
  // docs/spec/list-common.md §4.6: 閉じた時に元の要素にフォーカスを戻す
  const previousActiveRef = useRef<HTMLElement | null>(
    typeof document !== "undefined" ? (document.activeElement as HTMLElement) : null,
  );
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: x, top: y });
  const [focusedIdx, setFocusedIdx] = useState<number>(() => firstFocusableIndex(items));

  // アンマウント時に元のフォーカスへ戻す
  useEffect(() => {
    const prev = previousActiveRef.current;
    return () => {
      if (prev && typeof prev.focus === "function") {
        try { prev.focus(); } catch { /* 既に DOM から外れている等は無視 */ }
      }
    };
  }, []);

  // 画面端からはみ出す場合は反対側にフリップ
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    let left = x;
    let top = y;
    if (left + rect.width > window.innerWidth - 4) {
      left = Math.max(4, x - rect.width);
    }
    if (top + rect.height > window.innerHeight - 4) {
      top = Math.max(4, y - rect.height);
    }
    setPos({ left, top });
  }, [x, y, items]);

  // キーボード: ↑↓ / Enter / Esc
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setFocusedIdx((cur) => moveFocus(items, cur, e.key === "ArrowDown" ? 1 : -1));
        return;
      }
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        const item = items[focusedIdx];
        if (item && !item.separator && !item.disabled && item.onClick) {
          item.onClick();
          onClose();
        }
        return;
      }
    };
    window.addEventListener("keydown", handler, { capture: true });
    return () => window.removeEventListener("keydown", handler, { capture: true });
  }, [items, focusedIdx, onClose]);

  // 外クリックで閉じる
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!menuRef.current) return;
      if (menuRef.current.contains(e.target as Node)) return;
      onClose();
    };
    // capture で mousedown を取ることで、クリック対象が useEffect で消えても確実に閉じる
    window.addEventListener("mousedown", handler, { capture: true });
    return () => window.removeEventListener("mousedown", handler, { capture: true });
  }, [onClose]);

  // 初期フォーカス
  useEffect(() => {
    if (focusedIdx < 0) return;
    const el = menuRef.current?.querySelectorAll<HTMLElement>("[data-menu-item]")[focusedIdx];
    el?.focus();
  }, [focusedIdx]);

  return (
    <div
      ref={menuRef}
      className="list-context-menu"
      role="menu"
      style={{ position: "fixed", left: pos.left, top: pos.top, zIndex: 10000 }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((item, idx) => {
        if (item.separator) {
          return <div key={item.key} className="list-context-menu-separator" role="separator" />;
        }
        return (
          <button
            key={item.key}
            type="button"
            data-menu-item
            role="menuitem"
            className={`list-context-menu-item${item.disabled ? " disabled" : ""}${item.danger ? " danger" : ""}`}
            disabled={item.disabled}
            title={item.disabled ? item.disabledReason : undefined}
            tabIndex={focusedIdx === idx ? 0 : -1}
            onClick={() => {
              if (item.disabled) return;
              item.onClick?.();
              onClose();
            }}
            onMouseEnter={() => {
              if (!item.disabled) setFocusedIdx(idx);
            }}
          >
            <span className="list-context-menu-icon">
              {item.icon && <i className={`bi ${item.icon}`} />}
            </span>
            <span className="list-context-menu-label">{item.label}</span>
            {item.shortcut && <span className="list-context-menu-shortcut">{item.shortcut}</span>}
          </button>
        );
      })}
    </div>
  );
}

// ── helpers ───────────────────────────────────────────────────────────────

function firstFocusableIndex(items: ContextMenuItem[]): number {
  for (let i = 0; i < items.length; i++) {
    if (!items[i].separator && !items[i].disabled) return i;
  }
  return -1;
}

function moveFocus(items: ContextMenuItem[], cur: number, delta: 1 | -1): number {
  if (items.length === 0) return -1;
  let idx = cur;
  for (let attempt = 0; attempt < items.length; attempt++) {
    idx = (idx + delta + items.length) % items.length;
    const it = items[idx];
    if (!it.separator && !it.disabled) return idx;
  }
  return cur;
}
