/**
 * screenItemRefKeyValidator テスト (#651、Phase 4 子 3)
 *
 * 7 観点:
 * 1. UNDECLARED_REF_KEY              — refKey が conventions.fieldKeys 未宣言
 * 2. INCONSISTENT_TYPE_BY_REF_KEY    — 同一 refKey 間で type 不整合 (error)
 * 3. INCONSISTENT_FORMAT_BY_REF_KEY  — 同一 refKey 間で pattern / displayFormat 不整合 (warning)
 * 4. INCONSISTENT_VALIDATION_BY_REF_KEY — 同一 refKey 間で min/max/minLength/maxLength 不整合 (warning)
 * 5. INCONSISTENT_HANDLER_FLOW_BY_REF_KEY — 同一 refKey の events 間で handlerFlowId 発散 (warning)
 * 6. ORPHAN_FIELD_KEY                — conventions.fieldKeys 宣言だが画面で参照無し (warning)
 * 7. DECLARED_TYPE_MISMATCH          — conventions.fieldKeys[k].type と ScreenItem.type 不一致 (warning)
 */

import { describe, it, expect } from "vitest";
import { checkScreenItemRefKeyConsistency } from "./screenItemRefKeyValidator";
import type { Screen } from "../types/v3/screen";
import type { ScreenItem } from "../types/v3/screen-item";
import type { Conventions } from "../types/v3/conventions";

// ─── ヘルパー ───────────────────────────────────────────────────────────────

function makeItem(id: string, overrides: Partial<ScreenItem> = {}): ScreenItem {
  return {
    id,
    label: id,
    type: "string",
    ...overrides,
  } as ScreenItem;
}

function makeScreen(id: string, items: ScreenItem[]): Screen {
  return {
    id,
    name: `screen-${id}`,
    kind: "form",
    path: `/test/${id}`,
    createdAt: "2026-04-30T00:00:00.000Z",
    updatedAt: "2026-04-30T00:00:00.000Z",
    items,
  } as unknown as Screen;
}

function makeConventions(fieldKeys: Record<string, unknown>): Conventions {
  return {
    version: "1.0.0",
    fieldKeys: fieldKeys as Conventions["fieldKeys"],
  };
}

// ─── 観点 1: UNDECLARED_REF_KEY ──────────────────────────────────────────────

describe("UNDECLARED_REF_KEY", () => {
  it("refKey が conventions.fieldKeys に未宣言の場合 error を返す", () => {
    const screens = [
      makeScreen("s1", [makeItem("customerId", { refKey: "customerId" })]),
    ];
    const conventions = makeConventions({ accountNumber: { type: "string" } });
    const issues = checkScreenItemRefKeyConsistency(screens, conventions);
    const undeclared = issues.filter((i) => i.code === "UNDECLARED_REF_KEY");
    expect(undeclared).toHaveLength(1);
    expect(undeclared[0].severity).toBe("error");
    expect(undeclared[0].refKey).toBe("customerId");
  });

  it("conventions が null の場合は UNDECLARED_REF_KEY を発報しない (draft-state policy 準拠)", () => {
    const screens = [
      makeScreen("s1", [makeItem("customerId", { refKey: "customerId" })]),
    ];
    const issues = checkScreenItemRefKeyConsistency(screens, null);
    const undeclared = issues.filter((i) => i.code === "UNDECLARED_REF_KEY");
    expect(undeclared).toHaveLength(0);
  });

  it("conventions に fieldKeys が未定義の場合は UNDECLARED_REF_KEY を発報しない", () => {
    const screens = [
      makeScreen("s1", [makeItem("customerId", { refKey: "customerId" })]),
    ];
    const conventions: Conventions = { version: "1.0.0" };
    const issues = checkScreenItemRefKeyConsistency(screens, conventions);
    const undeclared = issues.filter((i) => i.code === "UNDECLARED_REF_KEY");
    expect(undeclared).toHaveLength(0);
  });

  it("refKey が宣言済みなら UNDECLARED_REF_KEY なし", () => {
    const screens = [
      makeScreen("s1", [makeItem("customerId", { refKey: "customerId" })]),
    ];
    const conventions = makeConventions({ customerId: { type: "string" } });
    const issues = checkScreenItemRefKeyConsistency(screens, conventions);
    const undeclared = issues.filter((i) => i.code === "UNDECLARED_REF_KEY");
    expect(undeclared).toHaveLength(0);
  });
});

