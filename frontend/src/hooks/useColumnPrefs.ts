import { useCallback, useState } from "react";
import { emptyPrefs, loadColumnPrefs, saveColumnPrefs, type ColumnPrefs } from "../utils/columnPrefs";

/** 一覧の列の設定 (幅・表示・並び) を、key ごとにブラウザへ覚える。key が無ければ、覚えない (設定も使えない) */
export function useColumnPrefs(key: string | undefined): [ColumnPrefs, (next: ColumnPrefs | ((p: ColumnPrefs) => ColumnPrefs)) => void] {
  const [state, setState] = useState<{ key: string | undefined; prefs: ColumnPrefs }>(() => ({ key, prefs: key ? loadColumnPrefs(key) : emptyPrefs() }));
  // key が変わったら (別の画面の一覧に切り替わったら)、その key の設定を読み直す
  let current = state;
  if (state.key !== key) {
    current = { key, prefs: key ? loadColumnPrefs(key) : emptyPrefs() };
    setState(current);
  }
  const update = useCallback((next: ColumnPrefs | ((p: ColumnPrefs) => ColumnPrefs)) => {
    setState((s) => {
      const prefs = typeof next === "function" ? next(s.prefs) : next;
      if (s.key) saveColumnPrefs(s.key, prefs);
      return { ...s, prefs };
    });
  }, []);
  return [current.prefs, update];
}
