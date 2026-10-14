/**
 * 設計ファイルが、この backend の外 (エディタ・git・別の AI など) で書き換えられたことを検知して、画面へ知らせる。
 *
 * 画面は、開いた設計を保存まで読み直さない。外で書き換えられたのに気づかないと、古い内容で上書き保存して
 * 外での変更を失う。ここで検知し、AI が書き換えたときと同じ `<種類>Changed` の通知を出す
 * (編集していなければ自動で読み直し、編集中ならバナーで知らせる: useResourceEditor)。
 *
 * この backend 自身の書き込み (画面の保存・AI の tool・改名など) は通知しない。見分けるため、fs の書き込み系の呼び出しを
 * 1 か所で包み (installSelfWriteTracking)、書き終えたファイルの状態 (大きさ + 更新時刻) を覚える。変化の通知が届いたとき、
 * ファイルの状態が覚えている状態と同じなら、自分の書き込みとして除く。通知が届くのが遅れても (backend が重い処理で塞がっていても)
 * 誤検知せず、書いた直後に外で書き換えられても (状態が違うので) 見逃さない。要求の処理中かどうかではなく**そのファイル**で決めるので、
 * 画面が別の操作を続けていても (ハートビートなど) 外部の変更を見逃さない。
 * 仕様: docs/spec/external-change-detection.md
 */
import fsSync, { readdirSync, statSync, watch, type FSWatcher } from "node:fs";
import fsPromises from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveDataRoot } from "./projectStorage.js";
import { logInfo, logWarn } from "./serverLog.js";

/** 書く途中 (状態が決まる前) の変化を、自分の書き込みとみなす時間 */
export const SELF_WINDOW_MS = 1500;
/** 書き終えた状態を覚えておく時間 (これを過ぎた記録は捨てる) */
export const SELF_KEEP_MS = 5 * 60 * 1000;
/** 変化をまとめて通知するまでの待ち */
export const DEBOUNCE_MS = 300;
/** 監視を始められなかったワークスペースを、もう一度試すまでの待ち */
export const RETRY_AFTER_MS = 60_000;

// ── 自分の書き込みの記録 ─────────────────────────────────────────────────────
interface SelfMark { t: number; sig?: string }
const selfMarks = new Map<string, SelfMark>();
/** 自分が消したフォルダ (その下のファイルの削除通知を、自分のものとして除く) */
const selfRemoved = new Map<string, number>();

/** ファイルの状態 (大きさ + 更新時刻)。無ければ "-" */
function sigOf(abs: string): string {
  try { const st = statSync(abs); return `${st.size}:${st.mtimeMs}`; } catch { return "-"; }
}

function toAbs(p: unknown): string | null {
  if (typeof p !== "string" && !(p instanceof URL) && !Buffer.isBuffer(p)) return null;
  try { return path.resolve(p instanceof URL ? fileURLToPath(p) : p.toString()); } catch { return null; }
}

/**
 * このパスを、backend が書く (書いた) ものとして覚える。settled が true なら、書き終えた状態も覚える (書く前に呼ぶときは false)。
 */
export function markSelfWrite(p: unknown, settled = false, now = Date.now(), dirRemoval = false): void {
  const abs = toAbs(p);
  if (!abs) return;
  const sig = settled ? sigOf(abs) : undefined;
  selfMarks.set(abs, sig === undefined ? { t: now } : { t: now, sig });
  if (settled) {
    if (sig === "-") {
      // フォルダ (または再帰の削除) の削除だけ、配下のファイルの削除通知も「自分」にする。ファイル 1 件の削除は、そのファイルの状態 ("-") だけで足りる
      if (dirRemoval) selfRemoved.set(abs, now);
    } else {
      // 作り直した (書いた) ので、そのパスと、その親にあたる「自分が消した」記録は外す (あとの外部の削除を、取りこぼさない)
      for (const k of selfRemoved.keys()) if (abs === k || abs.startsWith(k + path.sep)) selfRemoved.delete(k);
    }
  }
  if (selfMarks.size > 4000) {
    for (const [k, m] of selfMarks) if (now - m.t >= SELF_KEEP_MS) selfMarks.delete(k);
    for (const [k, t] of selfRemoved) if (now - t >= SELF_KEEP_MS) selfRemoved.delete(k);
  }
}

