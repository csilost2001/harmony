/**
 * 設計の本文検索。クイックオープン (Ctrl+K) が、名前・ID に合わないときでも「説明・カラム名・項目のラベル・工程の説明」
 * などの本文から探せるようにする。画面・テーブル・処理フロー・業務フロー・帳票を、設計書・検査と同じ入力 (loadDesignInputFromRoot。データが変わらないあいだは使い回す) から、文字列を走査する (書き込まない)。
 */
import { loadDesignInputFromRoot } from "./designInput.js";

export type SearchKind = "screen" | "table" | "process-flow" | "business-flow" | "report";

export interface SearchMatch {
  /** どこに合ったか (例: 「カラム order_id」「工程 step-03」) */
  where: string;
  /** 合った文字列 (長いときは合った部分の前後) */
  text: string;
}
export interface SearchHit {
  kind: SearchKind;
  id: string;
  name: string;
  matches: SearchMatch[];
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** 全角半角・大文字小文字・ひらがな / カタカナの差を無視する (フロントのクイックオープンと同じ) */
export function normalizeForSearch(s: string): string {
  return s.normalize("NFKC").toLowerCase().replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
}

/** 本文として探す項目名 */
const TEXT_KEYS = new Set([
  "name", "label", "description", "comment", "physicalName", "conditions", "title", "path", "message", "note", "text", "purpose",
  "condition", "expression", "sql", "defaultValue", "placeholder", "helperText",
]);
/** 配列の見出し (「カラム order_id」のように、どの要素かを示す) */
const ARRAY_LABELS: Record<string, string> = {
  columns: "カラム", items: "項目", actions: "アクション", steps: "工程", subSteps: "工程", branches: "分岐", fields: "項目",
  constraints: "制約", indexes: "インデックス", lanes: "レーン", rules: "ルール", inputs: "入力", outputs: "出力", sections: "区画", notes: "付箋",
};
const MAX_MATCHES_PER_ENTITY = 3;

function snippet(text: string, normText: string, firstToken: string): string {
  const flat = text.replace(/\s+/g, " ");
  if (flat.length <= 80) return flat;
  const at = Math.max(0, normText.indexOf(firstToken));
  const start = Math.max(0, at - 20);
  return `${start > 0 ? "…" : ""}${flat.slice(start, start + 80)}${start + 80 < flat.length ? "…" : ""}`;
}

/** エンティティ 1 件を走査して、全語が (名前以外の) 1 つの文字列に合う場所を集める */
function scan(entity: unknown, tokens: string[]): SearchMatch[] {
  const out: SearchMatch[] = [];
  const walk = (v: unknown, where: string): void => {
    if (out.length >= MAX_MATCHES_PER_ENTITY) return;
    if (Array.isArray(v)) { v.forEach((x) => walk(x, where)); return; }
    if (!isRecord(v)) return;
    // この要素の呼び名 (「カラム order_id」)
    const ident = (typeof v.physicalName === "string" && v.physicalName) || (typeof v.id === "string" && v.id) || (typeof v.name === "string" && v.name) || "";
    for (const [k, x] of Object.entries(v)) {
      if (out.length >= MAX_MATCHES_PER_ENTITY) return;
      if (typeof x === "string") {
        if (!TEXT_KEYS.has(k) || !x) continue;
        if (!where && k === "name") continue; // 設計そのものの名前は、名前検索の側で拾う
        const norm = normalizeForSearch(x);
        if (tokens.every((t) => norm.includes(t))) out.push({ where: where || "全体", text: snippet(x, norm, tokens[0]) });
      } else if (Array.isArray(x) || isRecord(x)) {
        const label = ARRAY_LABELS[k];
        const next = label ? `${label}${Array.isArray(x) ? "" : ` ${ident}`}` : where || (ident ? ident : "");
        if (Array.isArray(x) && label) {
          // 配列の各要素は、要素の識別子つきで
          for (const el of x) {
            if (isRecord(el)) {
              const id = (typeof el.physicalName === "string" && el.physicalName) || (typeof el.id === "string" && el.id) || (typeof el.name === "string" && el.name) || "";
              walk(el, `${label}${id ? ` ${id}` : ""}`);
            } else walk(el, next);
          }
        } else walk(x, next);
      }
    }
  };
  walk(entity, "");
  return out;
}

/** 名前・ID に合うものは、(クイックオープン側の) 名前検索が拾うので、本文の一致だけを返す */
export async function searchDesign(root: string, query: string, limit = 30): Promise<SearchHit[]> {
  const tokens = normalizeForSearch(query).split(/\s+/).filter(Boolean);
  if (tokens.length === 0 || tokens.join("").length < 2) return [];
  const hits: SearchHit[] = [];
  const push = (kind: SearchKind, id: string, name: string, entity: unknown) => {
    if (hits.length >= limit) return;
    const matches = scan(entity, tokens);
    if (matches.length > 0) hits.push({ kind, id, name: name || id, matches });
  };

  // 設計書・検査と同じ入力 (データが変わらないあいだは使い回す) から探す。ファイルを読み直さない
  const { input } = await loadDesignInputFromRoot(root);
  for (const e of input.screens as unknown as unknown[]) {
    if (isRecord(e) && typeof e.id === "string") push("screen", e.id, typeof e.name === "string" ? e.name : e.id, e);
  }
  for (const t of input.tables as unknown as unknown[]) {
    if (isRecord(t) && typeof t.id === "string") push("table", t.id, typeof t.name === "string" ? t.name : t.id, t);
  }
  for (const f of input.flows as unknown as unknown[]) {
    const meta = isRecord(f) && isRecord(f.meta) ? f.meta : null;
    if (meta && typeof meta.id === "string") push("process-flow", meta.id, typeof meta.name === "string" ? meta.name : meta.id, f);
  }
  for (const b of (input.businessFlows ?? []) as unknown as unknown[]) {
    if (isRecord(b) && typeof b.id === "string") push("business-flow", b.id, typeof b.name === "string" ? b.name : b.id, b);
  }
  for (const r of (input.reports ?? []) as unknown as unknown[]) {
    if (isRecord(r) && typeof r.id === "string") push("report", r.id, typeof r.name === "string" ? r.name : r.id, r);
  }
  return hits;
}
