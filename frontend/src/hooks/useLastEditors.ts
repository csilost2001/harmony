import { useEffect, useState } from "react";
import { lastEditIndex, type LastEdit } from "../utils/designHistory";
import { opsApi } from "../utils/opsApi";

const TTL_MS = 30_000;
let cache: { at: number; index: Map<string, LastEdit> } | null = null;
let inflight: Promise<Map<string, LastEdit>> | null = null;

function load(): Promise<Map<string, LastEdit>> {
  if (cache && Date.now() - cache.at < TTL_MS) return Promise.resolve(cache.index);
  inflight ??= opsApi.auditList({ limit: 2000 })
    .then((r) => { const index = lastEditIndex(r.entries); cache = { at: Date.now(), index }; return index; })
    .catch(() => new Map<string, LastEdit>())
    .finally(() => { inflight = null; });
  return inflight;
}

const EMPTY = new Map<string, LastEdit>();

/** 設計ごとの最終編集 (一覧の列用)。キーは `<種類>:<id>`。変更の記録から、1 回の問い合わせで引く (30 秒は使い回す)。読めない間・記録が無いときは空 */
export function useLastEditors(enabled = true): ReadonlyMap<string, LastEdit> {
  const [index, setIndex] = useState<ReadonlyMap<string, LastEdit>>(cache?.index ?? EMPTY);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    void load().then((i) => { if (alive) setIndex(i); });
    return () => { alive = false; };
  }, [enabled]);
  return index;
}

/** テスト用 */
export function _resetLastEditorsCache(): void { cache = null; inflight = null; }
