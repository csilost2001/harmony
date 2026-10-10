import { describe, expect, it } from "vitest";
import { buildDesignDocument, deriveFlowCases, deriveItemCases, deriveScreenInputCases, deriveTestViewpointSheet, isInputItem, testViewpointSheetToCsv } from "@harmony/shared";

const rules = (cases: Array<{ rule: string }>) => cases.map((c) => c.rule);

describe("画面入力のテスト観点", () => {
  it("必須・文字数の制約から、正常・異常・境界値のケースが決まった ID で出る", () => {
    const cases = deriveItemCases("cart", { id: "code", label: "商品コード", type: "string", required: true, minLength: 3, maxLength: 5, errorMessages: { required: "必須です", maxLength: "長すぎます" } });
    expect(rules(cases)).toEqual(["valid", "required-empty", "max-length-ok", "max-length-over", "min-length-ok", "min-length-under"]);
    const over = cases.find((c) => c.rule === "max-length-over")!;
    expect(over).toMatchObject({ id: "cart.code.max-length-over", category: "境界値", value: "aaaaaa", expectedMessage: "長すぎます" });
    expect(cases.find((c) => c.rule === "min-length-under")!.value).toBe("aa");
    expect(cases.find((c) => c.rule === "required-empty")!.expectedMessage).toBe("必須です");
    expect(cases.find((c) => c.rule === "valid")!.value).toBe("aaa");
  });

  it("任意の項目は、空でもエラーにならないケースになる", () => {
    expect(rules(deriveItemCases("s", { id: "memo", type: "string" }))).toEqual(["valid", "optional-empty"]);
  });

  it("整数は最小・最大の境界 (1 刻み) と、数値でない値・小数のケースが出る", () => {
    const cases = deriveItemCases("s", { id: "qty", label: "数量", type: "integer", required: true, min: 1, max: 99 });
    expect(rules(cases)).toEqual(["valid", "required-empty", "min-ok", "min-under", "max-ok", "max-over", "not-a-number", "not-an-integer"]);
    expect(cases.find((c) => c.rule === "min-under")!.value).toBe(0);
    expect(cases.find((c) => c.rule === "max-over")!.value).toBe(100);
    expect(cases.find((c) => c.rule === "valid")!.value).toBe(50);
  });

  it("小数 (number) は刻みが無ければ、範囲外の値は出さずに範囲内の境界だけを出す", () => {
    expect(rules(deriveItemCases("s", { id: "rate", type: "number", min: 0, max: 1 }))).toEqual(["valid", "optional-empty", "min-ok", "max-ok", "not-a-number"]);
    expect(rules(deriveItemCases("s", { id: "rate", type: "number", min: 0, max: 1, step: 0.1 }))).toContain("max-over");
  });

  it("形式 (pattern) があれば、合わない値のケースが出る", () => {
    expect(rules(deriveItemCases("s", { id: "zip", type: "string", pattern: "^\\d{7}$" }))).toEqual(["valid", "optional-empty", "pattern-invalid"]);
  });

  it("規約カタログの参照 (@conv.limit / @conv.regex / @conv.msg) を解き、正規表現の例をテスト値にする", () => {
    const ctx = {
      limits: { maxQty: { value: 999 }, codeLen: { value: 20 } },
      regex: { productCode: { pattern: "^P-[0-9]{4,6}$", exampleValid: ["P-0001"], exampleInvalid: ["0001"] } },
      messages: { required: { template: "必須です" } },
    };
    const q = deriveItemCases("s", { id: "qty", type: "integer", min: 1, maxRef: "@conv.limit.maxQty", errorMessages: { outOfRange: "@conv.msg.required" } }, ctx);
    expect(q.find((c) => c.rule === "max-over")).toMatchObject({ value: 1000, expectedMessage: "必須です" });
    const c = deriveItemCases("s", { id: "code", type: "string", pattern: "@conv.regex.productCode", maxLengthRef: "@conv.limit.codeLen" }, ctx);
    expect(c.find((x) => x.rule === "valid")!.value).toBe("P-0001");
    expect(c.find((x) => x.rule === "pattern-invalid")).toMatchObject({ value: "0001", input: "形式に合わない値 (例: 0001)" });
    expect(c.find((x) => x.rule === "max-length-over")!.value).toBe("a".repeat(21));
    // 参照が解けないときは、その制約のケースを出さない
    expect(rules(deriveItemCases("s", { id: "n", type: "integer", maxRef: "@conv.limit.nothing" }))).not.toContain("max-ok");
  });

  it("選択肢のある項目は、選択肢の選択と (必須なら) 未選択のケースになる", () => {
    const cases = deriveItemCases("s", { id: "kind", type: "string", required: true, options: [{ value: "a", label: "A" }, { value: "b", label: "B" }] });
    expect(rules(cases)).toEqual(["option-valid", "required-empty"]);
    expect(cases[0].value).toBe("a");
  });

  it("入力でない項目 (表示専用・読み取り専用・画面に表示しない・計算式・配列) は対象外", () => {
    for (const it of [{ id: "a", direction: "out" }, { id: "b", readonly: true }, { id: "c", nonVisual: true }, { id: "d", formula: "=1" }, { id: "e", disabled: true }, { id: "f", type: { kind: "array", itemType: "string" } }]) {
      expect(isInputItem(it as never), it.id).toBe(false);
      expect(deriveItemCases("s", it as never)).toEqual([]);
    }
  });

  it("画面ごとに項目順で並び、同じ入力からは同じ結果になる", () => {
    const screen = { id: "s", items: [{ id: "a", type: "string", required: true }, { id: "b", type: "integer", min: 0 }] };
    const a = deriveScreenInputCases(screen);
    expect(a.map((c) => c.itemId)).toEqual([...new Set(a.map((c) => c.itemId))].flatMap((id) => a.filter((c) => c.itemId === id).map(() => id)));
    expect(JSON.stringify(deriveScreenInputCases(screen))).toBe(JSON.stringify(a));
    expect(new Set(a.map((c) => c.id)).size).toBe(a.length);
  });
});

