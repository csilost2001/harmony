import { describe, it, expect, beforeEach } from "vitest";
import { buildDeepLinkUrl, deepLinkHash, deepLinkKey, findDeepLinkElement, linkFromKey, parseDeepLink } from "./deepLink";

describe("parseDeepLink / deepLinkHash", () => {
  it("#kind=id を読み、書き戻せる (ID は URL 用に符号化)", () => {
    expect(parseDeepLink("#step=s3")).toEqual({ kind: "step", id: "s3" });
    expect(parseDeepLink("item=qty")).toEqual({ kind: "item", id: "qty" });
    expect(parseDeepLink(deepLinkHash({ kind: "marker", id: "a b/c" }))).toEqual({ kind: "marker", id: "a b/c" });
  });
  it("知らない種類・空・壊れた符号化は null", () => {
    expect(parseDeepLink("#foo=bar")).toBeNull();
    expect(parseDeepLink("#step=")).toBeNull();
    expect(parseDeepLink("#step=%E0%A4%A")).toBeNull();
    expect(parseDeepLink("")).toBeNull();
  });
});

describe("リンクの組み立て", () => {
  it("開いているページに、末尾を付ける (検索の文字列は残す)", () => {
    expect(buildDeepLinkUrl({ origin: "http://localhost:5173", pathname: "/w/ws/process-flow/edit/a", search: "?x=1" }, { kind: "step", id: "s3" })).toBe("http://localhost:5173/w/ws/process-flow/edit/a?x=1#step=s3");
  });
  it("印の値の往復", () => {
    expect(deepLinkKey({ kind: "step", id: "s3" })).toBe("step:s3");
    expect(linkFromKey("step:s3")).toEqual({ kind: "step", id: "s3" });
    expect(linkFromKey("nokind:x")).toBeNull();
  });
});

describe("findDeepLinkElement", () => {
  beforeEach(() => { document.body.innerHTML = `<div id="r"><div data-deeplink="step:s3" id="a"></div><div data-column-id="c1" id="b"></div><div data-node-id="n1" id="c"></div></div>`; });
  const root = () => document.getElementById("r")!;
  it("印・既存のカラムの行・部品の ID から探す", () => {
    expect(findDeepLinkElement(root(), { kind: "step", id: "s3" })?.id).toBe("a");
    expect(findDeepLinkElement(root(), { kind: "column", id: "c1" })?.id).toBe("b");
    expect(findDeepLinkElement(root(), { kind: "node", id: "n1" })?.id).toBe("c");
    expect(findDeepLinkElement(root(), { kind: "step", id: "none" })).toBeNull();
  });
});
