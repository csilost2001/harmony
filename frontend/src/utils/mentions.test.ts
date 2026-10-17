import { describe, it, expect } from "vitest";
import { appendMention, isMentioned, mentionCandidates, mentionsIn, splitMentions } from "./mentions";

const known = ["山田", "山田 太郎", "花子"];

describe("splitMentions", () => {
  it("既知の名前は、長いものから照合する (空白を含む名前も)", () => {
    expect(splitMentions("@山田 太郎 さん、確認をお願いします", known)).toEqual([
      { text: "@山田 太郎", mention: "山田 太郎" }, { text: " さん、確認をお願いします" },
    ]);
    expect(splitMentions("@山田 確認して", known)[0]).toEqual({ text: "@山田", mention: "山田" });
  });
  it("未知の名前は、空白までを宛先にする。メールアドレスの @ は宛先にしない", () => {
    expect(splitMentions("@佐藤 お願い", known)[0].mention).toBe("佐藤");
    expect(mentionsIn("連絡先 taro@example.com", known)).toEqual([]);
  });
  it("宛先が無ければ、全体を 1 つで返す", () => {
    expect(splitMentions("宛先なし", known)).toEqual([{ text: "宛先なし" }]);
    expect(splitMentions("", known)).toEqual([{ text: "" }]);
  });
  it("正規表現の記号を含む名前でも壊れない", () => {
    expect(mentionsIn("@a.b+c さんへ", ["a.b+c"])).toEqual(["a.b+c"]);
  });
});

describe("isMentioned / mentionCandidates / appendMention", () => {
  it("自分宛てかは、空白・大文字小文字を無視して比べる", () => {
    expect(isMentioned("@山田太郎 へ", "山田 太郎", known)).toBe(true);
    expect(isMentioned("@花子 へ", "山田", known)).toBe(false);
    expect(isMentioned("x", "", known)).toBe(false);
  });
  it("候補は、本文にある名前を除く", () => {
    expect(mentionCandidates("@花子 へ", ["花子", "太郎"])).toEqual(["太郎"]);
  });
  it("本文の末尾へ足す", () => {
    expect(appendMention("", "花子")).toBe("@花子 ");
    expect(appendMention("確認を", "花子")).toBe("確認を @花子 ");
    expect(appendMention("確認を ", "花子")).toBe("確認を @花子 ");
  });
});
