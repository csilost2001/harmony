import { describe, it, expect } from "vitest";
import {
  checkConventionReferences,
  checkConventionsCatalogIntegrity,
  checkScreenItemConventionReferences,
  type ConventionsCatalog,
} from "./conventionsValidator";
import type { ProcessFlow } from "../types/action";
import type { ScreenItemsDocument } from "../store/screenItemsStore";
import type { Identifier, ScreenId, Timestamp } from "../types/v3";

/**
 * テスト用インライン規約カタログ (v1 サンプルから抽出した最小有効インスタンス)。
 * v1/v2 スキーマファイル削除 (#774) に伴い、ファイル読み込みからインライン化。
 */
const INLINE_CATALOG: ConventionsCatalog = {
  version: "1.0.0",
  msg: {
    required: { template: "{label}は必須入力です", params: ["label"] },
    maxLength: { template: "{label}は{max}文字以内で入力してください", params: ["label", "max"] },
    invalidFormat: { template: "{label}の形式が正しくありません", params: ["label"] },
    outOfRange: { template: "{label}は{min}〜{max}の範囲で入力してください", params: ["label", "min", "max"] },
    mustBePositive: { template: "{label}は1以上の数値を入力してください", params: ["label"] },
    insufficientInventory: { template: "{label}の在庫が不足しています (要求: {required}, 在庫: {available})", params: ["label", "required", "available"] },
    cartExpired: { template: "カートの有効期限が切れています", params: [] },
  },
  regex: {
    "email-simple": { pattern: "^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$" },
    "phone-jp": { pattern: "^0\\d{1,4}-\\d{1,4}-\\d{4}$" },
    "postal-jp": { pattern: "^\\d{3}-?\\d{4}$" },
    "product-code": { pattern: "^[A-Z0-9]{3,20}$" },
  },
  limit: {
    nameMax: { value: 100, unit: "char" },
    emailMax: { value: 255, unit: "char" },
    phoneMax: { value: 20, unit: "char" },
    addressMax: { value: 500, unit: "char" },
    quantityMax: { value: 9999, unit: "integer" },
    quantityMin: { value: 1, unit: "integer" },
    amountMax: { value: 999999999999, unit: "yen" },
    cartItemMax: { value: 50, unit: "integer" },
    cartRetentionDays: { value: 30, unit: "days" },
    maxDeliveryAttempts: { value: 3, unit: "integer" },
    lowStockThreshold: { value: 10, unit: "integer" },
  },
  scope: {
    customerRegion: { value: "domestic" },
    timezone: { value: "Asia/Tokyo" },
    language: { value: "ja" },
  },
  currency: {
    jpy: { code: "JPY", subunit: 0, roundingMode: "floor", default: true },
  },
  tax: {
    standard: { kind: "exclusive", rate: 0.10, roundingMode: "floor", default: true },
    reducedFood: { kind: "exclusive", rate: 0.08, roundingMode: "floor" },
  },
  auth: {
    default: { scheme: "session-cookie", default: true },
  },
  permission: {
    "order.create": { resource: "Order", action: "create", scope: "own" },
    "order.read": { resource: "Order", action: "read", scope: "own" },
    "inventory.read": { resource: "Inventory", action: "read", scope: "all" },
    "shipment.create": { resource: "Shipment", action: "create", scope: "department" },
  },
  role: {
    customer: { name: "顧客", permissions: ["inventory.read", "order.create", "order.read"] },
    operationsSystem: { name: "業務システム", permissions: ["inventory.read", "shipment.create"] },
  },
  db: {
    default: { engine: "postgresql@14", namingConvention: "snake_case", default: true },
  },
  numbering: {
    customerCode: { format: "C-NNNN", implementation: "PG sequence + DEFAULT" },
    orderNumber: { format: "RO-YYYY-NNNN", implementation: "PG sequence + trigger" },
    cartCode: { format: "UUID-v4", implementation: "application-layer UUID" },
    shipmentId: { format: "UUID-v4", implementation: "application-layer UUID" },
  },
  tx: {
    singleOperation: { policy: "単一操作は 1 TX" },
    externalApi: { policy: "外部 API 呼出は TX 外を原則とする" },
  },
  externalOutcomeDefaults: {
    success: { outcome: "success", action: "continue", retry: "none" },
    failure: { outcome: "failure", action: "abort", retry: "none" },
    timeout: { outcome: "timeout", action: "abort", retry: "none" },
  },
};

function loadCatalog(): ConventionsCatalog {
  return INLINE_CATALOG;
}

