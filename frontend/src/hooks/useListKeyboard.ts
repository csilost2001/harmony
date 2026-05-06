import { useEffect } from "react";
import type { ListSelection } from "./useListSelection";
import type { ListClipboard } from "./useListClipboard";
import type { ListSort } from "./useListSort";

interface ListKeyboardOpts<T> {
  items: T[];
  getId: (item: T) => string;
  selection: ListSelection<T>;
  /** 指定すると Ctrl+C/X/Esc がクリップボードに自動連動 */
  clipboard?: ListClipboard<T>;
  /**
   * 指定すると sort 中 (sortKeys.length > 0) は「並び替え Read-only モード」になり
   * Ctrl+V / Ctrl+D / Alt+↑↓ を無視する (docs/spec/list-common.md §3.9)。
   * Ctrl+C / Ctrl+X / Delete / 選択系は引き続き動作。
   */
  sort?: ListSort<T>;
  /** "list" = 表 (↑↓のみ) / "grid" = カード (↑↓←→ の 2D ナビ) */
  layout?: "list" | "grid";
  /**
   * grid の 2D ナビで使用。ID から DOM 矩形を得る。
   * 未指定時は `document.querySelector('[data-row-id="..."]')` で取得
   */
  getItemRect?: (id: string) => DOMRect | null;
  onActivate?: (item: T) => void;
  onDelete?: (items: T[]) => void;
  /** @deprecated clipboard を渡すと自動連動する。手動で処理したい場合のみ指定 */
  onCopy?: (items: T[]) => void;
  /** @deprecated clipboard を渡すと自動連動する */
  onCut?: (items: T[]) => void;
  /** Ctrl+V。insertIndex は §3.4 挿入位置ルール準拠。clipboard 併用時は貼り付け処理本体で consume() を呼ぶ */
  onPaste?: (insertIndex: number | null) => void;
  onDuplicate?: (items: T[]) => void;
  onMoveUp?: (items: T[]) => void;
  onMoveDown?: (items: T[]) => void;
  /**
   * Menu キー / Shift+F10 でコンテキストメニューを開く (docs/spec/list-common.md §3.11)。
   * firstSelected は選択中の先頭行 (選択ゼロなら null)、anchorRect は位置決め用の矩形
   * (選択行があればその行の getBoundingClientRect、なければ一覧コンテナの左上)。
   */
  onContextMenuKey?: (firstSelected: T | null, anchorRect: DOMRect | null) => void;
  enabled?: boolean;
}

/**
 * 一覧向けキーボード操作。仕様 §3.2 / §3.3。
 * - 表 (list): ↑↓ / Shift+↑↓ / Home / End
 * - カード (grid): ↑↓←→ (2D) / Shift+↑↓←→ / Home / End
 * - 共通: Enter / F2 / Delete / Ctrl+A/C/X/V/D / Alt+↑↓ / Esc
 *
 * input/textarea/select/contenteditable がフォーカス中は無効。
 */
