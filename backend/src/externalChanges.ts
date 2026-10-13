/**
 * 設計ファイルが、この backend の外 (エディタ・git・別の AI など) で書き換えられたことを検知して、画面へ知らせる。
 *
 * 画面は、開いた設計を保存まで読み直さない。外で書き換えられたのに気づかないと、古い内容で上書き保存して
 * 外での変更を失う。ここで検知し、AI が書き換えたときと同じ `<種類>Changed` の通知を出す
 * (編集していなければ自動で読み直し、編集中ならバナーで知らせる: useResourceEditor)。
 *
 * この backend 自身の書き込み (画面の保存・AI の tool・改名など) は通知しない。見分けるため、fs の書き込み系の呼び出しを
 * 1 か所で包み (installSelfWriteTracking)、書いたファイルのパスを短時間 (SELF_WINDOW_MS) 覚える。覚えているパスの変化は
 * 自分の書き込みとして除く。要求の処理中かどうかではなく、**そのファイル**で決めるので、画面が別の操作を続けていても
 * (ハートビートなど)、外部の変更は見逃さない。同じファイルを、backend が書いた直後 (SELF_WINDOW_MS 以内) に外で書き換えた
 * 場合だけは、検知できない。
 * 仕様: docs/spec/external-change-detection.md
 */
import fsSync, { watch, type FSWatcher } from "node:fs";
import fsPromises from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveDataRoot } from "./projectStorage.js";
import { logInfo, logWarn } from "./serverLog.js";

/** 自分の書き込みとみなす時間 (ファイル監視の通知は、書き込みから少し遅れて届く) */
export const SELF_WINDOW_MS = 1500;
/** 変化をまとめて通知するまでの待ち */
export const DEBOUNCE_MS = 300;

// ── 自分の書き込みの記録 ─────────────────────────────────────────────────────
const selfMarks = new Map<string, number>();

/** このパスを、いま backend が書いた (書く) ものとして覚える */
export function markSelfWrite(p: unknown, now = Date.now()): void {
  if (typeof p !== "string" && !(p instanceof URL) && !Buffer.isBuffer(p)) return;
  let abs: string;
  try { abs = path.resolve(p instanceof URL ? fileURLToPath(p) : p.toString()); } catch { return; }
  selfMarks.set(abs, now);
  if (selfMarks.size > 4000) for (const [k, t] of selfMarks) if (now - t >= SELF_WINDOW_MS) selfMarks.delete(k);
}

/** backend が、このパスを書いた直後か */
export function isSelfWritePath(abs: string, now = Date.now()): boolean {
  const t = selfMarks.get(path.resolve(abs));
  return t !== undefined && now - t < SELF_WINDOW_MS;
}

const WRITE_FNS = ["writeFile", "rename", "unlink", "rm", "rmdir", "copyFile", "truncate", "cp"] as const;
const PATH_ARGS: Record<string, number[]> = { rename: [0, 1], copyFile: [0, 1], cp: [0, 1] };
let tracking = false;

/**
 * fs の書き込み系 (promises 版・同期版) を包んで、書いたパスを markSelfWrite で覚える。プロセスで 1 回だけ。
 * 本来の動作 (引数・戻り値・エラー) は変えない。起動の最初 (どの storage モジュールより前) に呼ぶ。
 */
export function installSelfWriteTracking(): void {
  if (tracking) return;
  tracking = true;
  const wrap = <T extends object>(target: T, suffix: string, isAsync: boolean): void => {
    for (const name of WRITE_FNS) {
      const key = `${name}${suffix}`;
      const orig = (target as Record<string, unknown>)[key];
      if (typeof orig !== "function") continue;
      const idx = PATH_ARGS[name] ?? [0];
      const mark = (args: unknown[]): void => { for (const i of idx) markSelfWrite(args[i]); };
      (target as Record<string, unknown>)[key] = isAsync
        ? async function (this: unknown, ...args: unknown[]) { mark(args); try { return await (orig as (...a: unknown[]) => unknown).apply(this, args); } finally { mark(args); } }
        : function (this: unknown, ...args: unknown[]) { mark(args); try { return (orig as (...a: unknown[]) => unknown).apply(this, args); } finally { mark(args); } };
    }
  };
  wrap(fsPromises, "", true);
  wrap(fsSync, "Sync", false);
  syncBuiltinESMExports();
}

export interface ChangeEvent { event: string; data: Record<string, string> }