// ─── 観点 2: INCONSISTENT_TYPE_BY_REF_KEY ────────────────────────────────────

describe("INCONSISTENT_TYPE_BY_REF_KEY", () => {
  it("同一 refKey で type が不整合な場合 error を返す", () => {
    const screens = [
      makeScreen("s1", [makeItem("f1", { refKey: "customerId", type: "string" })]),
      makeScreen("s2", [makeItem("f2", { refKey: "customerId", type: "integer" })]),
    ];
    const issues = checkScreenItemRefKeyConsistency(screens, null);
    const typeIssues = issues.filter((i) => i.code === "INCONSISTENT_TYPE_BY_REF_KEY");
    expect(typeIssues).toHaveLength(1);
    expect(typeIssues[0].severity).toBe("error");
    expect(typeIssues[0].refKey).toBe("customerId");
  });

  it("同一 refKey で type が一致する場合は INCONSISTENT_TYPE_BY_REF_KEY なし", () => {
    const screens = [
      makeScreen("s1", [makeItem("f1", { refKey: "customerId", type: "string" })]),
      makeScreen("s2", [makeItem("f2", { refKey: "customerId", type: "string" })]),
    ];
    const issues = checkScreenItemRefKeyConsistency(screens, null);
    const typeIssues = issues.filter((i) => i.code === "INCONSISTENT_TYPE_BY_REF_KEY");
    expect(typeIssues).toHaveLength(0);
  });

  it("extension type は extensionRef を含めて比較する", () => {
    const extTypeA = { kind: "extension", extensionRef: "finance:accountNumber" };
    const extTypeB = { kind: "extension", extensionRef: "finance:transferAmount" };
    const screens = [
      makeScreen("s1", [makeItem("f1", { refKey: "accountNumber", type: extTypeA })]),
      makeScreen("s2", [makeItem("f2", { refKey: "accountNumber", type: extTypeB })]),
    ];
    const issues = checkScreenItemRefKeyConsistency(screens, null);
    const typeIssues = issues.filter((i) => i.code === "INCONSISTENT_TYPE_BY_REF_KEY");
    expect(typeIssues).toHaveLength(1);
  });

  it("extension type が同一 extensionRef なら型一致", () => {
    const extType = { kind: "extension", extensionRef: "finance:accountNumber" };
    const screens = [
      makeScreen("s1", [makeItem("f1", { refKey: "accountNumber", type: extType })]),
      makeScreen("s2", [makeItem("f2", { refKey: "accountNumber", type: extType })]),
    ];
    const issues = checkScreenItemRefKeyConsistency(screens, null);
    const typeIssues = issues.filter((i) => i.code === "INCONSISTENT_TYPE_BY_REF_KEY");
    expect(typeIssues).toHaveLength(0);
  });
});

// ─── 観点 3: INCONSISTENT_FORMAT_BY_REF_KEY ──────────────────────────────────

describe("INCONSISTENT_FORMAT_BY_REF_KEY", () => {
  it("同一 refKey で pattern が不整合な場合 warning を返す", () => {
    const screens = [
      makeScreen("s1", [makeItem("f1", { refKey: "orderNumber", type: "string", pattern: "^ORD-\\d{6}$" })]),
      makeScreen("s2", [makeItem("f2", { refKey: "orderNumber", type: "string", pattern: "^ORD-\\d{4}$" })]),
    ];
    const issues = checkScreenItemRefKeyConsistency(screens, null);
    const fmt = issues.filter((i) => i.code === "INCONSISTENT_FORMAT_BY_REF_KEY");
    expect(fmt).toHaveLength(1);
    expect(fmt[0].severity).toBe("warning");
  });

  it("同一 refKey で displayFormat が不整合な場合 warning を返す", () => {
    const screens = [
      makeScreen("s1", [makeItem("f1", { refKey: "amount", type: "integer", displayFormat: "¥#,##0" })]),
      makeScreen("s2", [makeItem("f2", { refKey: "amount", type: "integer", displayFormat: "#,##0 円" })]),
    ];
    const issues = checkScreenItemRefKeyConsistency(screens, null);
    const fmt = issues.filter((i) => i.code === "INCONSISTENT_FORMAT_BY_REF_KEY");
    expect(fmt).toHaveLength(1);
    expect(fmt[0].severity).toBe("warning");
  });

  it("pattern が一方のみ定義の場合は発報しない (片側 undefined は許容)", () => {
    const screens = [
      makeScreen("s1", [makeItem("f1", { refKey: "orderNumber", type: "string", pattern: "^ORD-\\d{6}$" })]),
      makeScreen("s2", [makeItem("f2", { refKey: "orderNumber", type: "string" })]),
    ];
    const issues = checkScreenItemRefKeyConsistency(screens, null);
    const fmt = issues.filter((i) => i.code === "INCONSISTENT_FORMAT_BY_REF_KEY");
    expect(fmt).toHaveLength(0);
  });
});

