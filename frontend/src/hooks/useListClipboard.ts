import { useCallback, useMemo, useState } from "react";

export type ClipboardMode = "copy" | "cut";

export interface ListClipboardState<T> {
  mode: ClipboardMode | null;
  items: T[];
}

export interface ListClipboard<T> {
  clipboard: ListClipboardState<T>;
  hasContent: boolean;
  copy: (items: T[]) => void;
  cut: (items: T[]) => void;
  clear: () => void;
  /**
   * 貼り付け実行時に呼ぶ。
   * - cut: items を返して clear (移動)
   * - copy: items のディープコピーを返す (複製)
   */
  consume: () => T[];
  /** 指定 ID が切り取り対象 (ghosted 表示) か判定 */
  isItemCut: (id: string) => boolean;
}

/**
 * ブラウザ内クリップボード。仕様 §3.4。
 * - 外部 (Excel 等) とは連携しない
 * - セッション内のみ、localStorage には保存しない、タブ間共有なし
 */
export function useListClipboard<T>(
  getId: (item: T) => string,
): ListClipboard<T> {
  const [clipboard, setClipboard] = useState<ListClipboardState<T>>({
    mode: null,
    items: [],
  });

  const copy = useCallback((items: T[]) => {
    setClipboard({ mode: "copy", items: [...items] });
  }, []);

  const cut = useCallback((items: T[]) => {
    setClipboard({ mode: "cut", items: [...items] });
  }, []);

  const clear = useCallback(() => {
    setClipboard({ mode: null, items: [] });
  }, []);

  const consume = useCallback((): T[] => {
    if (clipboard.mode === null) return [];
    if (clipboard.mode === "cut") {
      const items = clipboard.items;
      setClipboard({ mode: null, items: [] });
      return items;
    }
    // copy: ディープコピーを返す
    return clipboard.items.map((it) => deepClone(it));
  }, [clipboard]);

  const cutIds = useMemo(() => {
    if (clipboard.mode !== "cut") return new Set<string>();
    return new Set(clipboard.items.map(getId));
  }, [clipboard, getId]);

  const isItemCut = useCallback((id: string) => cutIds.has(id), [cutIds]);

  return {
    clipboard,
    hasContent: clipboard.mode !== null && clipboard.items.length > 0,
    copy,
    cut,
    clear,
    consume,
    isItemCut,
  };
}

function deepClone<T>(value: T): T {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}
