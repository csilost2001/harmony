/**
 * テスト観点表 (テスト仕様書の元) の導出。
 *
 * - 画面入力: 画面項目の制約 (必須・桁数・範囲・形式) から、正常・異常・境界値のケースを決まった規則で導く
 * - 処理: 処理フローの分岐と終了から導いた観点 (deriveTestViewpoints) に、決まった ID を付ける
 *
 * ID は画面 ID・項目 ID・規則の記号から決まるため、設計が変わらなければ同じ ID になる。
 * テストコード (Playwright 等) は、この表を入力にして AI または人が書く。仕様: docs/spec/test-viewpoints.md
 */
import { deriveTestViewpoints, type FlowActionLike } from "./flowStructure.js";

export type TestCategory = "正常系" | "異常系" | "境界値";

/** 画面入力のテストケース 1 件 */
export interface ScreenInputCase {
  /** `<画面 ID>.<項目 ID>.<規則>` */
  id: string;
  screenId: string;
  itemId: string;
  itemLabel: string;
  /** 規則の記号 (required-empty / max-length-over など) */
  rule: string;
  category: TestCategory;
  /** 観点 (何を確かめるか) */
  viewpoint: string;
  /** 入力する値の説明 */
  input: string;
  /** 入力する値 (そのまま使える値。説明だけで値が決まらないケースは省略) */
  value?: string | number | null;
  /** 期待結果 */
  expected: string;
  /** 期待するエラーメッセージ (項目の errorMessages にあれば) */
  expectedMessage?: string;
}

/** 処理のテストケース 1 件 */
export interface FlowTestCase {
  /** `<処理 ID>.<アクション ID>.TV-<連番>` */
  id: string;
  flowId: string;
  actionId: string;
  actionName?: string;
  category: "正常系" | "異常系";
  conditions: string[];
  expected: string;
  status?: number;
  stepNo: string;
}

export interface TestScreenLike {
  id: string;
  name?: string;
  items?: TestItemLike[];
}

export interface TestItemLike {
  id: string;
  label?: string;
  type?: unknown;
  direction?: string;
  required?: boolean;
  readonly?: boolean;
  disabled?: boolean;
  nonVisual?: boolean;
  formula?: string;
  minLength?: number;
  maxLength?: number;
  min?: number;
  max?: number;
  minLengthRef?: string;
  maxLengthRef?: string;
  minRef?: string;
  maxRef?: string;
  step?: number;
  pattern?: string;
  options?: Array<{ value: string; label: string }>;
  errorMessages?: Record<string, string>;
}

/** 規約カタログ (`@conv.limit.*` / `@conv.regex.*` / `@conv.msg.*`) の参照を解くための値 */
export interface TestContext {
  limits?: Record<string, { value?: number }>;
  regex?: Record<string, { pattern?: string; exampleValid?: string[]; exampleInvalid?: string[] }>;
  messages?: Record<string, { template?: string }>;
}

export interface TestFlowLike {
  meta: { id: string; name?: string };
  actions: Array<FlowActionLike & { id?: string; name?: string }>;
}

const isNumericType = (t: unknown): t is "number" | "integer" => t === "number" || t === "integer";
const isTextType = (t: unknown): boolean => t === undefined || t === "string";

/** 入力として扱う項目か (利用者が値を入れるもの) */
export function isInputItem(it: TestItemLike): boolean {
  if (it.nonVisual || it.readonly || it.disabled || it.formula) return false;
  if (it.direction === "out") return false;
  // 配列・表・オブジェクトなどは、1 つの値としては入力しない
  return typeof it.type === "string" || it.type === undefined;
}

const fill = (n: number): string => "a".repeat(Math.max(0, n));

const convKey = (ref: string | undefined, kind: string): string | undefined => {
  const m = ref?.match(new RegExp(`^@conv\\.${kind}\\.([A-Za-z0-9_-]+)$`));
  return m ? m[1] : undefined;
};