function makeGroup(partial: Partial<ProcessFlow>): ProcessFlow {
  return {
    meta: { id: "a", name: "x", kind: "screen", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" },
    actions: [],
    ...partial,
  } as ProcessFlow;
}


describe("checkConventionReferences", () => {
  const catalog = loadCatalog();

  it("既知の @conv.msg.* は accept", () => {
    const issues = checkConventionReferences(
      makeGroup({
        actions: [{
          id: "a1", name: "f", trigger: "click",
          steps: [{
            id: "s1", kind: "validation", description: "", conditions: "",
            rules: [{ field: "x", type: "required", message: "@conv.msg.required" }],
          }],
        }],
      }),
      catalog,
    );
    expect(issues).toHaveLength(0);
  });

  it("未知の @conv.msg.* を検出", () => {
    const issues = checkConventionReferences(
      makeGroup({
        actions: [{
          id: "a1", name: "f", trigger: "click",
          steps: [{
            id: "s1", kind: "validation", description: "", conditions: "",
            rules: [{ field: "x", type: "required", message: "@conv.msg.unknownKey" }],
          }],
        }],
      }),
      catalog,
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe("UNKNOWN_CONV_MSG");
  });

  it("@conv.regex.email-simple は accept", () => {
    const issues = checkConventionReferences(
      makeGroup({
        actions: [{
          id: "a1", name: "f", trigger: "click",
          steps: [{
            id: "s1", kind: "validation", description: "", conditions: "@conv.regex.email-simple",
            rules: [],
          }],
        }],
      }),
      catalog,
    );
    expect(issues).toHaveLength(0);
  });

  it("@conv.regex.unknownPattern を検出", () => {
    const issues = checkConventionReferences(
      makeGroup({
        actions: [{
          id: "a1", name: "f", trigger: "click",
          steps: [{
            id: "s1", kind: "validation", description: "", conditions: "@conv.regex.unknownPattern",
            rules: [],
          }],
        }],
      }),
      catalog,
    );
    expect(issues.some((i) => i.code === "UNKNOWN_CONV_REGEX")).toBe(true);
  });

  it("@conv.limit.quantityMax は accept", () => {
    const issues = checkConventionReferences(
      makeGroup({
        actions: [{
          id: "a1", name: "f", trigger: "click",
          steps: [{
            id: "s1", type: "other", description: "上限 @conv.limit.quantityMax まで",
          }],
        }],
      }),
      catalog,
    );
    expect(issues).toHaveLength(0);
  });

  it("未知のカテゴリ @conv.xxx.* は UNKNOWN_CONV_CATEGORY", () => {
    const issues = checkConventionReferences(
      makeGroup({
        actions: [{
          id: "a1", name: "f", trigger: "click",
          steps: [{
            id: "s1", type: "other", description: "@conv.color.red",
          }],
        }],
      }),
      catalog,
    );
    expect(issues.some((i) => i.code === "UNKNOWN_CONV_CATEGORY")).toBe(true);
  });

  it("@conv.scope.customerRegion は accept", () => {
    const issues = checkConventionReferences(
      makeGroup({
        actions: [{
          id: "a1", name: "f", trigger: "click",
          steps: [{ id: "s1", type: "other", description: "対象: @conv.scope.customerRegion" }],
        }],
      }),
      catalog,
    );
    expect(issues).toHaveLength(0);
  });

  it("@conv.scope.unknownKey は UNKNOWN_CONV_SCOPE", () => {
    const issues = checkConventionReferences(
      makeGroup({
        actions: [{
          id: "a1", name: "f", trigger: "click",
          steps: [{ id: "s1", type: "other", description: "@conv.scope.unknownKey" }],
        }],
      }),
      catalog,
    );
    expect(issues.some((i) => i.code === "UNKNOWN_CONV_SCOPE")).toBe(true);
  });

  it("@conv.currency.jpy は accept", () => {
    const issues = checkConventionReferences(
      makeGroup({
        actions: [{
          id: "a1", name: "f", trigger: "click",
          steps: [{ id: "s1", type: "other", description: "通貨: @conv.currency.jpy" }],
        }],
      }),
      catalog,
    );
    expect(issues).toHaveLength(0);
  });

  it("@conv.tax.standard は accept", () => {
    const issues = checkConventionReferences(
      makeGroup({
        actions: [{
          id: "a1", name: "f", trigger: "click",
          steps: [{ id: "s1", type: "other", description: "税率: @conv.tax.standard" }],
        }],
      }),
      catalog,
    );
    expect(issues).toHaveLength(0);
  });

  it("@conv.auth.default は accept", () => {
    const issues = checkConventionReferences(
      makeGroup({
        actions: [{
          id: "a1", name: "f", trigger: "click",
          steps: [{ id: "s1", type: "other", description: "認証: @conv.auth.default" }],
        }],
      }),
      catalog,
    );
    expect(issues).toHaveLength(0);
  });

  it("@conv.db.default は accept", () => {
    const issues = checkConventionReferences(
      makeGroup({
        actions: [{
          id: "a1", name: "f", trigger: "click",
          steps: [{ id: "s1", type: "other", description: "DB: @conv.db.default" }],
        }],
      }),
      catalog,
    );
    expect(issues).toHaveLength(0);
  });

  it("@conv.numbering.customerCode は accept", () => {
    const issues = checkConventionReferences(
      makeGroup({
        actions: [{
          id: "a1", name: "f", trigger: "click",
          steps: [{ id: "s1", type: "other", description: "採番: @conv.numbering.customerCode" }],
        }],
      }),
      catalog,
    );
    expect(issues).toHaveLength(0);
  });

  it("@conv.tx.singleOperation は accept", () => {
    const issues = checkConventionReferences(
      makeGroup({
        actions: [{
          id: "a1", name: "f", trigger: "click",
          steps: [{ id: "s1", type: "other", description: "TX: @conv.tx.singleOperation" }],
        }],
      }),
      catalog,
    );
    expect(issues).toHaveLength(0);
  });

  it("@conv.externalOutcomeDefaults.failure は accept", () => {
    const issues = checkConventionReferences(
      makeGroup({
        actions: [{
          id: "a1", name: "f", trigger: "click",
          steps: [{ id: "s1", type: "other", description: "失敗時: @conv.externalOutcomeDefaults.failure" }],
        }],
      }),
      catalog,
    );
    expect(issues).toHaveLength(0);
  });

  // ── 新カテゴリ: 不在キーは専用エラーコード (PR-A3) ──────────────────

  const makeGroupWithDesc = (desc: string) => makeGroup({
    actions: [{ id: "a1", name: "f", trigger: "click", steps: [{ id: "s1", type: "other", description: desc }] }],
  });

  it("@conv.currency.unknown は UNKNOWN_CONV_CURRENCY", () => {
    const issues = checkConventionReferences(makeGroupWithDesc("@conv.currency.unknown"), catalog);
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe("UNKNOWN_CONV_CURRENCY");
  });

  it("@conv.tax.unknown は UNKNOWN_CONV_TAX", () => {
    const issues = checkConventionReferences(makeGroupWithDesc("@conv.tax.unknown"), catalog);
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe("UNKNOWN_CONV_TAX");
  });

  it("@conv.auth.unknown は UNKNOWN_CONV_AUTH", () => {
    const issues = checkConventionReferences(makeGroupWithDesc("@conv.auth.unknown"), catalog);
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe("UNKNOWN_CONV_AUTH");
  });

  it("@conv.db.unknown は UNKNOWN_CONV_DB", () => {
    const issues = checkConventionReferences(makeGroupWithDesc("@conv.db.unknown"), catalog);
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe("UNKNOWN_CONV_DB");
  });

  it("@conv.numbering.unknown は UNKNOWN_CONV_NUMBERING", () => {
    const issues = checkConventionReferences(makeGroupWithDesc("@conv.numbering.unknown"), catalog);
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe("UNKNOWN_CONV_NUMBERING");
  });

  it("@conv.tx.unknown は UNKNOWN_CONV_TX", () => {
    const issues = checkConventionReferences(makeGroupWithDesc("@conv.tx.unknown"), catalog);
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe("UNKNOWN_CONV_TX");
  });

  it("@conv.externalOutcomeDefaults.unknown は UNKNOWN_CONV_EXTERNAL_OUTCOME_DEFAULTS", () => {
    const issues = checkConventionReferences(makeGroupWithDesc("@conv.externalOutcomeDefaults.unknown"), catalog);
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe("UNKNOWN_CONV_EXTERNAL_OUTCOME_DEFAULTS");
  });

  it("@conv.scope.unknown は UNKNOWN_CONV_SCOPE (inline catalog)", () => {
    const inlineCatalog: ConventionsCatalog = { version: "1.0.0", scope: { customerRegion: { value: "domestic" } } };
    const issues = checkConventionReferences(makeGroupWithDesc("@conv.scope.unknown"), inlineCatalog);
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe("UNKNOWN_CONV_SCOPE");
  });

  it("@conv.color.red は (未定義カテゴリ) UNKNOWN_CONV_CATEGORY", () => {
    const issues = checkConventionReferences(makeGroupWithDesc("@conv.color.red"), catalog);
    expect(issues.some((i) => i.code === "UNKNOWN_CONV_CATEGORY")).toBe(true);
  });

  it("catalog が null (未ロード) なら検査スキップ", () => {
    const issues = checkConventionReferences(
      makeGroup({
        actions: [{
          id: "a1", name: "f", trigger: "click",
          steps: [{
            id: "s1", kind: "validation", description: "", conditions: "",
            rules: [{ field: "x", type: "required", message: "@conv.msg.anything" }],
          }],
        }],
      }),
      null,
    );
    expect(issues).toHaveLength(0);
  });
});

describe("checkConventionsCatalogIntegrity - RBAC", () => {
  it("有効な role / permission カタログは検証を通過する", () => {
    const catalog: ConventionsCatalog = {
      version: "1.0.0",
      permission: {
        "order.create": { resource: "Order", action: "create" },
        "order.read": { resource: "Order", action: "read", scope: "own" },
        "order.approve": { resource: "Order", action: "approve", scope: "department" },
      },
      role: {
        orderOperator: {
          name: "受注担当",
          permissions: ["order.create", "order.read"],
        },
        orderApprover: {
          name: "承認者",
          permissions: ["order.approve"],
          inherits: ["orderOperator"],
        },
      },
    };

    expect(checkConventionsCatalogIntegrity(catalog)).toHaveLength(0);
  });

  it("role.inherits の循環参照をエラーとして検出する", () => {
    const catalog: ConventionsCatalog = {
      version: "1.0.0",
      role: {
        roleA: { permissions: [], inherits: ["roleB"] },
        roleB: { permissions: [], inherits: ["roleA"] },
      },
    };

    const issues = checkConventionsCatalogIntegrity(catalog);
    expect(issues.some((issue) => issue.code === "ROLE_INHERITS_CYCLE")).toBe(true);
  });

  it("role.permissions の存在しない permission 参照をエラーとして検出する", () => {
    const catalog: ConventionsCatalog = {
      version: "1.0.0",
      permission: {
        "order.read": { resource: "Order", action: "read" },
      },
      role: {
        orderOperator: { permissions: ["order.read", "order.delete"] },
      },
    };

    const issues = checkConventionsCatalogIntegrity(catalog);
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe("UNKNOWN_CONV_ROLE_PERMISSION");
    expect(issues[0].path).toBe("role.orderOperator.permissions[1]");
  });

  it("role.inherits の存在しない親 role 参照をエラーとして検出する", () => {
    const catalog: ConventionsCatalog = {
      version: "1.0.0",
      role: {
        orderApprover: { permissions: [], inherits: ["orderOperator"] },
      },
    };

    const issues = checkConventionsCatalogIntegrity(catalog);
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe("UNKNOWN_CONV_ROLE_INHERITS");
    expect(issues[0].path).toBe("role.orderApprover.inherits[0]");
    expect(issues[0].value).toBe("orderOperator");
  });
});

// ── checkScreenItemConventionReferences (#351) ────────────────────────────

describe("checkConventionsCatalogIntegrity - i18n", () => {
  it("valid i18n and msg.locales pass", () => {
    const catalog: ConventionsCatalog = {
      version: "1.0.0",
      i18n: {
        supportedLocales: ["ja-JP", "en-US"],
        defaultLocale: "ja-JP",
      },
      msg: {
        required: {
          template: "{label}は必須入力です",
          params: ["label"],
          locales: { "en-US": "{label} is required" },
        },
      },
    };

    expect(checkConventionsCatalogIntegrity(catalog)).toHaveLength(0);
  });

  it("defaultLocale outside supportedLocales is INVALID_DEFAULT_LOCALE", () => {
    const catalog: ConventionsCatalog = {
      version: "1.0.0",
      i18n: {
        supportedLocales: ["ja-JP"],
        defaultLocale: "en-US",
      },
    };

    const issues = checkConventionsCatalogIntegrity(catalog);
    expect(issues.some((issue) => issue.code === "INVALID_DEFAULT_LOCALE")).toBe(true);
  });

  it("msg.locales outside supportedLocales is UNKNOWN_MSG_LOCALE", () => {
    const catalog: ConventionsCatalog = {
      version: "1.0.0",
      i18n: {
        supportedLocales: ["ja-JP", "en-US"],
        defaultLocale: "ja-JP",
      },
      msg: {
        required: {
          template: "{label}は必須入力です",
          locales: { "fr-FR": "{label} est obligatoire" },
        },
      },
    };

    const issues = checkConventionsCatalogIntegrity(catalog);
    expect(issues.some((issue) => issue.code === "UNKNOWN_MSG_LOCALE")).toBe(true);
  });

  it("catalog without i18n block remains valid", () => {
    const catalog: ConventionsCatalog = {
      version: "1.0.0",
      msg: {
        required: {
          template: "{label}は必須入力です",
          locales: { "en-US": "{label} is required" },
        },
      },
    };

    expect(checkConventionsCatalogIntegrity(catalog)).toHaveLength(0);
  });

  it("msg entry without locales remains valid (downward compatibility)", () => {
    const catalog: ConventionsCatalog = {
      version: "1.0.0",
      i18n: {
        supportedLocales: ["ja-JP", "en-US"],
        defaultLocale: "ja-JP",
      },
      msg: {
        required: {
          template: "{label}は必須入力です",
          params: ["label"],
        },
      },
    };

    expect(checkConventionsCatalogIntegrity(catalog)).toHaveLength(0);
  });
});

function makeScreenItemsDocument(partial: Partial<ScreenItemsDocument>): ScreenItemsDocument {
  return {
    screenId: "scr1" as ScreenId,
    updatedAt: "2026-01-01T00:00:00Z" as Timestamp,
    items: [],
    ...partial,
  };
}

const id = (s: string) => s as Identifier;

describe("checkScreenItemConventionReferences", () => {
  const catalog = loadCatalog();

  it("catalog が null なら空配列", () => {
    const file = makeScreenItemsDocument({ items: [{ id: id("email"), label: "メール", type: "string", pattern: "@conv.regex.email-simple" }] });
    expect(checkScreenItemConventionReferences(file, null)).toHaveLength(0);
  });

  it("items が空なら空配列", () => {
    expect(checkScreenItemConventionReferences(makeScreenItemsDocument({}), catalog)).toHaveLength(0);
  });

  it("pattern に実在する @conv.regex.* を書くとエラーなし", () => {
    const file = makeScreenItemsDocument({
      items: [{ id: id("phone"), label: "電話", type: "string", pattern: "@conv.regex.phone-jp" }],
    });
    const issues = checkScreenItemConventionReferences(file, catalog);
    expect(issues).toHaveLength(0);
  });

  it("pattern に存在しない @conv.regex を書くと UNKNOWN_CONV_REGEX", () => {
    const file = makeScreenItemsDocument({
      items: [{ id: id("f"), label: "F", type: "string", pattern: "@conv.regex.no-such-key" }],
    });
    const issues = checkScreenItemConventionReferences(file, catalog);
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe("UNKNOWN_CONV_REGEX");
    expect(issues[0].path).toBe("items[0].pattern");
  });

  it("errorMessages.required に存在しない @conv.msg を書くと UNKNOWN_CONV_MSG", () => {
    const file = makeScreenItemsDocument({
      items: [{ id: id("f"), label: "F", type: "string", errorMessages: { required: "@conv.msg.no-such-msg" } }],
    });
    const issues = checkScreenItemConventionReferences(file, catalog);
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe("UNKNOWN_CONV_MSG");
    expect(issues[0].path).toBe("items[0].errorMessages.required");
  });

  it("pattern に @conv 参照なし (直接正規表現) はエラーなし", () => {
    const file = makeScreenItemsDocument({
      items: [{ id: id("f"), label: "F", type: "string", pattern: "^[0-9]+$" }],
    });
    expect(checkScreenItemConventionReferences(file, catalog)).toHaveLength(0);
  });

  it("複数 items に問題があれば全件返す", () => {
    const file = makeScreenItemsDocument({
      items: [
        { id: id("f1"), label: "F1", type: "string", pattern: "@conv.regex.bad1" },
        { id: id("f2"), label: "F2", type: "string", errorMessages: { maxLength: "@conv.msg.bad2" } },
      ],
    });
    const issues = checkScreenItemConventionReferences(file, catalog);
    expect(issues).toHaveLength(2);
    expect(issues[0].path).toBe("items[0].pattern");
    expect(issues[1].path).toBe("items[1].errorMessages.maxLength");
  });
});

describe("#734 screen-item Ref フィールド検証", () => {
  // catalog に limit.cartItemMaxQuantity (value: 999) が存在することを前提とする inline catalog
  const catalog: ConventionsCatalog = {
    version: "1.0.0",
    limit: {
      cartItemMaxQuantity: { value: 999, unit: "integer" },
      productCodeMaxLength: { value: 20, unit: "char" },
    },
  };

  it("items[].maxRef が @conv.limit.<key> として参照存在検査 — 有効 key → pass", () => {
    const file = makeScreenItemsDocument({
      items: [{ id: id("qty"), label: "数量", type: "integer", maxRef: "@conv.limit.cartItemMaxQuantity" }],
    });
    const issues = checkScreenItemConventionReferences(file, catalog);
    expect(issues).toHaveLength(0);
  });

  it("items[].maxRef に未登録 key → UNKNOWN_CONV_LIMIT 検出", () => {
    const file = makeScreenItemsDocument({
      items: [{ id: id("qty"), label: "数量", type: "integer", maxRef: "@conv.limit.noSuchKey" }],
    });
    const issues = checkScreenItemConventionReferences(file, catalog);
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe("UNKNOWN_CONV_LIMIT");
    expect(issues[0].path).toBe("items[0].maxRef");
  });

  it("items[].minRef が @conv.limit.<key> として参照存在検査 — 有効 key → pass", () => {
    const file = makeScreenItemsDocument({
      items: [{ id: id("qty"), label: "数量", type: "integer", minRef: "@conv.limit.cartItemMaxQuantity" }],
    });
    const issues = checkScreenItemConventionReferences(file, catalog);
    expect(issues).toHaveLength(0);
  });

  it("items[].minRef に未登録 key → UNKNOWN_CONV_LIMIT 検出", () => {
    const file = makeScreenItemsDocument({
      items: [{ id: id("qty"), label: "数量", type: "integer", minRef: "@conv.limit.noSuchKey" }],
    });
    const issues = checkScreenItemConventionReferences(file, catalog);
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe("UNKNOWN_CONV_LIMIT");
    expect(issues[0].path).toBe("items[0].minRef");
  });

  it("items[].maxLengthRef が @conv.limit.<key> として参照存在検査 — 有効 key → pass", () => {
    const file = makeScreenItemsDocument({
      items: [{ id: id("code"), label: "コード", type: "string", maxLengthRef: "@conv.limit.productCodeMaxLength" }],
    });
    const issues = checkScreenItemConventionReferences(file, catalog);
    expect(issues).toHaveLength(0);
  });

  it("items[].maxLengthRef に未登録 key → UNKNOWN_CONV_LIMIT 検出", () => {
    const file = makeScreenItemsDocument({
      items: [{ id: id("code"), label: "コード", type: "string", maxLengthRef: "@conv.limit.noSuchKey" }],
    });
    const issues = checkScreenItemConventionReferences(file, catalog);
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe("UNKNOWN_CONV_LIMIT");
    expect(issues[0].path).toBe("items[0].maxLengthRef");
  });

  it("items[].minLengthRef が @conv.limit.<key> として参照存在検査 — 有効 key → pass", () => {
    const file = makeScreenItemsDocument({
      items: [{ id: id("code"), label: "コード", type: "string", minLengthRef: "@conv.limit.cartItemMaxQuantity" }],
    });
    const issues = checkScreenItemConventionReferences(file, catalog);
    expect(issues).toHaveLength(0);
  });

  it("items[].minLengthRef に未登録 key → UNKNOWN_CONV_LIMIT 検出", () => {
    const file = makeScreenItemsDocument({
      items: [{ id: id("code"), label: "コード", type: "string", minLengthRef: "@conv.limit.noSuchKey" }],
    });
    const issues = checkScreenItemConventionReferences(file, catalog);
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe("UNKNOWN_CONV_LIMIT");
    expect(issues[0].path).toBe("items[0].minLengthRef");
  });

  it("Ref フィールドが文字列でない場合 (undefined) は検査スキップ", () => {
    const file = makeScreenItemsDocument({
      items: [{ id: id("qty"), label: "数量", type: "integer" }],
    });
    const issues = checkScreenItemConventionReferences(file, catalog);
    expect(issues).toHaveLength(0);
  });
});

describe("#734 checkStep — validation rules[].minRef/maxRef/lengthRef 検査", () => {
  // checkConventionReferences 経由で checkStep 内の rules Ref フィールドを検査する
  const catalog: ConventionsCatalog = {
    version: "1.0.0",
    limit: {
      cartItemMaxQuantity: { value: 999, unit: "integer" },
    },
    regex: {},
  };

  it("rules[].lengthRef が未登録 → UNKNOWN_CONV_LIMIT 検出 (#734 review S-1)", () => {
    const issues = checkConventionReferences(
      makeGroup({
        actions: [{
          id: "a1", name: "f", trigger: "click",
          steps: [{
            id: "s1", kind: "validation", description: "", conditions: "",
            rules: [{ field: "x", type: "maxLength", message: "エラー", lengthRef: "@conv.limit.unknownKey" }],
          }],
        }],
      }),
      catalog,
    );
    expect(issues.length).toBeGreaterThanOrEqual(1);
    const hit = issues.find((i) => i.path === "actions[0].steps[0].rules[0].lengthRef");
    expect(hit).toBeDefined();
    expect(hit?.code).toBe("UNKNOWN_CONV_LIMIT");
  });

  it("rules[].minRef が未登録 → UNKNOWN_CONV_LIMIT 検出 (#734 review S-1)", () => {
    const issues = checkConventionReferences(
      makeGroup({
        actions: [{
          id: "a1", name: "f", trigger: "click",
          steps: [{
            id: "s1", kind: "validation", description: "", conditions: "",
            rules: [{ field: "x", type: "min", message: "エラー", minRef: "@conv.limit.unknownKey" }],
          }],
        }],
      }),
      catalog,
    );
    expect(issues.length).toBeGreaterThanOrEqual(1);
    const hit = issues.find((i) => i.path === "actions[0].steps[0].rules[0].minRef");
    expect(hit).toBeDefined();
    expect(hit?.code).toBe("UNKNOWN_CONV_LIMIT");
  });

  it("rules[].maxRef が未登録 → UNKNOWN_CONV_LIMIT 検出 (#734 review S-1)", () => {
    const issues = checkConventionReferences(
      makeGroup({
        actions: [{
          id: "a1", name: "f", trigger: "click",
          steps: [{
            id: "s1", kind: "validation", description: "", conditions: "",
            rules: [{ field: "x", type: "max", message: "エラー", maxRef: "@conv.limit.unknownKey" }],
          }],
        }],
      }),
      catalog,
    );
    expect(issues.length).toBeGreaterThanOrEqual(1);
    const hit = issues.find((i) => i.path === "actions[0].steps[0].rules[0].maxRef");
    expect(hit).toBeDefined();
    expect(hit?.code).toBe("UNKNOWN_CONV_LIMIT");
  });

  it("rules[].patternRef が未登録 → UNKNOWN_CONV_REGEX 検出", () => {
    const issues = checkConventionReferences(
      makeGroup({
        actions: [{
          id: "a1", name: "f", trigger: "click",
          steps: [{
            id: "s1", kind: "validation", description: "", conditions: "",
            rules: [{ field: "x", type: "pattern", message: "エラー", patternRef: "@conv.regex.unknownKey" }],
          }],
        }],
      }),
      catalog,
    );
    expect(issues.length).toBeGreaterThanOrEqual(1);
    const hit = issues.find((i) => i.path === "actions[0].steps[0].rules[0].patternRef");
    expect(hit).toBeDefined();
    expect(hit?.code).toBe("UNKNOWN_CONV_REGEX");
  });
});

describe("#783 context.catalogs.domains.constraints[].patternRef 検証", () => {
  const catalog: ConventionsCatalog = {
    version: "1.0.0",
    regex: {
      productCode: { pattern: "^P-[0-9]{4,6}$" },
    },
  };

  it("domains.constraints[].patternRef に実在する @conv.regex.* を書くとエラーなし", () => {
    const issues = checkConventionReferences(
      makeGroup({
        context: {
          catalogs: {
            domains: {
              ProductCode: {
                type: "string",
                constraints: [
                  { field: "productCode", type: "regex", patternRef: "@conv.regex.productCode", severity: "error" },
                ],
              },
            },
          },
        },
      } as Partial<ProcessFlow>),
      catalog,
    );
    expect(issues).toHaveLength(0);
  });

  it("domains.constraints[].patternRef に存在しない @conv.regex.* を書くと UNKNOWN_CONV_REGEX 検出", () => {
    const issues = checkConventionReferences(
      makeGroup({
        context: {
          catalogs: {
            domains: {
              ProductCode: {
                type: "string",
                constraints: [
                  { field: "productCode", type: "regex", patternRef: "@conv.regex.unknownKey", severity: "error" },
                ],
              },
            },
          },
        },
      } as Partial<ProcessFlow>),
      catalog,
    );
    expect(issues).toHaveLength(1);
    const hit = issues[0];
    expect(hit.code).toBe("UNKNOWN_CONV_REGEX");
    expect(hit.path).toBe("context.catalogs.domains.ProductCode.constraints[0].patternRef");
  });

  it("domains.constraints[].message に @conv.msg.* がある場合も検証される", () => {
    const catalogWithMsg: ConventionsCatalog = {
      version: "1.0.0",
      regex: { productCode: { pattern: "^P-[0-9]{4,6}$" } },
      msg: { required: { template: "必須です", params: [] } },
    };
    const issues = checkConventionReferences(
      makeGroup({
        context: {
          catalogs: {
            domains: {
              ProductCode: {
                type: "string",
                constraints: [
                  { field: "productCode", type: "regex", patternRef: "@conv.regex.productCode", severity: "error", message: "@conv.msg.unknownMsg" },
                ],
              },
            },
          },
        },
      } as Partial<ProcessFlow>),
      catalogWithMsg,
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe("UNKNOWN_CONV_MSG");
    expect(issues[0].path).toBe("context.catalogs.domains.ProductCode.constraints[0].message");
  });

  it("domains が undefined の場合は検査スキップ (既存テスト不変)", () => {
    const issues = checkConventionReferences(makeGroup({}), catalog);
    expect(issues).toHaveLength(0);
  });

  it("domains.constraints[].minRef に存在しない @conv.limit.* を書くと UNKNOWN_CONV_LIMIT 検出", () => {
    const catalogWithLimit: ConventionsCatalog = {
      version: "1.0.0",
      limit: { quantityMin: { value: 1, unit: "integer" } },
    };
    const issues = checkConventionReferences(
      makeGroup({
        context: {
          catalogs: {
            domains: {
              Quantity: {
                type: "integer",
                constraints: [
                  { field: "quantity", type: "min", minRef: "@conv.limit.unknownMin", severity: "error" },
                ],
              },
            },
          },
        },
      } as Partial<ProcessFlow>),
      catalogWithLimit,
    );
    expect(issues.length).toBeGreaterThanOrEqual(1);
    const hit = issues.find((i) => i.path === "context.catalogs.domains.Quantity.constraints[0].minRef");
    expect(hit).toBeDefined();
    expect(hit?.code).toBe("UNKNOWN_CONV_LIMIT");
  });

  it("domains.constraints[].maxRef に存在しない @conv.limit.* を書くと UNKNOWN_CONV_LIMIT 検出", () => {
    const catalogWithLimit: ConventionsCatalog = {
      version: "1.0.0",
      limit: { quantityMax: { value: 9999, unit: "integer" } },
    };
    const issues = checkConventionReferences(
      makeGroup({
        context: {
          catalogs: {
            domains: {
              Quantity: {
                type: "integer",
                constraints: [
                  { field: "quantity", type: "max", maxRef: "@conv.limit.unknownMax", severity: "error" },
                ],
              },
            },
          },
        },
      } as Partial<ProcessFlow>),
      catalogWithLimit,
    );
    expect(issues.length).toBeGreaterThanOrEqual(1);
    const hit = issues.find((i) => i.path === "context.catalogs.domains.Quantity.constraints[0].maxRef");
    expect(hit).toBeDefined();
    expect(hit?.code).toBe("UNKNOWN_CONV_LIMIT");
  });

  it("domains.constraints[].lengthRef に存在しない @conv.limit.* を書くと UNKNOWN_CONV_LIMIT 検出", () => {
    const catalogWithLimit: ConventionsCatalog = {
      version: "1.0.0",
      limit: { nameMax: { value: 100, unit: "char" } },
    };
    const issues = checkConventionReferences(
      makeGroup({
        context: {
          catalogs: {
            domains: {
              ProductName: {
                type: "string",
                constraints: [
                  { field: "name", type: "maxLength", lengthRef: "@conv.limit.unknownLength", severity: "error" },
                ],
              },
            },
          },
        },
      } as Partial<ProcessFlow>),
      catalogWithLimit,
    );
    expect(issues.length).toBeGreaterThanOrEqual(1);
    const hit = issues.find((i) => i.path === "context.catalogs.domains.ProductName.constraints[0].lengthRef");
    expect(hit).toBeDefined();
    expect(hit?.code).toBe("UNKNOWN_CONV_LIMIT");
  });
});

