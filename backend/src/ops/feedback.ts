/**
 * AI が資料・スキーマ・tool の説明で詰まった点の記録 (designer__report_confusion)。
 * 個人・環境の記録なので、`<ワークスペース>/.harmony-ops/ai-feedback.json` (git に載せない)。集計は `npm run ai:feedback -- <ワークスペース>`。
 * 記録は 500 件まで (古いものから捨てる)。1 件の文字数にも上限がある。
 */
import { makeOpsStore } from "./opsFiles.js";

export interface ConfusionEntry {
  id: string;
  at: string;
  /** 何で詰まったか (短い見出し)。例: 「edit_steps の add の detail の書き方」 */
  topic: string;
  detail?: string;
  /** 関係する tool の名前 (designer__ は省略可) */
  tool?: string;
  /** 関係する資料 (Resource の URI か、ファイルのパス) */
  doc?: string;
  /** 本当はどうなっていてほしかったか */
  expected?: string;
}
export interface ConfusionFile { entries: ConfusionEntry[] }

export const MAX_CONFUSIONS = 500;
export const LIMITS = { topic: 200, detail: 2000, tool: 100, doc: 300, expected: 1000 } as const;

const str = (v: unknown, max: number): string | undefined => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined);

export function parseConfusions(raw: unknown): { value: ConfusionFile; problems: string[] } {
  const problems: string[] = [];
  const list = raw && typeof raw === "object" && Array.isArray((raw as { entries?: unknown }).entries) ? (raw as { entries: unknown[] }).entries : [];
  const entries: ConfusionEntry[] = [];
  list.forEach((e, i) => {
    const o = e as Record<string, unknown> | null;
    const topic = str(o?.topic, LIMITS.topic), id = str(o?.id, 80), at = str(o?.at, 40);
    if (!o || !topic || !id || !at) { problems.push(`entries[${i}] は、id / at / topic が必要です (この項目は捨てます)`); return; }
    entries.push({ id, at, topic, ...(str(o.detail, LIMITS.detail) ? { detail: str(o.detail, LIMITS.detail) } : {}), ...(str(o.tool, LIMITS.tool) ? { tool: str(o.tool, LIMITS.tool) } : {}), ...(str(o.doc, LIMITS.doc) ? { doc: str(o.doc, LIMITS.doc) } : {}), ...(str(o.expected, LIMITS.expected) ? { expected: str(o.expected, LIMITS.expected) } : {}) });
  });
  return { value: { entries: entries.slice(-MAX_CONFUSIONS) }, problems };
}

export const confusionStore = makeOpsStore<ConfusionFile>({ file: "ai-feedback.json", scope: "hidden", parse: parseConfusions, empty: () => ({ entries: [] }) });