/** backend が書いた (消した) 結果の変化か。通知が届くのが遅れても、ファイルの状態で判断する */
export function isSelfWritePath(abs: string, now = Date.now()): boolean {
  const key = path.resolve(abs);
  const m = selfMarks.get(key);
  if (m) {
    if (m.sig === undefined) { if (now - m.t < SELF_WINDOW_MS) return true; }
    else if (now - m.t < SELF_KEEP_MS && sigOf(key) === m.sig) return true;
    // 外部の変化 (状態が覚えているものと違う) を検知したので、記録は捨てる (残すと、続く外部の変化 (作り直し → 削除など) を隠す)
    if (m.sig !== undefined) selfMarks.delete(key);
  }
  // 自分が消したフォルダの下のファイルが、無くなった通知
  if (sigOf(key) === "-") {
    for (const [dir, t] of selfRemoved) if (now - t < SELF_KEEP_MS && (key === dir || key.startsWith(dir + path.sep))) return true;
  }
  return false;
}

const WRITE_FNS = ["writeFile", "rename", "unlink", "rm", "rmdir", "copyFile", "truncate", "cp"] as const;
const PATH_ARGS: Record<string, number[]> = { rename: [0, 1], copyFile: [0, 1], cp: [0, 1] };
let tracking = false;

/**
 * fs の書き込み系 (promises 版・同期版) を包んで、書いたパスを覚える。プロセスで 1 回だけ。
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
      const dirRemoval = name === "rm" || name === "rmdir";
      const mark = (args: unknown[], settled: boolean): void => { for (const i of idx) markSelfWrite(args[i], settled, Date.now(), dirRemoval); };
      (target as Record<string, unknown>)[key] = isAsync
        ? async function (this: unknown, ...args: unknown[]) { mark(args, false); try { return await (orig as (...a: unknown[]) => unknown).apply(this, args); } finally { mark(args, true); } }
        : function (this: unknown, ...args: unknown[]) { mark(args, false); try { return (orig as (...a: unknown[]) => unknown).apply(this, args); } finally { mark(args, true); } };
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
    if (file === "design-check.json") return { event: "designCheckChanged", data: {} };
    // 運用の記録 (承認・コメント・権限・体裁・生成の記録)。git で取り込んだ・手で書き換えた変更を、画面に知らせる
    if (["approvals.json", "review-comments.json", "access.json", "document-template.json", "generation.json"].includes(file)) return { event: "opsChanged", data: {} };
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

/** 監視するフォルダ (データフォルダからの相対。"" はデータフォルダ自身 = layout-components.json) */
const WATCH_DIRS = ["", ...DIR_EVENTS.map((d) => d.dir), "generic-definitions"];

interface Watching {
  dataRoot: string;
  /** 相対フォルダ → 監視 (フォルダごとに 1 つ。再帰の監視は、隠しフォルダ (.harmony-backups など) のファイルごとにも監視を作るので使わない) */
  dirs: Map<string, FSWatcher>;
  /** 監視を始めたときのフォルダの inode。フォルダが消えて作り直されると変わる (古い監視は、作り直されたフォルダを見ていない) */
  inodes: Map<string, number>;
  timer: NodeJS.Timeout | null;
  pending: Map<string, ChangeEvent>;
}

/** ワークスペースごとのファイル監視。画面が接続したワークスペースだけ、遅れて開始する */
export class ExternalChangeWatcher {
  private watching = new Map<string, Watching>();
  private starting = new Set<string>();
  /** 監視を始められなかったワークスペース → その時刻 (要求のたびに試し直さない) */
  private failedAt = new Map<string, number>();
  constructor(private readonly emit: (root: string, evs: ChangeEvent[], paths: string[]) => void) {}

  /** root (ワークスペース) の監視を始める (すでに始めていれば何もしない。失敗したら、しばらく試し直さない) */
  async ensure(root: string, now = Date.now()): Promise<void> {
    if (this.watching.has(root) || this.starting.has(root)) return;
    const failed = this.failedAt.get(root);
    if (failed !== undefined && now - failed < RETRY_AFTER_MS) return;
    this.starting.add(root);
    try {
      const dataRoot = await resolveDataRoot(root);
      const w: Watching = { dataRoot, dirs: new Map(), inodes: new Map(), timer: null, pending: new Map() };
      this.watching.set(root, w);
      this.syncDirs(root, w);
      if (w.dirs.size === 0) throw new Error("監視できるフォルダがありません");
      this.failedAt.delete(root);
      logInfo("external-change", "watch.start", { dataRoot: path.basename(dataRoot), dirs: w.dirs.size });
    } catch (e) {
      // harmony.json が無い・読めない・監視が使えない環境 (inotify の上限など)。1 回だけ警告して、しばらく試さない
      this.close(root);
      this.failedAt.set(root, now);
      logWarn("external-change", "watch.unavailable", { error: e instanceof Error ? e.message : String(e), retryAfterSec: RETRY_AFTER_MS / 1000 });
    } finally {
      this.starting.delete(root);
    }
  }

