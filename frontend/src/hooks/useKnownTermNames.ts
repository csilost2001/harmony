import { useEffect, useMemo, useState } from "react";
import { loadAllTables } from "../store/tableStore";

const TTL_MS = 30_000;
interface Entry { tableId: string; names: string[] }
let cache: { at: number; entries: Entry[] } | null = null;
let inflight: Promise<Entry[]> | null = null;

/** プロジェクトのテーブル名とカラムの表示名 (すべてのテーブル)。30 秒は使い回し、同時に尋ねるのは 1 回だけ */
function loadNames(): Promise<Entry[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return Promise.resolve(cache.entries);
  inflight ??= loadAllTables()
    .then((tables) => {
      const entries = tables.map((t) => ({ tableId: t.id as string, names: [t.name as string, ...t.columns.map((c) => c.name as string)].filter(Boolean) }));
      cache = { at: Date.now(), entries };
      return entries;
    })
    .catch(() => [] as Entry[])
    .finally(() => { inflight = null; });
  return inflight;
}

/** 書き方のゆれを調べる基準にする、ほかのテーブルの名前 (編集中のテーブルは含めない。呼び出し側が編集中の内容を足す)。まだ読めていない間は空 */
export function useKnownTermNames(excludeTableId: string, enabled = true): readonly string[] {
  const [entries, setEntries] = useState<Entry[]>(cache?.entries ?? []);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    void loadNames().then((n) => { if (alive) setEntries(n); });
    return () => { alive = false; };
  }, [enabled]);
  return useMemo(() => entries.filter((e) => e.tableId !== excludeTableId).flatMap((e) => e.names), [entries, excludeTableId]);
}
