import { describe, it, expect, beforeEach } from "vitest";
import {
  SNIPPETS_MAX, SNIPPET_ITEMS_MAX, SNIPPET_NAME_MAX, _resetSnippetsCache, addSnippet, exportSnippets, importSnippets, loadSnippets,
  parseSnippets, removeSnippet, sanitizeSnippet,
} from "./snippets";

beforeEach(() => { localStorage.clear(); _resetSnippetsCache(); });
const cols = [{ id: "col-01", physicalName: "created_at", name: "作成日時", dataType: "TIMESTAMP" }, { id: "col-02", physicalName: "updated_at", name: "更新日時", dataType: "TIMESTAMP" }];

describe("スニペット", () => {
  it("名前をつけて保存し、読み直しても残る。ワークスペースごとに別", () => {
    const r = addSnippet("a", "columns", "監査列", cols);
    expect(r.ok).toBe(true);
    _resetSnippetsCache();
    expect(loadSnippets("a").map((s) => [s.kind, s.name, s.items.length])).toEqual([["columns", "監査列", 2]]);
    expect(loadSnippets("b")).toEqual([]);
  });

  it("保存した中身は、元の配列と別のもの (あとから元を書き換えても変わらない)", () => {
    const src = [{ id: "x", label: "ラベル" }];
    addSnippet("a", "screen-items", "住所", src);
    src[0].label = "変えた";
    expect(loadSnippets("a")[0].items[0].label).toBe("ラベル");
  });

  it("名前が空・同じ種類で同じ名前・中身が空・多すぎるものは、理由つきで断る。種類が違えば同じ名前でよい", () => {
    expect(addSnippet("a", "columns", "  ", cols)).toEqual({ ok: false, reason: "名前を入れてください" });
    expect(addSnippet("a", "columns", "監査列", cols).ok).toBe(true);
    expect(addSnippet("a", "columns", "監査列", cols)).toEqual({ ok: false, reason: "同じ名前のスニペットがあります" });
    expect(addSnippet("a", "screen-items", "監査列", [{ id: "a" }]).ok).toBe(true);
    expect(addSnippet("a", "columns", "空", [])).toMatchObject({ ok: false });
    const many = Array.from({ length: SNIPPET_ITEMS_MAX + 1 }, (_, i) => ({ id: String(i) }));
    expect(addSnippet("a", "columns", "多い", many)).toMatchObject({ ok: false });
  });

  it("名前は長すぎれば切る。件数の上限を超えたら断る", () => {
    const r = addSnippet("a", "columns", "あ".repeat(SNIPPET_NAME_MAX + 10), cols);
    expect(r.ok && r.snippet.name.length).toBe(SNIPPET_NAME_MAX);
    for (let i = 0; i < SNIPPETS_MAX; i++) addSnippet("b", "columns", `n${i}`, cols);
    expect(loadSnippets("b")).toHaveLength(SNIPPETS_MAX);
    expect(addSnippet("b", "columns", "あふれ", cols)).toMatchObject({ ok: false });
  });

  it("削除できる。壊れた保存値・形の違うものは捨てる", () => {
    const r = addSnippet("a", "columns", "監査列", cols);
    if (!r.ok) throw new Error("保存できない");
    removeSnippet("a", r.snippet.id);
    expect(loadSnippets("a")).toEqual([]);
    expect(parseSnippets("{broken")).toEqual([]);
    expect(parseSnippets(JSON.stringify([{ kind: "nope", name: "x", items: [{}] }, { kind: "columns", name: "ok", items: [{ id: "a" }] }, { kind: "columns", name: "", items: [{}] }, { kind: "columns", name: "n", items: ["str"] }])).map((s) => s.name)).toEqual(["ok"]);
    expect(sanitizeSnippet(null)).toBeNull();
  });
});

describe("書き出しと読み込み", () => {
  it("書き出したものを、別のワークスペースへ読み込める。同じ種類・同じ名前は飛ばす", () => {
    addSnippet("a", "columns", "監査列", cols);
    addSnippet("a", "steps", "検証", [{ id: "s1", type: "validation" }]);
    const text = exportSnippets("a");
    expect(JSON.parse(text)).toMatchObject({ format: "harmony-snippets", version: 1 });
    expect(importSnippets("b", text)).toEqual({ added: 2, skipped: 0 });
    expect(importSnippets("b", text)).toEqual({ added: 0, skipped: 2 });
    expect(loadSnippets("b").map((s) => s.name).sort()).toEqual(["検証", "監査列"]);
  });

  it("種類を指定して書き出せる", () => {
    addSnippet("a", "columns", "監査列", cols);
    addSnippet("a", "steps", "検証", [{ id: "s1" }]);
    expect(JSON.parse(exportSnippets("a", "steps")).snippets.map((s: { name: string }) => s.name)).toEqual(["検証"]);
  });

  it("壊れたファイル・別の形式のファイル・形の違う行は、理由を返すか飛ばす (何も壊さない)", () => {
    expect(importSnippets("a", "{broken").error).toBe("JSON として読めません");
    expect(importSnippets("a", JSON.stringify({ hello: 1 })).error).toBe("Harmony のスニペットのファイルではありません");
    const mixed = JSON.stringify({ format: "harmony-snippets", version: 1, snippets: [{ kind: "columns", name: "良い", items: [{ id: "a" }] }, { kind: "bad" }, 5] });
    expect(importSnippets("a", mixed)).toEqual({ added: 1, skipped: 2 });
  });

  it("読み込みでは、ファイルにある id は使わず、新しく付ける (既存と衝突しない)", () => {
    const first = addSnippet("a", "columns", "監査列", cols);
    if (!first.ok) throw new Error("保存できない");
    const text = JSON.stringify({ format: "harmony-snippets", version: 1, snippets: [{ id: first.snippet.id, kind: "columns", name: "別名", items: [{ id: "a" }] }] });
    expect(importSnippets("a", text).added).toBe(1);
    expect(new Set(loadSnippets("a").map((s) => s.id)).size).toBe(2);
  });
});
