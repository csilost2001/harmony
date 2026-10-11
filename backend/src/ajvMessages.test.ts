import { describe, it, expect } from "vitest";
import { describeAjvError, selectAjvErrors } from "./ajvMessages.js";

const e = (keyword: string, params: Record<string, unknown> = {}, instancePath = "/meta", message = "english") => ({ keyword, params, instancePath, message } as never);

describe("スキーマ違反の日本語化", () => {
  it("必須の項目・定義にない項目・型・選択肢", () => {
    expect(describeAjvError(e("required", { missingProperty: "screenId" }))).toBe("「/meta」に、必須の項目「screenId」がありません");
    expect(describeAjvError(e("additionalProperties", { additionalProperty: "foo" }))).toContain("定義にない項目「foo」");
    expect(describeAjvError(e("type", { type: "string" }))).toContain("型が違います (string");
    expect(describeAjvError(e("enum", { allowedValues: ["a", "b"] }))).toContain("a / b");
  });
  it("桁・範囲・件数", () => {
    expect(describeAjvError(e("maxLength", { limit: 10 }))).toContain("10 文字まで");
    expect(describeAjvError(e("minimum", { limit: 1 }))).toContain("1 以上");
    expect(describeAjvError(e("minItems", { limit: 2 }))).toContain("2 件以上");
  });
  it("ルート (パスなし) は「全体」、知らない種類は元の文を残す", () => {
    expect(describeAjvError(e("required", { missingProperty: "id" }, ""))).toBe("全体に、必須の項目「id」がありません");
    expect(describeAjvError(e("weird", {}, "/a/b", "must be odd"))).toContain("must be odd");
  });
  it("if の副次的な違反は、元の違反があれば除く", () => {
    const list = [e("required"), e("if")];
    expect(selectAjvErrors(list).map((x: { keyword: string }) => x.keyword)).toEqual(["required"]);
    expect(selectAjvErrors([e("if")]).length).toBe(1);
  });
});