describe("処理のテスト観点と観点表", () => {
  const flow = {
    meta: { id: "order-confirm", name: "注文確定" },
    actions: [{ id: "confirm", name: "確定", steps: [
      { id: "s1", kind: "validation", rules: [] },
      { id: "s2", kind: "return", responseRef: "201" },
    ] }],
  };

  it("処理の観点に、処理 ID・アクション ID・連番の ID が付く", () => {
    const cases = deriveFlowCases(flow as never);
    expect(cases.length).toBeGreaterThan(0);
    expect(cases[0].id).toBe("order-confirm.confirm.TV-01");
    expect(cases.every((c) => c.flowId === "order-confirm" && c.actionId === "confirm")).toBe(true);
  });

  it("観点表にまとめ、CSV にできる (引用符・カンマ・改行を含む値も壊れない)", () => {
    const sheet = deriveTestViewpointSheet({ screens: [{ id: "cart", name: "カート", items: [{ id: "note", label: "備考, 任意", type: "string", maxLength: 10 }] }], flows: [flow as never] });
    expect(sheet.total).toBe(sheet.screens.reduce((n, s) => n + s.cases.length, 0) + sheet.flows.reduce((n, f) => n + f.cases.length, 0));
    const csv = testViewpointSheetToCsv(sheet);
    const lines = csv.trim().split("\r\n");
    expect(lines[0]).toBe("ID,対象,区分,観点・条件,入力・状況,期待結果,期待メッセージ,入力値");
    expect(lines.length).toBe(sheet.total + 1);
    expect(lines[1]).toContain('"画面 カート / 備考, 任意"');
  });
});

describe("設計書の付録「テスト観点 (画面入力)」", () => {
  const base = { project: { name: "P" }, flows: [], tables: [], transitions: [], messages: {} };
  it("入力のある画面があれば、要確認事項の後ろに付録として出て、章番号は動かない", () => {
    const withInput = buildDesignDocument({ ...base, screens: [{ id: "s1", name: "検索", items: [{ id: "q", label: "検索語", type: "string", required: true, maxLength: 10 }] }] } as never);
    const without = buildDesignDocument({ ...base, screens: [{ id: "s1", name: "検索", items: [{ id: "q", label: "検索語", type: "string", direction: "out" }] }] } as never);
    expect(withInput.html).toContain('id="input-tests"');
    expect(withInput.html).toContain("付録</span>テスト観点 (画面入力)");
    expect(withInput.html.indexOf('id="issues"')).toBeLessThan(withInput.html.indexOf('id="input-tests"'));
    expect(withInput.toc.map((t) => t.id)).toContain("input-tests");
    expect(without.html).not.toContain('id="input-tests"');
    // 付録の有無で、要確認事項の章番号は変わらない
    const chapter = (html: string) => html.match(/hd-chapter">(\d+)<\/span>要確認事項/)?.[1];
    expect(chapter(withInput.html)).toBe(chapter(without.html));
  });
});
