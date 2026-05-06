import { describe, it, expect } from "vitest";
import type { ProcessFlow, ValidationRule, ValidationStep } from "./action";
import { migrateProcessFlow } from "../utils/actionMigration";

describe("ValidationStep の rules[] (#166)", () => {
  it("required / regex / maxLength を同一ステップで定義できる", () => {
    const rules: ValidationRule[] = [
      { field: "email", type: "required", message: "@conv.msg.required" },
      { field: "email", type: "regex", pattern: "@conv.regex.email-simple", message: "@conv.msg.invalidFormat" },
      { field: "email", type: "maxLength", length: 255, message: "@conv.msg.maxLength" },
      { field: "phone", type: "required" },
      { field: "phone", type: "regex", pattern: "@conv.regex.phone-jp" },
    ];
    const step: ValidationStep = {
      id: "s", type: "validation", description: "",
      conditions: "emailとphoneの検証",
      rules,
    };
    expect(step.rules).toHaveLength(5);
    expect(step.rules![0]).toEqual({ field: "email", type: "required", message: "@conv.msg.required" });
    expect(step.rules![1].pattern).toBe("@conv.regex.email-simple");
    expect(step.rules![2].length).toBe(255);
  });

  it("range / enum / custom の各ルールタイプを表現できる", () => {
    const rules: ValidationRule[] = [
      { field: "quantity", type: "range", min: 1, max: 9999, message: "@conv.msg.outOfRange" },
      { field: "paymentMethod", type: "enum", values: ["credit_card", "bank_transfer", "cash_on_delivery"] },
      { field: "items", type: "custom", condition: "@items.length >= 1", message: "明細は1件以上必要です" },
    ];
    expect(rules[0].min).toBe(1);
    expect(rules[0].max).toBe(9999);
    expect(rules[1].values).toContain("credit_card");
    expect(rules[2].condition).toBe("@items.length >= 1");
  });

  it("conditions と rules[] は併用可能 (後方互換)", () => {
    const step: ValidationStep = {
      id: "s", type: "validation", description: "",
      conditions: "人間可読の自由記述",
      rules: [{ field: "x", type: "required" }],
    };
    expect(step.conditions).toBe("人間可読の自由記述");
    expect(step.rules).toHaveLength(1);
  });

  it("rules[] 省略時は conditions のみ (旧データ互換)", () => {
    const step: ValidationStep = {
      id: "s", type: "validation", description: "",
      conditions: "既存の自由記述のみ",
    };
    expect(step.rules).toBeUndefined();
  });

  it("inlineBranch と併用できる", () => {
    const step: ValidationStep = {
      id: "s", type: "validation", description: "",
      conditions: "",
      rules: [{ field: "a", type: "required" }],
      inlineBranch: { ok: "続行", ng: "エラー表示" },
    };
    expect(step.inlineBranch?.ok).toBe("続行");
    expect(step.rules).toHaveLength(1);
  });
});

describe("migrateProcessFlow — ValidationStep.rules[] 透過保持 (#166)", () => {
  it("rules[] を持つ ValidationStep を冪等にマイグレーションできる", () => {
    const raw = {
      id: "g", name: "x", type: "screen", description: "",
      actions: [{
        id: "a", name: "a", trigger: "submit",
        steps: [{
          id: "s", type: "validation", description: "",
          conditions: "旧 conditions",
          rules: [
            { field: "email", type: "required" },
            { field: "email", type: "regex", pattern: "@conv.regex.email-simple" },
          ],
          inlineBranch: { ok: "ok", ng: "ng" },
        }],
      }],
      createdAt: "", updatedAt: "",
    };
    const once = migrateProcessFlow(raw) as ProcessFlow;
    const twice = migrateProcessFlow(once);
    expect(JSON.stringify(twice)).toBe(JSON.stringify(once));
    const step = once.actions[0].steps[0] as ValidationStep;
    expect(step.rules).toHaveLength(2);
    expect(step.rules?.[1].pattern).toBe("@conv.regex.email-simple");
    expect(step.conditions).toBe("旧 conditions");
  });

  it("rules[] なしの旧 ValidationStep でも破壊なし", () => {
    const raw = {
      id: "g", name: "x", type: "screen", description: "",
      actions: [{
        id: "a", name: "a", trigger: "submit",
        steps: [{
          id: "s", type: "validation", description: "",
          conditions: "旧",
          inlineBranch: { ok: "o", ng: "n" },
        }],
      }],
      createdAt: "", updatedAt: "",
    };
    const migrated = migrateProcessFlow(raw) as ProcessFlow;
    const step = migrated.actions[0].steps[0] as ValidationStep;
    expect(step.rules).toBeUndefined();
    expect(step.conditions).toBe("旧");
  });
});
