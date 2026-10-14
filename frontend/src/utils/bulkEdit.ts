/**
 * 一括編集の計画 (純関数)。選んだ行 (カラム・画面項目) に、同じ値をまとめて設定する。
 * 画面 (BulkEditDialog) はここで計算した「どの行の何がどう変わるか」を予行として見せ、確定したら反映する。
 * 原本は書き換えない (確定は、編集中の内容への変更で、保存するまで残らない。Ctrl+Z で戻せる)。
 */
export type BulkFieldKind = "select" | "tri" | "number" | "text";

export interface BulkField<T> {
  key: string;
  label: string;
  kind: BulkFieldKind;
  /** select の選択肢 */
  options?: ReadonlyArray<{ value: string; label: string }>;
  /** この行にこの項目を設定してよいか (理由を返すと、その行は飛ばし、理由を見せる)。省略時は設定できる。
   *  `item` は、先に決まった変更 (一覧で前にある項目) を反映した後の行 (例: データ型も変えるなら、新しいデータ型で判定する) */
  applicable?: (item: T) => string | null;
  /** 設定する値の確認。誤りなら、利用者向けの理由を返す (その項目は反映しない) */
  validate?: (value: unknown) => string | null;
}

/** 利用者が選んだ変更。value が undefined = その項目を空にする (値を消す) */
export interface BulkChange { key: string; value: unknown }

export interface BulkRowPlan {
  /** 渡した items の位置 */
  index: number;
  /** 反映する値 (undefined = 消す) */
  patch: Record<string, unknown>;
  /** 反映前の値 */
  before: Record<string, unknown>;
  /** 設定できなかった項目と理由 */
  skipped: Array<{ key: string; reason: string }>;
}

export interface BulkPlan {
  rows: BulkRowPlan[];
  /** 実際に値が変わる行の数 */
  changedRows: number;
  /** 変更の値そのものが誤り (どの行にも反映しない) */
  invalid: Array<{ key: string; reason: string }>;
}

const same = (a: unknown, b: unknown) => (a ?? undefined) === (b ?? undefined);

export function planBulkEdit<T extends object>(items: readonly T[], fields: ReadonlyArray<BulkField<T>>, changes: readonly BulkChange[]): BulkPlan {
  const byKey = new Map(fields.map((f) => [f.key, f]));
  const invalid: BulkPlan["invalid"] = [];
  const valid: BulkChange[] = [];
  for (const c of changes) {
    const f = byKey.get(c.key);
    if (!f) continue;
    const notNumber = f.kind === "number" && c.value !== undefined && !(typeof c.value === "number" && Number.isFinite(c.value));
    const reason = c.value === undefined ? null : notNumber ? "数値を入力してください" : f.validate?.(c.value) ?? null;
    if (reason) invalid.push({ key: c.key, reason }); else valid.push(c);
  }
  const rows: BulkRowPlan[] = [];
  items.forEach((item, index) => {
    const rec = item as Record<string, unknown>;
    const patch: Record<string, unknown> = {};
    const before: Record<string, unknown> = {};
    const skipped: BulkRowPlan["skipped"] = [];
    for (const c of valid) {
      const f = byKey.get(c.key)!;
      const why = f.applicable?.({ ...rec, ...patch } as T) ?? null;
      if (why) { skipped.push({ key: c.key, reason: why }); continue; }
      if (same(rec[c.key], c.value)) continue; // すでにその値
      patch[c.key] = c.value;
      before[c.key] = rec[c.key];
    }
    rows.push({ index, patch, before, skipped });
  });
  return { rows, changedRows: rows.filter((r) => Object.keys(r.patch).length > 0).length, invalid };
}

/** 計画を 1 行に反映する (undefined の値は、キーごと消す)。渡した行を直接書き換える */
export function applyBulkPatch<T extends object>(item: T, patch: Record<string, unknown>): void {
  const rec = item as Record<string, unknown>;
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) delete rec[k]; else rec[k] = v;
  }
}