// ─── 観点 4: INCONSISTENT_VALIDATION_BY_REF_KEY ──────────────────────────────

describe("INCONSISTENT_VALIDATION_BY_REF_KEY", () => {
  it("同一 refKey で minLength が不整合な場合 warning を返す", () => {
    const screens = [
      makeScreen("s1", [makeItem("f1", { refKey: "customerCode", type: "string", minLength: 6 })]),
      makeScreen("s2", [makeItem("f2", { refKey: "customerCode", type: "string", minLength: 8 })]),
    ];
    const issues = checkScreenItemRefKeyConsistency(screens, null);
    const val = issues.filter((i) => i.code === "INCONSISTENT_VALIDATION_BY_REF_KEY");
    expect(val).toHaveLength(1);
    expect(val[0].severity).toBe("warning");
  });

  it("同一 refKey で max が不整合な場合 warning を返す", () => {
    const screens = [
      makeScreen("s1", [makeItem("f1", { refKey: "price", type: "integer", max: 99999999 })]),
      makeScreen("s2", [makeItem("f2", { refKey: "price", type: "integer", max: 9999999 })]),
    ];
    const issues = checkScreenItemRefKeyConsistency(screens, null);
    const val = issues.filter((i) => i.code === "INCONSISTENT_VALIDATION_BY_REF_KEY");
    expect(val).toHaveLength(1);
  });

  it("一方のみ min 定義の場合は発報しない", () => {
    const screens = [
      makeScreen("s1", [makeItem("f1", { refKey: "price", type: "integer", min: 1 })]),
      makeScreen("s2", [makeItem("f2", { refKey: "price", type: "integer" })]),
    ];
    const issues = checkScreenItemRefKeyConsistency(screens, null);
    const val = issues.filter((i) => i.code === "INCONSISTENT_VALIDATION_BY_REF_KEY");
    expect(val).toHaveLength(0);
  });
});

// ─── 観点 5: INCONSISTENT_HANDLER_FLOW_BY_REF_KEY ────────────────────────────

