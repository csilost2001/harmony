import { describe, it, expect } from "vitest";
import { externalChangeText } from "./externalChangeNotice";

describe("外部更新の通知文", () => {
  it("1〜2 件は名前を並べ、3 件以上は「ほか N 件」にする", () => {
    expect(externalChangeText(["tables/orders.json"])).toBe("設計ファイルが外部で更新されました: tables/orders.json");
    expect(externalChangeText(["tables/a.json", "screens/b.json"])).toContain("tables/a.json、screens/b.json");
    expect(externalChangeText(["a.json", "b.json", "c.json", "d.json"])).toBe("設計ファイルが外部で更新されました: a.json、b.json ほか 2 件");
  });
  it("同じファイルの重複・.design.json は 1 件にまとめる", () => {
    expect(externalChangeText(["screens/s.json", "screens/s.design.json"])).toBe("設計ファイルが外部で更新されました: screens/s.json");
  });
});
