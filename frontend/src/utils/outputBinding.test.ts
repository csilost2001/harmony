import { describe, it, expect } from "vitest";
import type { OutputBinding, Identifier } from "../types/v3";
import {
  getBindingName,
  getBindingOperation,
  isStructuredBinding,
} from "./outputBinding";

// #1016 follow-up (2026-05-20): v3 OutputBinding は object 形式のみ (string 短縮形は v1/v2 で廃止)

describe("getBindingName", () => {
  it("object 形式は .name を返す", () => {
    expect(getBindingName({ name: "shortageList" as Identifier, operation: "push" })).toBe("shortageList");
  });

  it("undefined は undefined", () => {
    expect(getBindingName(undefined)).toBeUndefined();
  });

  it("空白のみは undefined として扱う", () => {
    expect(getBindingName({ name: "  " as Identifier, operation: "assign" })).toBeUndefined();
  });
});

describe("getBindingOperation", () => {
  it("object 形式で operation 未指定は 'assign'", () => {
    expect(getBindingOperation({ name: "x" as Identifier })).toBe("assign");
  });

  it("object 形式で operation 明示時はその値", () => {
    expect(getBindingOperation({ name: "subtotal" as Identifier, operation: "accumulate" })).toBe("accumulate");
    expect(getBindingOperation({ name: "list" as Identifier, operation: "push" })).toBe("push");
  });

  it("undefined は 'assign'", () => {
    expect(getBindingOperation(undefined)).toBe("assign");
  });
});

describe("isStructuredBinding", () => {
  it("object は true (v3 では全て構造化)", () => {
    expect(isStructuredBinding({ name: "x" as Identifier })).toBe(true);
  });

  it("undefined は false", () => {
    expect(isStructuredBinding(undefined)).toBe(false);
  });
});

describe("OutputBinding 運用パターン", () => {
  it("typical accumulation: 小計の累積", () => {
    const binding: OutputBinding = { name: "subtotal" as Identifier, operation: "accumulate" };
    expect(getBindingName(binding)).toBe("subtotal");
    expect(getBindingOperation(binding)).toBe("accumulate");
  });

  it("typical push: 配列の要素追加", () => {
    const binding: OutputBinding = { name: "enrichedItems" as Identifier, operation: "push" };
    expect(getBindingName(binding)).toBe("enrichedItems");
    expect(getBindingOperation(binding)).toBe("push");
  });

  it("typical assign: 単純代入 (operation 未指定 → 'assign' 既定)", () => {
    const binding: OutputBinding = { name: "authResult" as Identifier };
    expect(getBindingName(binding)).toBe("authResult");
    expect(getBindingOperation(binding)).toBe("assign");
  });
});