describe("INCONSISTENT_HANDLER_FLOW_BY_REF_KEY", () => {
  it("両側に同一 eventId を持ち handlerFlowId が異なる場合 warning を返す", () => {
    const screens = [
      makeScreen("s1", [
        makeItem("f1", {
          refKey: "customerId",
          type: "string",
          events: [{ id: "change", handlerFlowId: "flow-A" }],
        }),
      ]),
      makeScreen("s2", [
        makeItem("f2", {
          refKey: "customerId",
          type: "string",
          events: [{ id: "change", handlerFlowId: "flow-B" }],
        }),
      ]),
    ];
    const issues = checkScreenItemRefKeyConsistency(screens, null);
    const handler = issues.filter((i) => i.code === "INCONSISTENT_HANDLER_FLOW_BY_REF_KEY");
    expect(handler).toHaveLength(1);
    expect(handler[0].severity).toBe("warning");
  });

  it("片側に events がない場合は INCONSISTENT_HANDLER_FLOW_BY_REF_KEY を発報しない (画面 role の違い許容)", () => {
    const screens = [
      makeScreen("s1", [
        makeItem("f1", {
          refKey: "customerId",
          type: "string",
          events: [{ id: "change", handlerFlowId: "flow-A" }],
        }),
      ]),
      makeScreen("s2", [
        makeItem("f2", {
          refKey: "customerId",
          type: "string",
          // events なし (一覧画面 = output only)
        }),
      ]),
    ];
    const issues = checkScreenItemRefKeyConsistency(screens, null);
    const handler = issues.filter((i) => i.code === "INCONSISTENT_HANDLER_FLOW_BY_REF_KEY");
    expect(handler).toHaveLength(0);
  });

  it("同じ eventId で同じ handlerFlowId の場合は発報しない", () => {
    const screens = [
      makeScreen("s1", [
        makeItem("f1", {
          refKey: "customerId",
          type: "string",
          events: [{ id: "change", handlerFlowId: "flow-A" }],
        }),
      ]),
      makeScreen("s2", [
        makeItem("f2", {
          refKey: "customerId",
          type: "string",
          events: [{ id: "change", handlerFlowId: "flow-A" }],
        }),
      ]),
    ];
    const issues = checkScreenItemRefKeyConsistency(screens, null);
    const handler = issues.filter((i) => i.code === "INCONSISTENT_HANDLER_FLOW_BY_REF_KEY");
    expect(handler).toHaveLength(0);
  });

  it("eventId の非対称 (片側のみ存在) は INCONSISTENT_HANDLER_FLOW_BY_REF_KEY として警告する", () => {
    const screens = [
      makeScreen("s1", [
        makeItem("f1", {
          refKey: "customerId",
          type: "string",
          events: [
            { id: "change", handlerFlowId: "flow-A" },
            { id: "blur", handlerFlowId: "flow-B" },
          ],
        }),
      ]),
      makeScreen("s2", [
        makeItem("f2", {
          refKey: "customerId",
          type: "string",
          events: [{ id: "change", handlerFlowId: "flow-A" }],
        }),
      ]),
    ];
    const issues = checkScreenItemRefKeyConsistency(screens, null);
    const handler = issues.filter((i) => i.code === "INCONSISTENT_HANDLER_FLOW_BY_REF_KEY");
    expect(handler).toHaveLength(1);
  });
});

// ─── 観点 6: ORPHAN_FIELD_KEY ────────────────────────────────────────────────

describe("ORPHAN_FIELD_KEY", () => {
  it("conventions.fieldKeys に宣言だが画面で未使用の場合 warning を返す", () => {
    const screens = [
      makeScreen("s1", [makeItem("f1", { type: "string" })]), // refKey なし
    ];
    const conventions = makeConventions({ customerId: { type: "string" } });
    const issues = checkScreenItemRefKeyConsistency(screens, conventions);
    const orphan = issues.filter((i) => i.code === "ORPHAN_FIELD_KEY");
    expect(orphan).toHaveLength(1);
    expect(orphan[0].severity).toBe("warning");
    expect(orphan[0].refKey).toBe("customerId");
  });

  it("conventions が null の場合は ORPHAN_FIELD_KEY なし", () => {
    const screens = [makeScreen("s1", [])];
    const issues = checkScreenItemRefKeyConsistency(screens, null);
    const orphan = issues.filter((i) => i.code === "ORPHAN_FIELD_KEY");
    expect(orphan).toHaveLength(0);
  });

  it("全 fieldKey が参照されている場合は ORPHAN_FIELD_KEY なし", () => {
    const screens = [
      makeScreen("s1", [makeItem("f1", { refKey: "customerId", type: "string" })]),
    ];
    const conventions = makeConventions({ customerId: { type: "string" } });
    const issues = checkScreenItemRefKeyConsistency(screens, conventions);
    const orphan = issues.filter((i) => i.code === "ORPHAN_FIELD_KEY");
    expect(orphan).toHaveLength(0);
  });
});

// ─── 観点 7: DECLARED_TYPE_MISMATCH ──────────────────────────────────────────

