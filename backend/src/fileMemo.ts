/**
 * ファイルの状態 (大きさ + 更新時刻) が変わらないあいだ、そのファイルから計算した結果を使い回す。
 *
 * 大きなプロジェクトでは、検査 (スキーマ違反・ファイルの健全性) を全件やり直すと数百ミリ秒〜1 秒かかる。1 件の保存のたびに全件をやり直さず、
 * 変わったファイルの分だけ計算し直す (変わっていないファイルは stat だけ)。結果が他のファイルの内容にも依存するときは、
 * extraFiles に、その依存先も渡す (どれかの状態が変われば、計算し直す)。
 */
import fs from "node:fs/promises";

export interface FileMemo<T> {
  /** file の状態が前と同じなら、前の結果を返す。違う (または初めて・stat できない) なら compute して覚える */
  get(file: string, compute: () => Promise<T>, extraFiles?: readonly string[]): Promise<T>;
  /** 覚えているものを捨てる */
  clear(): void;
  readonly size: number;
}

async function sigOf(files: readonly string[]): Promise<string | null> {
  const parts: string[] = [];
  for (const f of files) {
    try { const st = await fs.stat(f); parts.push(`${st.size}:${st.mtimeMs}`); } catch { parts.push("-"); }
  }
  // 本体 (最初のファイル) が無いなら、覚えない
  return parts[0] === "-" ? null : parts.join("|");
}

export function createFileMemo<T>(maxEntries = 20_000): FileMemo<T> {
  const map = new Map<string, { sig: string; value: T }>();
  return {
    async get(file, compute, extraFiles = []) {
      const sig = await sigOf([file, ...extraFiles]);
      if (sig === null) { map.delete(file); return compute(); }
      const hit = map.get(file);
      if (hit && hit.sig === sig) return hit.value;
      const value = await compute();
      // 計算のあいだに書き換えられていたら、覚えない (古い内容の結果を、新しい状態の印で覚えてしまわないため)
      if ((await sigOf([file, ...extraFiles])) === sig) {
        if (map.size >= maxEntries) map.delete(map.keys().next().value as string);
        map.set(file, { sig, value });
      }
      return value;
    },
    clear() { map.clear(); },
    get size() { return map.size; },
  };
}
