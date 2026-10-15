import { describe, it, expect, beforeEach } from "vitest";
import { collectHits, isEditorPath, fieldText } from "./editorFind";

function mount(html: string): HTMLElement {
  document.body.innerHTML = `<div id="root">${html}</div>`;
  return document.getElementById("root")!;
}

describe("collectHits", () => {
  beforeEach(() => { document.body.innerHTML = ""; });

  it("入力欄・テキスト欄・選択欄の値と、画面の文字を探す。全角半角・大文字小文字を無視する", () => {
    const root = mount(`
      <label>顧客名<input value="ＣＵＳＴＯＭＥＲ" /></label>
      <textarea>customer note</textarea>
      <select><option value="a">顧客コード</option><option value="b">other</option></select>
      <p>顧客の一覧</p>
    `);
    const hits = collectHits(root, "customer");
    expect(hits.filter((h) => h.kind === "field")).toHaveLength(2);
    const ja = collectHits(root, "顧客");
    expect(ja.filter((h) => h.kind === "field")).toHaveLength(1); // 選択欄 (顧客コード)
    expect(ja.filter((h) => h.kind === "text").length).toBeGreaterThanOrEqual(2); // ラベルと段落
  });

  it("空の検索語は何も返さない / 見えていない・data-find-ignore の中は探さない / 欄の中の文字は二重に数えない", () => {
    const root = mount(`
      <input value="abc" hidden />
      <div data-find-ignore><input value="abc" /><span>abc</span></div>
      <textarea>abc</textarea>
    `);
    expect(collectHits(root, "")).toEqual([]);
    // jsdom は getClientRects を持たないため、hidden 属性で見えない扱いを確認する
    const hits = collectHits(root, "abc");
    expect(hits.filter((h) => h.kind === "field")).toHaveLength(1);
    expect(hits.filter((h) => h.kind === "text")).toHaveLength(0);
  });

  it("同じ文字列が 1 つの文の中に複数あれば、それぞれを数える", () => {
    const root = mount("<p>abc abc abc</p>");
    expect(collectHits(root, "abc")).toHaveLength(3);
  });

  it("上限 (500 件) で止まる", () => {
    const root = mount(`<p>${"x ".repeat(2000)}</p>`);
    expect(collectHits(root, "x").length).toBe(500);
  });

  it("fieldText: 選択欄は選ばれている項目の名前", () => {
    const root = mount(`<select><option value="a">A 名</option><option value="b" selected>B 名</option></select>`);
    expect(fieldText(root.querySelector("select")!)).toBe("B 名");
  });
});

describe("isEditorPath", () => {
  it("編集画面だけが対象", () => {
    expect(isEditorPath("/w/ws/table/edit/orders")).toBe(true);
    expect(isEditorPath("/w/ws/screen/items/cart")).toBe(true);
    expect(isEditorPath("/w/ws/screen/design/cart")).toBe(true);
    expect(isEditorPath("/w/ws/process-flow/edit/f1")).toBe(true);
    expect(isEditorPath("/w/ws/conventions/catalog")).toBe(true);
    expect(isEditorPath("/w/ws/screen/list")).toBe(false);
    expect(isEditorPath("/w/ws/")).toBe(false);
    expect(isEditorPath("/w/ws/document")).toBe(false);
  });
});