/** 項目の制約のうち、規約カタログの参照 (`maxRef` など) で書かれたものを値にする */
function resolveItem(it: TestItemLike, ctx: TestContext): { item: TestItemLike; validExample?: string; invalidExample?: string } {
  const num = (direct: number | undefined, ref: string | undefined): number | undefined => {
    if (direct !== undefined) return direct;
    const k = convKey(ref, "limit");
    const v = k ? ctx.limits?.[k]?.value : undefined;
    return typeof v === "number" ? v : undefined;
  };
  let pattern = it.pattern;
  let validExample: string | undefined;
  let invalidExample: string | undefined;
  const rk = convKey(pattern, "regex");
  if (rk) {
    const r = ctx.regex?.[rk];
    pattern = r?.pattern ?? pattern;
    validExample = r?.exampleValid?.[0];
    invalidExample = r?.exampleInvalid?.[0];
  }
  const errorMessages = it.errorMessages && Object.fromEntries(Object.entries(it.errorMessages).map(([k, v]) => {
    const mk = convKey(v, "msg");
    return [k, (mk && ctx.messages?.[mk]?.template) || v];
  }));
  return {
    item: { ...it, minLength: num(it.minLength, it.minLengthRef), maxLength: num(it.maxLength, it.maxLengthRef), min: num(it.min, it.minRef), max: num(it.max, it.maxRef), pattern, errorMessages },
    validExample, invalidExample,
  };
}

/** 1 つの画面項目から、入力のテストケースを導く */
export function deriveItemCases(screenId: string, src: TestItemLike, ctx: TestContext = {}): ScreenInputCase[] {
  if (!isInputItem(src)) return [];
  const { item: it, validExample, invalidExample } = resolveItem(src, ctx);
  const label = it.label || it.id;
  const out: ScreenInputCase[] = [];
  const msg = (key: string) => it.errorMessages?.[key];
  const add = (rule: string, category: TestCategory, viewpoint: string, input: string, expected: string, value?: string | number | null, messageKey?: string) => {
    const expectedMessage = messageKey ? msg(messageKey) : undefined;
    out.push({
      id: `${screenId}.${it.id}.${rule}`, screenId, itemId: it.id, itemLabel: label, rule, category, viewpoint, input, expected,
      ...(value !== undefined ? { value } : {}), ...(expectedMessage ? { expectedMessage } : {}),
    });
  };

  const text = isTextType(it.type);
  const numeric = isNumericType(it.type);

  if (it.options?.length) {
    add("option-valid", "正常系", "選択肢のどれかを選ぶ", `「${it.options[0].label}」を選ぶ`, "入力できる (エラーにならない)", it.options[0].value);
    if (it.required) add("required-empty", "異常系", "必須の項目を未選択のままにする", "未選択", "必須エラーになり、先へ進めない", "", "required");
    return out;
  }

  add("valid", "正常系", "有効な値を入力する", numeric ? "範囲内の値" : "制約を満たす値", "入力できる (エラーにならない)", validExample ?? sampleValid(it));

  if (it.required) {
    add("required-empty", "異常系", "必須の項目を空のままにする", "空", "必須エラーになり、先へ進めない", "", "required");
  } else {
    add("optional-empty", "正常系", "任意の項目を空のままにする", "空", "エラーにならない", "");
  }

  if (text) {
    if (it.maxLength !== undefined) {
      add("max-length-ok", "境界値", "最大桁数ちょうどを入力する", `${it.maxLength} 文字`, "入力できる", fill(it.maxLength));
      add("max-length-over", "境界値", "最大桁数を 1 文字超える", `${it.maxLength + 1} 文字`, "桁数エラーになる (または入力できない)", fill(it.maxLength + 1), "maxLength");
    }
    if (it.minLength !== undefined && it.minLength > 0) {
      add("min-length-ok", "境界値", "最小桁数ちょうどを入力する", `${it.minLength} 文字`, "入力できる", fill(it.minLength));
      add("min-length-under", "境界値", "最小桁数に 1 文字足りない", `${it.minLength - 1} 文字`, "桁数エラーになる", fill(it.minLength - 1), "minLength");
    }
    if (it.pattern) {
      add("pattern-invalid", "異常系", "形式に合わない値を入力する", invalidExample ? `形式に合わない値 (例: ${invalidExample})` : `形式 (${it.pattern}) に合わない値`, "形式エラーになる", invalidExample, "invalidFormat");
    }
  }

  if (numeric) {
    const step = it.step ?? (it.type === "integer" ? 1 : undefined);
    if (it.min !== undefined) {
      add("min-ok", "境界値", "最小値ちょうどを入力する", String(it.min), "入力できる", it.min);
      if (step !== undefined) add("min-under", "境界値", "最小値より 1 刻み小さい値を入力する", String(it.min - step), "範囲エラーになる", it.min - step, "outOfRange");
    }
    if (it.max !== undefined) {
      add("max-ok", "境界値", "最大値ちょうどを入力する", String(it.max), "入力できる", it.max);
      if (step !== undefined) add("max-over", "境界値", "最大値より 1 刻み大きい値を入力する", String(it.max + step), "範囲エラーになる", it.max + step, "outOfRange");
    }
    add("not-a-number", "異常系", "数値でない文字を入力する", "数字以外の文字 (例: abc)", "入力できない、または形式エラーになる", "abc", "invalidFormat");
    if (it.type === "integer") add("not-an-integer", "異常系", "整数でない値を入力する", "小数 (例: 1.5)", "入力できない、または形式エラーになる", 1.5, "invalidFormat");
  }
  return out;
}

