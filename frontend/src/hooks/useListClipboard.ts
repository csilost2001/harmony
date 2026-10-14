import { useCallback, useMemo, useState, useSyncExternalStore } from "react";

export type ClipboardMode = "copy" | "cut";

export interface ListClipboardState<T> {
  mode: ClipboardMode | null;
  items: T[];
  /** どの編集画面 (テーブル・画面など) からコピーしたか。共有のクリップボードでだけ入る */
  source?: string;
}

export interface ListClipboard<T> {
  clipboard: ListClipboardState<T>;
  hasContent: boolean;
  copy: (items: T[]) => void;
  cut: (items: T[]) => void;
  clear: () => void;
  /**
   * 貼り付け実行時に呼ぶ。
   * - cut: items を返して clear (移動)。別の編集画面から切り取ったものは、元を消せないので、コピーとして貼る
   *   (クリップボードは「コピー」に変わり、元の画面には残る)
   * - copy: items のディープコピーを返す (複製)
   */
  consume: () => T[];
  /** 指定 ID が切り取り対象 (ghosted 表示) か判定 */
  isItemCut: (id: string) => boolean;
  /** 別の編集画面からコピー / 切り取りしたものか (共有のクリップボードでだけ true になりうる) */
  isForeign: boolean;
}

/** 共有のクリップボードの指定。同じ channel の編集画面どうしで、コピーしたものを運べる */
export interface ClipboardShare {
  /** 運べる種類 (例: "columns" = テーブルのカラム、"screen-items" = 画面項目) */
  channel: string;
  /** この編集画面の ID (テーブル ID・画面 ID)。コピー元の判定に使う */
  sourceId: string;
}

// ── 共有のクリップボード (メモリのみ。保存しない・ブラウザのタブをまたがない) ──
const shared = new Map<string, ListClipboardState<unknown>>();
const sharedListeners = new Set<() => void>();
const EMPTY: ListClipboardState<never> = { mode: null, items: [] };
const readShared = (channel: string): ListClipboardState<unknown> => shared.get(channel) ?? EMPTY;
const writeShared = (channel: string, next: ListClipboardState<unknown>) => {
  if (next.mode === null) shared.delete(channel); else shared.set(channel, next);
  sharedListeners.forEach((l) => l());
};
const subscribeShared = (l: () => void) => { sharedListeners.add(l); return () => { sharedListeners.delete(l); }; };

/** テスト用: 共有のクリップボードを空にする */
export function _resetSharedClipboards(): void { shared.clear(); sharedListeners.forEach((l) => l()); }

/**
 * ブラウザ内クリップボード。仕様 §3.4。
 * - 外部 (Excel 等) とは連携しない
 * - セッション内のみ、localStorage には保存しない、タブ間共有なし
 * - `share` を渡すと、同じ channel の別の編集画面 (別のテーブル・別の画面) へも運べる
 */
export function useListClipboard<T>(
  getId: (item: T) => string,
  share?: ClipboardShare,
): ListClipboard<T> {
  const [local, setLocal] = useState<ListClipboardState<T>>({ mode: null, items: [] });
  const channel = share?.channel;
  const sourceId = share?.sourceId;
  const sharedState = useSyncExternalStore(
    subscribeShared,
    () => (channel ? readShared(channel) : EMPTY),
    () => EMPTY,
  ) as ListClipboardState<T>;
  const clipboard = channel ? sharedState : local;

  const set = useCallback((next: ListClipboardState<T>) => {
    if (channel) writeShared(channel, next as ListClipboardState<unknown>);
    else setLocal(next);
  }, [channel]);

  const copy = useCallback((items: T[]) => {
    set({ mode: "copy", items: [...items], source: sourceId });
  }, [set, sourceId]);

  const cut = useCallback((items: T[]) => {
    set({ mode: "cut", items: [...items], source: sourceId });
  }, [set, sourceId]);

  const clear = useCallback(() => {
    set({ mode: null, items: [] });
  }, [set]);

  const isForeign = !!channel && clipboard.mode !== null && clipboard.source !== undefined && clipboard.source !== sourceId;

  const consume = useCallback((): T[] => {
    if (clipboard.mode === null) return [];
    if (clipboard.mode === "cut" && !isForeign) {
      const items = clipboard.items;
      set({ mode: null, items: [] });
      return items;
    }
    // copy、または別の編集画面から切り取ったもの (元は消せないのでコピー): ディープコピーを返す
    if (clipboard.mode === "cut") set({ mode: "copy", items: clipboard.items, source: clipboard.source });
    return clipboard.items.map((it) => deepClone(it));
  }, [clipboard, isForeign, set]);

  const cutIds = useMemo(() => {
    // 別の編集画面から切り取ったものは、この画面の行を薄くしない
    if (clipboard.mode !== "cut" || isForeign) return new Set<string>();
    return new Set(clipboard.items.map(getId));
  }, [clipboard, getId, isForeign]);

  const isItemCut = useCallback((id: string) => cutIds.has(id), [cutIds]);

  return {
    clipboard,
    hasContent: clipboard.mode !== null && clipboard.items.length > 0,
    copy,
    cut,
    clear,
    consume,
    isItemCut,
    isForeign,
  };
}

function deepClone<T>(value: T): T {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}
