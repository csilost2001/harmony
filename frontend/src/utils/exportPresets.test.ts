import { describe, it, expect } from "vitest";
import { MAX_EXPORT_PRESETS, buildDesignDocument, parseDocTemplate, type DesignDocInput, type ExportPreset } from "@harmony/shared";
import { inputForPreset, presetFromInput, removePreset, upsertPreset } from "./exportPresets";

const input: DesignDocInput = { project: { name: "P" }, screens: [], flows: [], tables: [], version: "1.0", generatedAt: "2026-10-17T00:00:00.000Z" } as unknown as DesignDocInput;
const p = (name: string, format: ExportPreset["format"] = "html", ex: string[] = []): ExportPreset => ({ name, format, excludeChapters: ex });

describe("upsertPreset / removePreset", () => {
  it("同じ名前は置き換え、新しい名前は足す。空の名前・長すぎる名前・上限超えは null", () => {
    const a = upsertPreset([], p("納品用", "docx", ["crud"]))!;
    expect(upsertPreset(a, p("納品用", "xlsx"))!.map((x) => x.format)).toEqual(["xlsx"]);
    expect(upsertPreset(a, p("社内レビュー"))!.map((x) => x.name)).toEqual(["納品用", "社内レビュー"]);
    expect(upsertPreset(a, p(" "))).toBeNull();
    expect(upsertPreset(a, p("あ".repeat(41)))).toBeNull();
    const full = Array.from({ length: MAX_EXPORT_PRESETS }, (_, i) => p(`n${i}`));
    expect(upsertPreset(full, p("新しい"))).toBeNull();
    expect(upsertPreset(full, p("n0", "docx"))).not.toBeNull(); // 置き換えは、満杯でもできる
  });
  it("削除", () => { expect(removePreset([p("a"), p("b")], "a").map((x) => x.name)).toEqual(["b"]); });
});

describe("inputForPreset", () => {
  it("載せない章だけ差し替え、体裁のほかの項目は保つ", () => {
    const base = { ...input, template: parseDocTemplate({ documentTitle: "要件定義書", excludeChapters: ["messages"] }).template };
    const out = inputForPreset(base, p("x", "html", ["crud"]));
    expect(out.template).toMatchObject({ documentTitle: "要件定義書", excludeChapters: ["crud"] });
    expect(base.template.excludeChapters).toEqual(["messages"]); // 元は変えない
    expect(buildDesignDocument(out).html).toContain("要件定義書");
  });
  it("体裁が無くても使える。いまの体裁から設定を作れる", () => {
    expect(inputForPreset(input, p("x", "html", ["crud"])).template?.excludeChapters).toEqual(["crud"]);
    expect(presetFromInput(" 納品 ", "docx", { ...input, template: parseDocTemplate({ excludeChapters: ["crud"] }).template })).toEqual({ name: "納品", format: "docx", excludeChapters: ["crud"] });
  });
});

describe("parseDocTemplate の書き出しの設定", () => {
  it("読める設定は残し、読めないもの・重複は理由つきで捨てる", () => {
    const r = parseDocTemplate({ exportPresets: [{ name: "a", format: "docx", excludeChapters: ["crud", "BAD!"] }, { name: "a", format: "html" }, { name: "b", format: "pdf" }, { format: "html" }] });
    expect(r.template.exportPresets).toEqual([{ name: "a", format: "docx", excludeChapters: ["crud"] }]);
    expect(r.problems).toHaveLength(3);
  });
  it("設定が無ければ項目も無い", () => { expect(parseDocTemplate({}).template.exportPresets).toBeUndefined(); });
});
