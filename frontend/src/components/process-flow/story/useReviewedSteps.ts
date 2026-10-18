/**
 * 「確認済み」の印 (処理フローの「流れ」表示)。
 *
 * AI が詳細化した処理を、人が 1 行ずつ確かめたことを残す。設計の原本ではなく、確かめた人の手元の記録なので、
 * ブラウザに持つ (原本を書き換えない)。印を付けたあとに、その工程の内容が変わったら、印は外れた扱いになる
 * (工程の指紋を一緒に持つ)。
 */
import { useCallback, useState } from "react";

const KEY_PREFIX = "harmony.processFlow.reviewed.";

type ReviewedMap = Record<string, string>;

function read(key: string): ReviewedMap {
  try {
    const raw = localStorage.getItem(KEY_PREFIX + key);
    if (!raw) return {};
    const v: unknown = JSON.parse(raw);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as ReviewedMap) : {};
  } catch {
    return {};
  }
}

function write(key: string, map: ReviewedMap): void {
  try {
    if (Object.keys(map).length === 0) localStorage.removeItem(KEY_PREFIX + key);
    else localStorage.setItem(KEY_PREFIX + key, JSON.stringify(map));
  } catch { /* 保存できなくても、画面の中では使える */ }
}

export interface ReviewedSteps {
  /** いまの内容で、確認済みか */
  isReviewed: (stepId: string, digest: string) => boolean;
  /** 確認したあと、内容が変わったか */
  isStale: (stepId: string, digest: string) => boolean;
  toggle: (stepId: string, digest: string) => void;
  /** 確認済みの数 (いまの内容のまま) */
  countReviewed: (digests: ReadonlyMap<string, string>) => number;
  clear: () => void;
}

export function useReviewedSteps(storageKey: string): ReviewedSteps {
  // 置き場所 (処理フロー・アクション) が変わったら、その場で読み直す (effect で state を直さない)
  const [state, setState] = useState<{ key: string; map: ReviewedMap }>(() => ({ key: storageKey, map: read(storageKey) }));
  const map = state.key === storageKey ? state.map : read(storageKey);

  const toggle = useCallback((stepId: string, digest: string) => {
    // 別のタブが書いた分を失わないよう、書く直前に、保存済みの内容から作り直す
    const next = { ...read(storageKey) };
    if (next[stepId] === digest) delete next[stepId];
    else next[stepId] = digest;
    write(storageKey, next);
    setState({ key: storageKey, map: next });
  }, [storageKey]);

  const clear = useCallback(() => {
    setState({ key: storageKey, map: {} });
    write(storageKey, {});
  }, [storageKey]);

  return {
    isReviewed: (id, digest) => map[id] === digest,
    isStale: (id, digest) => id in map && map[id] !== digest,
    toggle,
    countReviewed: (digests) => {
      let n = 0;
      digests.forEach((d, id) => { if (map[id] === d) n++; });
      return n;
    },
    clear,
  };
}
