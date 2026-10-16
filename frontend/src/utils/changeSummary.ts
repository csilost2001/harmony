/**
 * 元に戻す・やり直しで「何が変わったか」を、短い日本語にする (UI 改善提案 第 5 弾 #86)。画面に依存しない純関数。
 * 2 つの JSON の差から、配列の追加・削除と、値の変更を拾い、「カラム『金額』の追加」のように言う。
 * 完全な差分ではなく、いちばん目立つ変更を 1 つ + 件数で知らせるための要約。
 */
export interface Change {
  path: Array<string | number>;
  kind: "add" | "remove" | "change";
  /** 追加・削除された要素、または変更された値 (変更の前 / 後) */
  before?: unknown;
  after?: unknown;
}

/** 配列の名前 → 要素の呼び名 */
const COLLECTION_LABELS: Record<string, string> = {
  columns: "カラム", steps: "工程", items: "項目", fields: "項目", lanes: "レーン", actions: "アクション", constraints: "制約",
  indexes: "インデックス", sections: "部", nodes: "部品", children: "部品", options: "選択肢", markers: "マーカー", inputs: "入力",
  outputs: "出力", responses: "応答", edges: "遷移", screens: "画面", rules: "ルール", events: "イベント", operations: "操作",
  relations: "関係", triggers: "トリガー", regions: "領域", params: "差し込み口", tables: "テーブル", joins: "結合", fileRefs: "ファイル",
};

/** 値の項目名 → 呼び名 */
const FIELD_LABELS: Record<string, string> = {
  name: "名前", label: "表示名", physicalName: "物理名", dataType: "データ型", type: "型", required: "必須", description: "説明",
  length: "長さ", scale: "スケール", notNull: "NOT NULL", primaryKey: "主キー", unique: "ユニーク", defaultValue: "既定値", comment: "備考",
  title: "表題", text: "文言", kind: "種類", direction: "入出力", readonly: "読み取り専用", pattern: "入力書式", placeholder: "入力例",
  minLength: "最小桁", maxLength: "最大桁", min: "最小値", max: "最大値", sql: "SQL", condition: "条件", note: "メモ", path: "パス", span: "幅",
  purpose: "目的", summary: "概要", columns: "列数", variant: "強調", align: "配置", body: "本文", resolution: "解決の内容", id: "ID",
};

const NAME_KEYS = ["physicalName", "name", "label", "title", "text", "summary", "id"];

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (Array.isArray(a)) return Array.isArray(b) && a.length === b.length && a.every((x, i) => deepEqual(x, b[i]));
  if (isObj(a) && isObj(b)) {
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    return ka.length === kb.length && ka.every((k) => k in b && deepEqual(a[k], b[k]));
  }
  return false;
}

/** 2 つの値の差を、配列の追加・削除と、値の変更として集める (上限あり) */
export function collectChanges(before: unknown, after: unknown, path: Array<string | number> = [], out: Change[] = [], limit = 50): Change[] {
  if (out.length >= limit || deepEqual(before, after)) return out;
  if (Array.isArray(before) && Array.isArray(after)) {
    if (before.length !== after.length) {
      const longer = after.length > before.length;
      const [big, small] = longer ? [after, before] : [before, after];
      const extra = big.map((v, i) => ({ v, i })).filter(({ v }) => !small.some((s) => deepEqual(s, v)));
      // 並べ替え (同じ要素で、長さだけが違うことはない) と、追加・削除の見分け: 要素が見つからないものを、追加 / 削除とする
      for (const { v, i } of extra.slice(0, Math.abs(big.length - small.length) + 3)) {
        if (out.length >= limit) break;
        out.push(longer ? { path: [...path, i], kind: "add", after: v } : { path: [...path, i], kind: "remove", before: v });
      }
      if (extra.length === 0) out.push({ path, kind: "change", before, after });
      return out;
    }
    before.forEach((b, i) => collectChanges(b, after[i], [...path, i], out, limit));
    return out;
  }
  if (isObj(before) && isObj(after)) {
    for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) {
      if (k in before && !(k in after)) { if (!deepEqual(before[k], undefined)) out.push({ path: [...path, k], kind: "remove", before: before[k] }); }
      else if (!(k in before) && k in after) out.push({ path: [...path, k], kind: "add", after: after[k] });
      else collectChanges(before[k], after[k], [...path, k], out, limit);
    }
    return out;
  }
  out.push({ path, kind: "change", before, after });
  return out;
}

const short = (v: unknown, n = 16): string => {
  const s = typeof v === "string" ? v : JSON.stringify(v) ?? "";
  return s.length > n ? `${s.slice(0, n)}…` : s;
};

function nameOf(v: unknown): string {
  if (!isObj(v)) return "";
  for (const k of NAME_KEYS) { const x = v[k]; if (typeof x === "string" && x) return short(x, 18); }
  return "";
}

/** 値をたどる */
function at(root: unknown, path: ReadonlyArray<string | number>): unknown {
  let cur = root;
  for (const p of path) { if (cur === null || cur === undefined) return undefined; cur = (cur as Record<string | number, unknown>)[p]; }
  return cur;
}

/** 配列の要素を指す path から、「カラム『金額』」のような呼び名を作る (直近の配列の名前を使う) */
function describeElement(root: unknown, path: ReadonlyArray<string | number>, fallbackValue?: unknown): string {
  for (let i = path.length - 1; i >= 0; i--) {
    if (typeof path[i] !== "number") continue;
    const coll = String(path[i - 1] ?? "");
    const label = COLLECTION_LABELS[coll] ?? "";
    const el = i === path.length - 1 && fallbackValue !== undefined ? fallbackValue : at(root, path.slice(0, i + 1));
    const name = nameOf(el);
    if (label) return name ? `${label}『${name}』` : label;
    if (name) return `『${name}』`;
  }
  return "";
}

/** 変更の説明 (1 件)。before / after は、変更前・変更後の全体 */
export function describeOne(c: Change, beforeRoot: unknown, afterRoot: unknown): string {
  const last = c.path[c.path.length - 1];
  if (c.kind === "add" || c.kind === "remove") {
    const root = c.kind === "add" ? afterRoot : beforeRoot;
    const value = c.kind === "add" ? c.after : c.before;
    if (typeof last === "number") return `${describeElement(root, c.path, value) || "要素"}の${c.kind === "add" ? "追加" : "削除"}`;
    const field = FIELD_LABELS[String(last)] ?? String(last);
    const owner = describeElement(root, c.path.slice(0, -1));
    return `${owner ? `${owner}の` : ""}${field}${c.kind === "add" ? "の設定" : "の解除"}`;
  }
  const field = typeof last === "string" ? (FIELD_LABELS[last] ?? last) : "";
  const owner = describeElement(afterRoot, typeof last === "number" ? c.path : c.path.slice(0, -1));
  if (isObj(c.before) || Array.isArray(c.before) || isObj(c.after) || Array.isArray(c.after)) return `${owner || field || "内容"}の変更`;
  const arrow = ` (${short(c.before, 12) || "空"} → ${short(c.after, 12) || "空"})`;
  return `${owner ? `${owner}の` : ""}${field || "値"}の変更${arrow}`;
}

/** 2 つの状態の差を、1 行で言う。差が無ければ「内容の変更」 */
export function describeChange(before: unknown, after: unknown): string {
  const changes = collectChanges(before, after);
  if (changes.length === 0) return "内容の変更";
  const first = describeOne(changes[0], before, after);
  return changes.length === 1 ? first : `${first} ほか ${changes.length - 1} か所`;
}