export function useListKeyboard<T>(opts: ListKeyboardOpts<T>): void {
  const {
    items, getId, selection,
    clipboard,
    sort,
    layout = "list",
    getItemRect,
    onActivate, onDelete, onCopy, onCut, onPaste, onDuplicate,
    onMoveUp, onMoveDown, onContextMenuKey,
    enabled = true,
  } = opts;

  useEffect(() => {
    if (!enabled) return;

    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      const tag = target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (target.isContentEditable) return;

      const ctrl = e.ctrlKey || e.metaKey;
      const itemIds = items.map(getId);
      // docs/spec/list-common.md §3.9: ソート中は並び替え Read-only モード
      const reorderDisabled = (sort?.sortKeys.length ?? 0) > 0;

      if (e.key === "Escape") {
        let handled = false;
        if (clipboard?.hasContent) {
          clipboard.clear();
          handled = true;
        }
        if (selection.selectedIds.size > 0) {
          selection.clearSelection();
          handled = true;
        }
        if (handled) e.preventDefault();
        return;
      }

      if (ctrl && e.key === "a") {
        e.preventDefault();
        selection.selectAll();
        return;
      }

      if (ctrl && !e.altKey && !e.shiftKey && e.key === "c") {
        if (selection.selectedItems.length > 0) {
          e.preventDefault();
          clipboard?.copy(selection.selectedItems);
          onCopy?.(selection.selectedItems);
        }
        return;
      }

      if (ctrl && !e.altKey && !e.shiftKey && e.key === "x") {
        if (selection.selectedItems.length > 0) {
          e.preventDefault();
          clipboard?.cut(selection.selectedItems);
          onCut?.(selection.selectedItems);
        }
        return;
      }

      if (ctrl && !e.altKey && !e.shiftKey && e.key === "v") {
        if (reorderDisabled) return; // §3.9: ソート中は貼り付け無効
        if (onPaste) {
          e.preventDefault();
          const selected = Array.from(selection.selectedIds);
          const insertIndex = selected.length > 0
            ? Math.max(...selected.map((id) => itemIds.indexOf(id))) + 1
            : null;
          onPaste(insertIndex);
        }
        return;
      }

      if (ctrl && !e.altKey && !e.shiftKey && e.key === "d") {
        if (reorderDisabled) return; // §3.9: ソート中は複製無効
        if (onDuplicate && selection.selectedItems.length > 0) {
          e.preventDefault();
          onDuplicate(selection.selectedItems);
        }
        return;
      }

      if (e.key === "Delete" && !ctrl && !e.altKey && !e.shiftKey) {
        if (onDelete && selection.selectedItems.length > 0) {
          e.preventDefault();
          onDelete(selection.selectedItems);
        }
        return;
      }

      if ((e.key === "Enter" || e.key === "F2") && !ctrl && !e.altKey) {
        if (onActivate && selection.selectedItems.length === 1) {
          e.preventDefault();
          onActivate(selection.selectedItems[0]);
        }
        return;
      }

      // docs/spec/list-common.md §3.11: Menu キー / Shift+F10 でコンテキストメニューを開く
      //  「選択中の行 (または先頭行) の位置にコンテキストメニューを開く」
      if (onContextMenuKey) {
        const isContextMenuKey =
          e.key === "ContextMenu" ||
          (e.shiftKey && e.key === "F10" && !ctrl && !e.altKey);
        if (isContextMenuKey) {
          e.preventDefault();
          // 選択があれば選択の先頭、なければ一覧の先頭行にフォールバック (spec §3.11)
          const anchor = selection.selectedItems[0] ?? items[0] ?? null;
          const anchorId = anchor ? getId(anchor) : null;
          const rect = anchorId
            ? (getItemRect?.(anchorId) ?? queryRowRect(anchorId))
            : null;
          onContextMenuKey(anchor, rect);
          return;
        }
      }

      if (e.altKey && !ctrl && !e.shiftKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
        if (reorderDisabled) return; // §3.9: ソート中は Alt+↑↓ 無効
        const moveHandler = e.key === "ArrowUp" ? onMoveUp : onMoveDown;
        if (moveHandler && selection.selectedItems.length > 0) {
          e.preventDefault();
          moveHandler(selection.selectedItems);
        }
        return;
      }

      if ((e.key === "Home" || e.key === "End") && !e.altKey) {
        if (itemIds.length === 0) return;
        e.preventDefault();
        const targetIdx = e.key === "Home" ? 0 : itemIds.length - 1;
        const targetId = itemIds[targetIdx];
        if (e.shiftKey && selection.getAnchorId()) {
          const anchorIdx = itemIds.indexOf(selection.getAnchorId()!);
          const [lo, hi] = anchorIdx < targetIdx ? [anchorIdx, targetIdx] : [targetIdx, anchorIdx];
          selection.setSelectedIds(new Set(itemIds.slice(lo, hi + 1)));
        } else {
          selection.setSelectedIds(new Set([targetId]));
        }
        return;
      }

      if (!ctrl && !e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
        if (itemIds.length === 0) return;
        e.preventDefault();
        const anchor = selection.getAnchorId();
        const anchorIdx = anchor ? itemIds.indexOf(anchor) : -1;

        let nextIdx: number;
        if (layout === "grid" && anchorIdx >= 0) {
          const found = findVerticalNeighbor(itemIds, anchorIdx, e.key === "ArrowUp" ? "up" : "down", getItemRect);
          nextIdx = found >= 0 ? found : anchorIdx;
        } else {
          const delta = e.key === "ArrowUp" ? -1 : 1;
          nextIdx = anchorIdx < 0
            ? (delta > 0 ? 0 : itemIds.length - 1)
            : Math.max(0, Math.min(itemIds.length - 1, anchorIdx + delta));
        }
        const nextId = itemIds[nextIdx];
        if (e.shiftKey && anchor) {
          const [lo, hi] = anchorIdx < nextIdx ? [anchorIdx, nextIdx] : [nextIdx, anchorIdx];
          selection.setSelectedIds(new Set(itemIds.slice(lo, hi + 1)));
        } else {
          selection.setSelectedIds(new Set([nextId]));
        }
        return;
      }

      if (layout === "grid" && !ctrl && !e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
        if (itemIds.length === 0) return;
        e.preventDefault();
        const anchor = selection.getAnchorId();
        const anchorIdx = anchor ? itemIds.indexOf(anchor) : -1;
        const delta = e.key === "ArrowLeft" ? -1 : 1;
        const nextIdx = anchorIdx < 0
          ? (delta > 0 ? 0 : itemIds.length - 1)
          : Math.max(0, Math.min(itemIds.length - 1, anchorIdx + delta));
        const nextId = itemIds[nextIdx];
        if (e.shiftKey && anchor) {
          const [lo, hi] = anchorIdx < nextIdx ? [anchorIdx, nextIdx] : [nextIdx, anchorIdx];
          selection.setSelectedIds(new Set(itemIds.slice(lo, hi + 1)));
        } else {
          selection.setSelectedIds(new Set([nextId]));
        }
        return;
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [
    enabled, items, getId, selection, clipboard, sort, layout, getItemRect,
    onActivate, onDelete, onCopy, onCut, onPaste, onDuplicate, onMoveUp, onMoveDown, onContextMenuKey,
  ]);
}

/** フォールバック: data-row-id で要素を探して矩形を返す */
function queryRowRect(id: string): DOMRect | null {
  if (typeof document === "undefined") return null;
  const el = document.querySelector<HTMLElement>(`[data-row-id="${CSS.escape(id)}"]`);
  return el ? el.getBoundingClientRect() : null;
}

/**
 * grid レイアウトで現在行より上/下の行のうち X 座標が最も近いカードの index を返す。
 * 見つからなければ -1。
 */
function findVerticalNeighbor(
  itemIds: string[],
  currentIdx: number,
  direction: "up" | "down",
  getRect?: (id: string) => DOMRect | null,
): number {
  const resolve = getRect ?? ((id: string) => {
    if (typeof document === "undefined") return null;
    const el = document.querySelector<HTMLElement>(`[data-row-id="${CSS.escape(id)}"]`);
    return el ? el.getBoundingClientRect() : null;
  });

  const currentRect = resolve(itemIds[currentIdx]);
  if (!currentRect) return -1;

  const candidates: { idx: number; top: number; left: number }[] = [];
  for (let i = 0; i < itemIds.length; i++) {
    if (i === currentIdx) continue;
    const r = resolve(itemIds[i]);
    if (!r) continue;
    if (direction === "down" && r.top <= currentRect.top) continue;
    if (direction === "up" && r.top >= currentRect.top) continue;
    candidates.push({ idx: i, top: r.top, left: r.left });
  }
  if (candidates.length === 0) return -1;

  // 次/前の行: direction=down なら top 最小、up なら top 最大
  const edgeTop = direction === "down"
    ? Math.min(...candidates.map((c) => c.top))
    : Math.max(...candidates.map((c) => c.top));
  const sameRow = candidates.filter((c) => Math.abs(c.top - edgeTop) < 1);
  // left が最も近いもの
  sameRow.sort((a, b) => Math.abs(a.left - currentRect.left) - Math.abs(b.left - currentRect.left));
  return sameRow[0].idx;
}
