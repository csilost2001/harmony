import { describe, it, expect } from "vitest";
import type { OutputBinding } from "../types/action";
import {
  getBindingName,
  getBindingOperation,
  isStructuredBinding,
} from "./outputBinding";

describe("getBindingName", () => {
  it("string 形式はそのまま返す", () => {
    expect(getBindingName("duplicates")).toBe("duplicates");
  });

  it("object 形式は .name を返す", () => {
    expect(getBindingName({ name: "shortageList", operation: "push" })).toBe("shortageList");
  });

  it("undefined は undefined", () => {
    expect(getBindingName(undefined)).toBeUndefined();
  });

  it("空白のみは undefined として扱う", () => {
    expect(getBindingName("   ")).toBeUndefined();
    expect(getBindingName({ name: "  ", operation: "assign" })).toBeUndefined();
  });
});

describe("getBindingOperation", () => {
  it("string 形式は 'assign' 既定", () => {
    expect(getBindingOperation("users")).toBe("assign");
  });

  it("object 形式で operation 未指定は 'assign'", () => {
    expect(getBindingOperation({ name: "x" })).toBe("assign");
  });

  it("object 形式で operation 明示時はその値", () => {
    expect(getBindingOperation({ name: "subtotal", operation: "accumulate" })).toBe("accumulate");
    expect(getBindingOperation({ name: "list", operation: "push" })).toBe("push");
  });

  it("undefined は 'assign'", () => {
    expect(getBindingOperation(undefined)).toBe("assign");
  });
});

describe("isStructuredBinding", () => {
  it("string は false", () => {
    expect(isStructuredBinding("users")).toBe(false);
  });

  it("object は true", () => {
    expect(isStructuredBinding({ name: "x" })).toBe(true);
  });

  it("undefined は false", () => {
    expect(isStructuredBinding(undefined)).toBe(false);
  });
});

describe("OutputBinding union の運用パターン", () => {
  it("typical accumulation: 小計の累積", () => {
    const binding: OutputBinding = { name: "subtotal", operation: "accumulate" };
    expect(getBindingName(binding)).toBe("subtotal");
    expect(getBindingOperation(binding)).toBe("accumulate");
  });

  it("typical push: 配列の要素追加", () => {
    const binding: OutputBinding = { name: "enrichedItems", operation: "push" };
    expect(getBindingName(binding)).toBe("enrichedItems");
    expect(getBindingOperation(binding)).toBe("push");
  });

  it("typical assign: 単純代入 (string 形式で十分)", () => {
    const binding: OutputBinding = "authResult";
    expect(getBindingName(binding)).toBe("authResult");
    expect(getBindingOperation(binding)).toBe("assign");
  });
});
