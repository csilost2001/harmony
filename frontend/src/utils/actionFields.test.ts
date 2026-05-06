import { describe, it, expect } from "vitest";
import type { ActionFields, StructuredField } from "../types/action";
import {
  fieldsToText,
  isStructuredFields,
  textToStructuredFields,
} from "./actionFields";

describe("isStructuredFields", () => {
  it("string の場合は false", () => {
    expect(isStructuredFields("userId\npassword")).toBe(false);
  });

  it("配列の場合は true", () => {
    const v: StructuredField[] = [{ name: "userId", type: "string" }];
    expect(isStructuredFields(v)).toBe(true);
  });

  it("undefined の場合は false", () => {
    expect(isStructuredFields(undefined)).toBe(false);
  });

  it("空配列も true (型的に StructuredField[] として扱える)", () => {
    expect(isStructuredFields([])).toBe(true);
  });
});

describe("fieldsToText", () => {
  it("string はそのまま返す", () => {
    expect(fieldsToText("userId\npassword")).toBe("userId\npassword");
  });

  it("undefined は空文字列", () => {
    expect(fieldsToText(undefined)).toBe("");
  });

  it("StructuredField[] は name を改行区切りで連結", () => {
    const v: StructuredField[] = [
      { name: "userId", label: "ユーザーID", type: "string", required: true },
      { name: "password", type: "string" },
    ];
    expect(fieldsToText(v)).toBe("userId\npassword");
  });

  it("空配列は空文字列", () => {
    const v: StructuredField[] = [];
    expect(fieldsToText(v)).toBe("");
  });
});

describe("textToStructuredFields", () => {
  it("改行区切りテキストを StructuredField[] に変換 (type は string 既定)", () => {
    const fields = textToStructuredFields("userId\npassword\nemail");
    expect(fields).toHaveLength(3);
    expect(fields[0]).toEqual({ name: "userId", type: "string" });
    expect(fields[1]).toEqual({ name: "password", type: "string" });
    expect(fields[2]).toEqual({ name: "email", type: "string" });
  });

  it("空白行・前後の空白は無視", () => {
    const fields = textToStructuredFields("  userId  \n\n  password\n");
    expect(fields).toHaveLength(2);
    expect(fields[0].name).toBe("userId");
    expect(fields[1].name).toBe("password");
  });

  it("空文字列は空配列", () => {
    expect(textToStructuredFields("")).toEqual([]);
  });

  it("CRLF 改行も処理できる", () => {
    const fields = textToStructuredFields("a\r\nb\r\nc");
    expect(fields).toHaveLength(3);
  });
});

describe("fieldsToText ↔ textToStructuredFields の往復", () => {
  it("StructuredField[] → text → StructuredField[] で name が保たれる (type は string リセット)", () => {
    const original: StructuredField[] = [
      { name: "userId", label: "ユーザーID", type: "number", required: true, description: "ID" },
      { name: "role", type: { kind: "custom", label: "UserRole" } },
    ];
    const text = fieldsToText(original);
    const roundTripped = textToStructuredFields(text);
    expect(roundTripped.map((f) => f.name)).toEqual(["userId", "role"]);
    // type/label/required/description は text 変換で失われる (既知の仕様)
    expect(roundTripped[0].type).toBe("string");
  });
});

describe("ActionFields union の透過的扱い", () => {
  it("string と StructuredField[] のいずれも fieldsToText / isStructuredFields で判別可能", () => {
    const stringVal: ActionFields = "a\nb";
    const arrayVal: ActionFields = [{ name: "a", type: "string" }];
    expect(isStructuredFields(stringVal)).toBe(false);
    expect(isStructuredFields(arrayVal)).toBe(true);
    expect(fieldsToText(stringVal)).toBe("a\nb");
    expect(fieldsToText(arrayVal)).toBe("a");
  });
});
