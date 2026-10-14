/**
 * 監査ログ: 誰が・いつ・何を変えたかの、人が読める記録 (`<ワークスペース>/.harmony-ops/audit.jsonl`)。
 * 1 行 1 件の JSON。個人の記録として git には載せない。大きくなったら 1 世代だけ退避する (audit.1.jsonl)。
 * 利用者名は自己申告 (本人確認ではない)。AI (MCP) の操作は、actor を「AI」にする。書けなくても、元の操作は止めない。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { cleanActor } from "@harmony/shared";
import { ensureHiddenDir, opsDirOf } from "./opsFiles.js";
import { logWarn } from "../serverLog.js";

export interface AuditEntry { at: string; actor: string; action: string; target?: string; detail?: string; via?: "ui" | "ai" | "server" }
export const AUDIT_FILE = "audit.jsonl";
export const AUDIT_MAX_BYTES = 2 * 1024 * 1024;
const MAX_FIELD = 300;

const clip = (s: unknown): string | undefined => (typeof s === "string" && s ? s.replace(/[\r\n]+/g, " ").slice(0, MAX_FIELD) : undefined);

let queue: Promise<unknown> = Promise.resolve();
/** 追記する (順番を守る)。失敗しても例外にしない */
export function recordAudit(root: string, e: Omit<AuditEntry, "at"> & { at?: string }): Promise<void> {
  const entry: AuditEntry = { at: e.at ?? new Date().toISOString(), actor: cleanActor(e.actor) || "(名前なし)", action: clip(e.action) ?? "(不明)", ...(clip(e.target) ? { target: clip(e.target) } : {}), ...(clip(e.detail) ? { detail: clip(e.detail) } : {}), ...(e.via ? { via: e.via } : {}) };
  const run = async () => {
    try {
      const dir = await ensureHiddenDir(root);
      const file = path.join(dir, AUDIT_FILE);
      const st = await fs.stat(file).catch(() => null);
      if (st && st.size > AUDIT_MAX_BYTES) await fs.rename(file, path.join(dir, "audit.1.jsonl")).catch(() => undefined);
      await fs.appendFile(file, `${JSON.stringify(entry)}\n`, "utf-8");
    } catch (err) { logWarn("audit", "監査ログを書けませんでした", { error: err instanceof Error ? err.message : String(err) }); }
  };
  const p = queue.then(run, run);
  queue = p;
  return p;
}

/** 追記待ちが、すべて書き終わるまで待つ (試験・終了の前に使う) */
export const flushAudit = (): Promise<unknown> => queue.catch(() => undefined);

export interface AuditQuery { actor?: string; action?: string; q?: string; since?: string; until?: string; limit?: number }

export function parseAuditLines(text: string): AuditEntry[] {
  const out: AuditEntry[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const j = JSON.parse(line) as Partial<AuditEntry>;
      if (typeof j.at === "string" && typeof j.actor === "string" && typeof j.action === "string") out.push(j as AuditEntry);
    } catch { /* 壊れた行は飛ばす */ }
  }
  return out;
}

export function filterAudit(all: AuditEntry[], q: AuditQuery): AuditEntry[] {
  const needle = q.q?.trim().toLowerCase();
  return all.filter((e) => {
    if (q.actor && e.actor !== q.actor) return false;
    if (q.action && !e.action.includes(q.action)) return false;
    if (q.since && e.at < q.since) return false;
    if (q.until && e.at > q.until) return false;
    if (needle && !`${e.actor} ${e.action} ${e.target ?? ""} ${e.detail ?? ""}`.toLowerCase().includes(needle)) return false;
    return true;
  });
}

/** 新しい順。退避した 1 世代も読む */
export async function readAudit(root: string, q: AuditQuery = {}): Promise<{ entries: AuditEntry[]; actors: string[]; total: number }> {
  const dir = opsDirOf(root);
  const read = (f: string) => fs.readFile(path.join(dir, f), "utf-8").catch(() => "");
  const all = [...parseAuditLines(await read("audit.1.jsonl")), ...parseAuditLines(await read(AUDIT_FILE))];
  const matched = filterAudit(all, q).reverse();
  const limit = Math.min(Math.max(Math.floor(q.limit ?? 200), 1), 2000);
  return { entries: matched.slice(0, limit), actors: [...new Set(all.map((e) => e.actor))].sort(), total: matched.length };
}