const DIR_EVENTS: Array<{ dir: string; event: string; idField: string }> = [
  { dir: "screens", event: "screenChanged", idField: "screenId" },
  { dir: "screen-items", event: "screenItemsChanged", idField: "screenId" },
  { dir: "tables", event: "tableChanged", idField: "tableId" },
  { dir: "process-flows", event: "processFlowChanged", idField: "processFlowId" },
  { dir: "actions", event: "processFlowChanged", idField: "processFlowId" },
  { dir: "sequences", event: "sequenceChanged", idField: "sequenceId" },
  { dir: "views", event: "viewChanged", idField: "viewId" },
  { dir: "view-definitions", event: "viewDefinitionChanged", idField: "viewDefinitionId" },
  { dir: "page-layouts", event: "pageLayoutChanged", idField: "pageLayoutId" },
  { dir: "business-flows", event: "businessFlowChanged", idField: "flowId" },
  { dir: "reports", event: "reportChanged", idField: "reportId" },
];

/** データフォルダからの相対パス (例: `tables/orders.json`) を、画面へ出す通知にする。設計のファイルでなければ null */
export function classifyChangedPath(relPath: string): ChangeEvent | null {
  const segs = relPath.split(/[\\/]/).filter(Boolean);
  if (segs.some((s) => s.startsWith("."))) return null; // 隠しフォルダ・一時ファイル・退避
  const file = segs[segs.length - 1] ?? "";
  if (!file.endsWith(".json")) return null;
  if (segs.length === 1) {
    if (file === "layout-components.json") return { event: "layoutComponentsChanged", data: {} };
    return null;
  }
  const hit = DIR_EVENTS.find((d) => d.dir === segs[0]);
  if (hit && segs.length === 2) {
    const id = file.replace(/\.design\.json$/, "").replace(/\.json$/, "");
    return { event: hit.event, data: { [hit.idField]: id } };
  }
  if (segs[0] === "generic-definitions" && segs.length === 3) {
    return { event: "genericDefinitionChanged", data: { kind: segs[1], name: file.replace(/\.json$/, "") } };
  }
  return null;
}

interface Watching { watcher: FSWatcher; timer: NodeJS.Timeout | null; pending: Map<string, ChangeEvent> }

/** ワークスペースごとのファイル監視。画面が接続したワークスペースだけ、遅れて開始する */
export class ExternalChangeWatcher {
  private watching = new Map<string, Watching>();
  private starting = new Set<string>();
  constructor(private readonly emit: (root: string, evs: ChangeEvent[], paths: string[]) => void) {}

  /** root (ワークスペース) の監視を始める (すでに始めていれば何もしない) */
  async ensure(root: string): Promise<void> {
    if (this.watching.has(root) || this.starting.has(root)) return;
    this.starting.add(root);
    try {
      const dataRoot = await resolveDataRoot(root);
      const w: Watching = { watcher: null as unknown as FSWatcher, timer: null, pending: new Map() };
      w.watcher = watch(dataRoot, { recursive: true, persistent: false }, (_type, name) => {
        if (!name) return;
        const rel = name.toString();
        if (isSelfWritePath(path.join(dataRoot, rel))) return; // backend 自身の書き込み
        const ev = classifyChangedPath(rel);
        if (!ev) return;
        w.pending.set(rel, ev);
        if (w.timer) clearTimeout(w.timer);
        w.timer = setTimeout(() => {
          w.timer = null;
          const batch = [...w.pending.entries()];
          w.pending.clear();
          const seen = new Set<string>();
          const evs: ChangeEvent[] = [];
          for (const [, e] of batch) {
            const key = `${e.event}:${JSON.stringify(e.data)}`;
            if (!seen.has(key)) { seen.add(key); evs.push(e); }
          }
          if (evs.length) this.emit(root, evs, batch.map(([p]) => p));
        }, DEBOUNCE_MS);
      });
      w.watcher.on("error", (e) => {
        logWarn("external-change", "watch.error", { error: e.message });
        this.close(root);
      });
      this.watching.set(root, w);
      logInfo("external-change", "watch.start", { dataRoot: path.basename(dataRoot) });
    } catch (e) {
      // harmony.json が無い・読めない・監視が使えない環境 (起動時に毎回落とさない)。次の接続でやり直す
      logWarn("external-change", "watch.unavailable", { error: e instanceof Error ? e.message : String(e) });
    } finally {
      this.starting.delete(root);
    }
  }

  close(root: string): void {
    const w = this.watching.get(root);
    if (!w) return;
    if (w.timer) clearTimeout(w.timer);
    try { w.watcher.close(); } catch { /* ignore */ }
    this.watching.delete(root);
  }

  closeAll(): void { for (const r of [...this.watching.keys()]) this.close(r); }
}