/** 制約を満たす代表値 (テストの入力にそのまま使える) */
function sampleValid(it: TestItemLike): string | number | undefined {
  if (isNumericType(it.type)) {
    if (it.min !== undefined && it.max !== undefined) return it.type === "integer" ? Math.ceil((it.min + it.max) / 2) : (it.min + it.max) / 2;
    if (it.min !== undefined) return it.min;
    if (it.max !== undefined) return it.max;
    return 1;
  }
  if (isTextType(it.type) && !it.pattern) {
    const len = Math.max(it.minLength ?? 1, 1);
    return fill(it.maxLength !== undefined ? Math.min(len, it.maxLength) : len);
  }
  return undefined;
}

export function deriveScreenInputCases(screen: TestScreenLike, ctx: TestContext = {}): ScreenInputCase[] {
  return (screen.items ?? []).flatMap((it) => deriveItemCases(screen.id, it, ctx));
}

export function deriveFlowCases(flow: TestFlowLike): FlowTestCase[] {
  return flow.actions.flatMap((a, ai) => {
    const actionId = a.id ?? a.name ?? `action${ai + 1}`;
    return deriveTestViewpoints(a).map((v) => ({
      id: `${flow.meta.id}.${actionId}.TV-${String(v.no).padStart(2, "0")}`,
      flowId: flow.meta.id, actionId, ...(a.name ? { actionName: a.name } : {}),
      category: v.category, conditions: v.conditions, expected: v.expected, ...(v.status !== undefined ? { status: v.status } : {}), stepNo: v.stepNo,
    }));
  });
}

export interface TestViewpointSheet {
  screens: Array<{ screenId: string; screenName?: string; cases: ScreenInputCase[] }>;
  flows: Array<{ flowId: string; flowName?: string; cases: FlowTestCase[] }>;
  total: number;
}

/** プロジェクト全体のテスト観点表 */
export function deriveTestViewpointSheet(input: { screens: TestScreenLike[]; flows: TestFlowLike[] } & TestContext): TestViewpointSheet {
  const screens = input.screens.map((s) => ({ screenId: s.id, screenName: s.name, cases: deriveScreenInputCases(s, input) })).filter((s) => s.cases.length);
  const flows = input.flows.map((f) => ({ flowId: f.meta.id, flowName: f.meta.name, cases: deriveFlowCases(f) })).filter((f) => f.cases.length);
  const total = screens.reduce((n, s) => n + s.cases.length, 0) + flows.reduce((n, f) => n + f.cases.length, 0);
  return { screens, flows, total };
}

const csvCell = (v: unknown): string => {
  const s = v === undefined || v === null ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** CSV (Excel で開ける。BOM は呼び出し側で付ける)。画面入力と処理を 1 つの表にまとめる */
export function testViewpointSheetToCsv(sheet: TestViewpointSheet): string {
  const rows: unknown[][] = [["ID", "対象", "区分", "観点・条件", "入力・状況", "期待結果", "期待メッセージ", "入力値"]];
  for (const s of sheet.screens) for (const c of s.cases) {
    rows.push([c.id, `画面 ${s.screenName ?? s.screenId} / ${c.itemLabel}`, c.category, c.viewpoint, c.input, c.expected, c.expectedMessage, c.value]);
  }
  for (const f of sheet.flows) for (const c of f.cases) {
    rows.push([c.id, `処理 ${f.flowName ?? f.flowId}${c.actionName ? ` / ${c.actionName}` : ""}`, c.category, c.conditions.join(" かつ "), "", c.expected, "", ""]);
  }
  return rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