  /** 監視するフォルダのうち、まだ監視していないもの (あとから作られたフォルダ) を足す */
  private syncDirs(root: string, w: Watching, force: ReadonlySet<string> = new Set()): string[] {
    const watched: string[] = [];
    const rels = [...WATCH_DIRS];
    try {
      for (const e of readdirSync(path.join(w.dataRoot, "generic-definitions"), { withFileTypes: true })) {
        if (e.isDirectory() && !e.name.startsWith(".")) rels.push(`generic-definitions/${e.name}`);
      }
    } catch { /* generic-definitions が無い */ }
    for (const rel of rels) {
      const abs = rel ? path.join(w.dataRoot, ...rel.split("/")) : w.dataRoot;
      let ino: number;
      try { ino = statSync(abs).ino; } catch { // フォルダが無くなった: 監視を閉じる (作り直されたら、次の通知で張り直す)
        const gone = w.dirs.get(rel);
        if (gone) { try { gone.close(); } catch { /* ignore */ } w.dirs.delete(rel); w.inodes.delete(rel); }
        continue;
      }
      const cur = w.dirs.get(rel);
      // 同じ名前のフォルダが消えて作り直されると、inode が同じになることがある。親の通知でその名前が出たフォルダ (force) は、必ず張り直す
      if (cur && w.inodes.get(rel) === ino && !force.has(rel)) continue;
      if (cur) { try { cur.close(); } catch { /* ignore */ } w.dirs.delete(rel); } // 作り直されたフォルダ: 張り直す
      try {
        const fsw = watch(abs, { persistent: false }, (_type, name) => this.onEvent(root, w, rel, name));
        fsw.on("error", (e) => {
          logWarn("external-change", "watch.dir.error", { dir: rel, error: e.message });
          try { fsw.close(); } catch { /* ignore */ }
          if (w.dirs.get(rel) === fsw) { w.dirs.delete(rel); w.inodes.delete(rel); }
        });
        w.dirs.set(rel, fsw);
        w.inodes.set(rel, ino);
        watched.push(rel);
      } catch (e) {
        if (rel === "") throw e; // データフォルダ自身を監視できなければ、この環境では使えない
        logWarn("external-change", "watch.dir.failed", { dir: rel, error: e instanceof Error ? e.message : String(e) });
      }
    }
    return watched;
  }

  private onEvent(root: string, w: Watching, rel: string, name: string | Buffer | null): void {
    if (!name) return;
    const relPath = rel ? `${rel}/${name.toString()}` : name.toString();
    // フォルダが作られた・消えた (generic-definitions/<種類> など) 可能性: 監視を足す
    if (rel === "" || rel === "generic-definitions") {
      const child = rel ? `${rel}/${name.toString()}` : name.toString();
      const watched = this.syncDirs(root, w, new Set([child, ...(child === "generic-definitions" ? [...w.dirs.keys()].filter((k) => k.startsWith("generic-definitions/")) : [])]));
      // 張り直したフォルダ (消えて作り直された・あとから作られた) には、監視を張る前に書かれたファイルがある。その分は通知されないので、中身を見て補う
      for (const d of watched) this.announceExisting(root, w, d);
    }
    this.queue(root, w, relPath);
  }

  /** 張り直したフォルダの、いまあるファイルを、変化として知らせる (自分の書き込みを除く) */
  private announceExisting(root: string, w: Watching, rel: string): void {
    if (!rel || rel === "generic-definitions") return;
    let names: string[] = [];
    try { names = readdirSync(path.join(w.dataRoot, ...rel.split("/"))); } catch { return; }
    for (const name of names) this.queue(root, w, `${rel}/${name}`);
  }

  /** 変化したパスを溜めて、まとめて通知する (自分の書き込み・設計でないファイルは除く) */
  private queue(root: string, w: Watching, relPath: string): void {
    if (isSelfWritePath(path.join(w.dataRoot, ...relPath.split("/")))) return;
    const ev = classifyChangedPath(relPath);
    if (!ev) return;
    w.pending.set(relPath, ev);
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
  }

  close(root: string): void {
    const w = this.watching.get(root);
    if (!w) return;
    if (w.timer) clearTimeout(w.timer);
    for (const fsw of w.dirs.values()) { try { fsw.close(); } catch { /* ignore */ } }
    this.watching.delete(root);
  }

  /** 使われていない (どの画面もそのワークスペースを開いていない) ワークスペースの監視を止める */
  prune(isUsed: (root: string) => boolean): void {
    for (const root of [...this.watching.keys()]) if (!isUsed(root)) this.close(root);
  }

  closeAll(): void { for (const r of [...this.watching.keys()]) this.close(r); }
}
