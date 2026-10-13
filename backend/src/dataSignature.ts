/**
 * ワークスペースのデータの「署名」。設計のファイル (と harmony.json) の、名前・大きさ・更新時刻から作る。
 * 読み出して計算するだけの重い処理 (設計書の入力・スキーマ違反の検査) の結果を、データが変わるまで使い回すための鍵。
 * 全ファイルを stat するだけなので、全部を読んで検査し直すより桁違いに軽い (約 600 件で数十 ms)。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { resolveDataRoot } from "./projectStorage.js";

async function sigOfDir(dir: string, out: string[]): Promise<void> {
  let entries: import("node:fs").Dirent[];
  try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
  const stats = await Promise.all(entries.map(async (e) => {
    const p = path.join(dir, e.name);
    // 隠しフォルダ (.harmony-backups / .harmony-journal など。設計のデータではない) は署名に入れない
    if (e.isDirectory() && e.name.startsWith(".")) return "";
    if (e.isDirectory()) { const sub: string[] = []; await sigOfDir(p, sub); return sub.join("|"); }
    try { const st = await fs.stat(p); return `${e.name}:${st.size}:${Math.round(st.mtimeMs)}`; } catch { return `${e.name}:?`; }
  }));
  out.push(...stats.sort());
}

export async function dataSignature(root: string): Promise<string> {
  const parts: string[] = [];
  try { const st = await fs.stat(path.join(root, "harmony.json")); parts.push(`harmony.json:${st.size}:${Math.round(st.mtimeMs)}`); } catch { parts.push("harmony.json:-"); }
  const dataRoot = await resolveDataRoot(root).catch(() => null);
  if (dataRoot) await sigOfDir(dataRoot, parts);
  return parts.join("|");
}

/** 直近 1 件の結果を、署名が同じあいだ使い回す (ワークスペースごと)。同時に来た問い合わせは、同じ計算を共有する */
export function memoizeBySignature<T>(compute: (root: string) => Promise<T>): (root: string) => Promise<T> {
  const last = new Map<string, { sig: string; value: Promise<T> }>();
  return async (root: string) => {
    const sig = await dataSignature(root);
    const hit = last.get(root);
    if (hit && hit.sig === sig) return hit.value;
    const value = compute(root);
    last.set(root, { sig, value });
    value.catch(() => { if (last.get(root)?.value === value) last.delete(root); });
    return value;
  };
}
