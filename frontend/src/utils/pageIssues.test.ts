import { describe, it, expect, beforeEach } from "vitest";
import { collectIssueElements, focusFirstIssue, nextIssueIndex } from "./pageIssues";

function mount(html: string): HTMLElement {
  document.body.innerHTML = `<div id="root">${html}</div>`;
  // jsdom には、レイアウトが無い。見えているものとして扱う
  document.querySelectorAll<HTMLElement>("#root *").forEach((el) => { el.getClientRects = () => [{ width: 1, height: 1 }] as unknown as DOMRectList; });
  return document.getElementById("root")!;
}

beforeEach(() => { document.body.innerHTML = ""; });

describe("collectIssueElements", () => {
  it("印のある欄・行を、上から下へ集める。入れ子のものは、中の欄だけ", () => {
    const root = mount(`<input id="a" aria-invalid="true"><div id="row" class="has-warning"><input id="b" class="is-invalid"></div><span id="c" data-issue></span><input id="ok">`);
    expect(collectIssueElements(root).map((e) => e.id)).toEqual(["a", "b", "c"]);
  });
  it("見えないもの・無視の印のものは、数えない", () => {
    const root = mount(`<input id="a" aria-invalid="true"><div data-issue-ignore><input id="x" aria-invalid="true"></div><input id="hidden" aria-invalid="true">`);
    document.getElementById("hidden")!.getClientRects = () => [] as unknown as DOMRectList;
    expect(collectIssueElements(root).map((e) => e.id)).toEqual(["a"]);
  });
});

describe("nextIssueIndex", () => {
  it("いまの位置の次 / 前へ。端では反対側へ巡る", () => {
    const root = mount(`<input id="a" aria-invalid="true"><p id="mid">x</p><input id="b" aria-invalid="true"><input id="c" aria-invalid="true">`);
    const items = collectIssueElements(root);
    const mid = document.getElementById("mid");
    expect(nextIssueIndex(items, mid, 1)).toBe(1);
    expect(nextIssueIndex(items, mid, -1)).toBe(0);
    expect(nextIssueIndex(items, document.getElementById("c"), 1)).toBe(0); // 末尾の次は、先頭
    expect(nextIssueIndex(items, document.getElementById("a"), -1)).toBe(2); // 先頭の前は、末尾
    expect(nextIssueIndex(items, null, 1)).toBe(0);
    expect(nextIssueIndex([], mid, 1)).toBe(-1);
  });
});

describe("focusFirstIssue", () => {
  it("最初の要確認の欄にフォーカスし、無ければ false", () => {
    mount(`<input id="a"><input id="b" class="is-invalid">`);
    expect(focusFirstIssue()).toBe(true);
    expect(document.activeElement?.id).toBe("b");
    mount(`<input id="ok">`);
    expect(focusFirstIssue()).toBe(false);
  });
});
