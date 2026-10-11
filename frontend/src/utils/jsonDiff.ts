/**
 * 保存前の設計 (JSON) と、いまの編集中の内容の差を、人が読める形で出す。
 * - 配列の要素に文字列の `id` があれば、id で対応づける (行の挿入・削除で、ずれた比較にならない)
 * - id が無い配列は位置で比べる
 * - 更新日時 (updatedAt) の差は無視する (保存のときに付くもので、利用者の変更ではない)
 */
export type ChangeKind = "added" | "removed" | "changed" | "reordered";

export interface DiffSegment {
  /** オブジェクトのキー、または配列の要素 (id があれば id) */
  key: string;
  /** 要素の呼び名 (名前・ラベル・説明など) */
  label?: string;
  isElement?: boolean;
}

export interface Change {
  path: DiffSegment[];
  kind: ChangeKind;
  before?: unknown;
  after?: unknown;
}

const IGNORED_KEYS = new Set(["updatedAt"]);
const NAME_KEYS = ["name", "label", "physicalName", "description", "title", "id"];

const isPlain = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

function elementLabel(v: unknown): string | undefined {
  if (!isPlain(v)) return undefined;
  for (const k of NAME_KEYS) {
    const x = v[k];
    if (typeof x === "string" && x.trim()) return x.length > 24 ? `${x.slice(0, 24)}…` : x;
  }
  return undefined;
}

const hasUniqueIds = (arr: unknown[]): arr is Array<Record<string, unknown> & { id: string }> => {
  if (!arr.every((e) => isPlain(e) && typeof e.id === "string")) return false;
  return new Set(arr.map((e) => (e as { id: string }).id)).size === arr.length;
};

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => deepEqual(x, b[i]));
  const ka = Object.keys(a as object).filter((k) => !IGNORED_KEYS.has(k));
  const kb = Object.keys(b as object).filter((k) => !IGNORED_KEYS.has(k));
  if (ka.length !== kb.length) return false;
  return ka.every((k) => deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

export function diffJson(before: unknown, after: unknown): Change[] {
  const out: Change[] = [];
  walk(before, after, [], out);
  return out;
}

function walk(a: unknown, b: unknown, path: DiffSegment[], out: Change[]): void {
  if (deepEqual(a, b)) return;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (hasUniqueIds(a) && hasUniqueIds(b)) {
      const bById = new Map(b.map((e) => [e.id, e]));
      const aById = new Map(a.map((e) => [e.id, e]));
      for (const e of a) if (!bById.has(e.id)) out.push({ path: [...path, { key: e.id, label: elementLabel(e), isElement: true }], kind: "removed", before: e });
      for (const e of b) if (!aById.has(e.id)) out.push({ path: [...path, { key: e.id, label: elementLabel(e), isElement: true }], kind: "added", after: e });
      for (const e of b) {
        const old = aById.get(e.id);
        if (old) walk(old, e, [...path, { key: e.id, label: elementLabel(old) ?? elementLabel(e), isElement: true }], out);
      }
      const common = (arr: Array<{ id: string }>, other: Map<string, unknown>) => arr.filter((e) => other.has(e.id)).map((e) => e.id);
      const ca = common(a, bById);
      const cb = common(b, aById);
      if (ca.some((id, i) => id !== cb[i])) out.push({ path, kind: "reordered", before: ca, after: cb });
      return;
    }
    const n = Math.max(a.length, b.length);
    for (let i = 0; i < n; i++) {
      const seg: DiffSegment = { key: String(i + 1), label: elementLabel(b[i]) ?? elementLabel(a[i]), isElement: true };
      if (i >= a.length) out.push({ path: [...path, seg], kind: "added", after: b[i] });
      else if (i >= b.length) out.push({ path: [...path, seg], kind: "removed", before: a[i] });
      else walk(a[i], b[i], [...path, seg], out);
    }
    return;
  }
  if (isPlain(a) && isPlain(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)].filter((k) => !IGNORED_KEYS.has(k)));
    for (const k of keys) {
      const inA = k in a && a[k] !== undefined;
      const inB = k in b && b[k] !== undefined;
      if (inA && !inB) out.push({ path: [...path, { key: k }], kind: "removed", before: a[k] });
      else if (!inA && inB) out.push({ path: [...path, { key: k }], kind: "added", after: b[k] });
      else walk(a[k], b[k], [...path, { key: k }], out);
    }
    return;
  }
  out.push({ path, kind: "changed", before: a, after: b });
}

const KEY_LABELS: Record<string, string> = {
  name: "表示名", label: "ラベル", description: "説明", physicalName: "物理名", dataType: "データ型", length: "長さ", scale: "スケール",
  notNull: "NOT NULL", primaryKey: "主キー", unique: "ユニーク", autoIncrement: "自動採番", defaultValue: "デフォルト値", comment: "備考",
  columns: "カラム", constraints: "制約", indexes: "インデックス", items: "項目", actions: "アクション", steps: "工程", kind: "種類",
  type: "型", required: "必須", direction: "方向", pattern: "パターン", maturity: "成熟度", category: "分類", tableId: "テーブル",
  operation: "操作", trigger: "契機", meta: "基本情報", notes: "付箋", markers: "マーカー", authoring: "作成メモ", inputs: "入力", outputs: "出力",
  minLength: "最小長", maxLength: "最大長", conditions: "条件", runIf: "実行条件", targetScreenId: "遷移先画面", screenId: "画面",
};

export function keyLabel(key: string): string {
  return KEY_LABELS[key] ?? key;
}

/** 変更の場所を「カラム › 注文ID › 表示名」のように文字にする */
export function describePath(path: DiffSegment[]): string {
  if (path.length === 0) return "全体";
  return path.map((s) => (s.isElement ? (s.label && s.label !== s.key ? `${s.label} (${s.key})` : s.key) : keyLabel(s.key))).join(" › ");
}

/** 値を 1 行の文字にする (長いものは切る) */
export function formatValue(v: unknown, max = 80): string {
  let s: string;
  if (v === undefined) s = "(なし)";
  else if (v === null) s = "null";
  else if (typeof v === "string") s = v === "" ? "(空)" : v;
  else if (typeof v === "object") {
    if (Array.isArray(v)) s = `[${v.length} 件]`;
    else {
      const label = elementLabel(v);
      s = label ? `{${label} …}` : `{${Object.keys(v).length} 項目}`;
    }
  } else s = String(v);
  s = s.replace(/\s*\n\s*/g, " ↵ ");
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

export function summarizeChanges(changes: readonly Change[]): { added: number; removed: number; changed: number; reordered: number } {
  const n = { added: 0, removed: 0, changed: 0, reordered: 0 };
  for (const c of changes) n[c.kind]++;
  return n;
}