describe("DECLARED_TYPE_MISMATCH", () => {
  it("conventions.fieldKeys[k].type と ScreenItem.type が不一致の場合 warning を返す", () => {
    const screens = [
      makeScreen("s1", [makeItem("f1", { refKey: "customerId", type: "integer" })]),
    ];
    const conventions = makeConventions({ customerId: { type: "string" } });
    const issues = checkScreenItemRefKeyConsistency(screens, conventions);
    const mismatch = issues.filter((i) => i.code === "DECLARED_TYPE_MISMATCH");
    expect(mismatch).toHaveLength(1);
    expect(mismatch[0].severity).toBe("warning");
  });

  it("conventions.fieldKeys[k].type と ScreenItem.type が一致する場合は DECLARED_TYPE_MISMATCH なし", () => {
    const screens = [
      makeScreen("s1", [makeItem("f1", { refKey: "customerId", type: "string" })]),
    ];
    const conventions = makeConventions({ customerId: { type: "string" } });
    const issues = checkScreenItemRefKeyConsistency(screens, conventions);
    const mismatch = issues.filter((i) => i.code === "DECLARED_TYPE_MISMATCH");
    expect(mismatch).toHaveLength(0);
  });

  it("conventions.fieldKeys[k].type が未定義の場合は DECLARED_TYPE_MISMATCH なし", () => {
    const screens = [
      makeScreen("s1", [makeItem("f1", { refKey: "customerId", type: "string" })]),
    ];
    const conventions = makeConventions({ customerId: { displayName: "顧客ID" } });
    const issues = checkScreenItemRefKeyConsistency(screens, conventions);
    const mismatch = issues.filter((i) => i.code === "DECLARED_TYPE_MISMATCH");
    expect(mismatch).toHaveLength(0);
  });
});

// ─── 統合: 複合シナリオ ───────────────────────────────────────────────────────

describe("統合シナリオ", () => {
  it("問題のない多画面 refKey 使用では issues ゼロ", () => {
    const conventions = makeConventions({
      customerId: { type: "string", displayName: "顧客ID" },
      orderNumber: { type: "string", displayName: "注文番号" },
    });
    const screens = [
      makeScreen("s1", [
        makeItem("cid1", { refKey: "customerId", type: "string", pattern: "^C-\\d{6}$" }),
        makeItem("on1", { refKey: "orderNumber", type: "string" }),
      ]),
      makeScreen("s2", [
        makeItem("cid2", { refKey: "customerId", type: "string", pattern: "^C-\\d{6}$" }),
        makeItem("on2", { refKey: "orderNumber", type: "string" }),
      ]),
    ];
    const issues = checkScreenItemRefKeyConsistency(screens, conventions);
    // ORPHAN_FIELD_KEY がないことも確認
    const errors = issues.filter((i) => i.severity === "error");
    expect(errors).toHaveLength(0);
    expect(issues.filter((i) => i.code === "ORPHAN_FIELD_KEY")).toHaveLength(0);
  });

  it("refKey なし item は全観点でスキップされる", () => {
    const conventions = makeConventions({});
    const screens = [
      makeScreen("s1", [makeItem("f1", { type: "string" }), makeItem("f2", { type: "integer" })]),
    ];
    const issues = checkScreenItemRefKeyConsistency(screens, conventions);
    expect(issues).toHaveLength(0);
  });

  it("複数観点が同時に発報されるケース (UNDECLARED + INCONSISTENT_TYPE)", () => {
    // refKey "unknownKey" は未宣言、かつ type が 2 画面で不整合
    const conventions = makeConventions({ knownKey: { type: "string" } });
    const screens = [
      makeScreen("s1", [
        makeItem("f1", { refKey: "unknownKey", type: "string" }),
        makeItem("f2", { refKey: "knownKey", type: "string" }),
      ]),
      makeScreen("s2", [
        makeItem("f3", { refKey: "unknownKey", type: "integer" }), // 型不整合 + 未宣言
        makeItem("f4", { refKey: "knownKey", type: "string" }),
      ]),
    ];
    const issues = checkScreenItemRefKeyConsistency(screens, conventions);
    // UNDECLARED_REF_KEY: s1 と s2 の unknownKey 各 occurrence に対して error
    const undeclared = issues.filter((i) => i.code === "UNDECLARED_REF_KEY");
    expect(undeclared.length).toBeGreaterThanOrEqual(1);
    // INCONSISTENT_TYPE_BY_REF_KEY
    const typeIssues = issues.filter((i) => i.code === "INCONSISTENT_TYPE_BY_REF_KEY");
    expect(typeIssues).toHaveLength(1);
    // knownKey は問題なし (ORPHAN はなし)
    const orphan = issues.filter((i) => i.code === "ORPHAN_FIELD_KEY");
    expect(orphan).toHaveLength(0);
  });
});
