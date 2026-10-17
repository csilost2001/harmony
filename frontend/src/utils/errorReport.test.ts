import { describe, it, expect } from "vitest";
import { buildErrorReportText, maskUrl } from "./errorReport";

const base = { message: "保存できませんでした", recentOperations: [] as Array<{ at: number; text: string }> };

describe("buildErrorReportText (続編 第 10 弾 #200)", () => {
  it("版・コミット・URL・画面・直前の操作・エラーを、1 つの文にまとめる", () => {
    const t = buildErrorReportText({
      ...base, stack: "Error: x\n  at a\n  at b",
      version: { version: "1.4.2", commit: "0123456789abcdef", branch: "main", dirty: true },
      url: "http://localhost:5173/w/retail/table/edit/orders?token=SECRET123", screen: "注文",
      recentOperations: Array.from({ length: 8 }, (_, i) => ({ at: new Date(2026, 9, 17, 10, 0, i).getTime(), text: `操作 ${i}` })),
      drafts: [{ kind: "table", id: "orders" }], userAgent: "UA", capturedAt: new Date("2026-10-17T01:00:00Z"),
    });
    expect(t).toContain("- 版: 1.4.2 (01234567, main, 未コミットの変更あり)");
    expect(t).toContain("- URL: http://localhost:5173/w/retail/table/edit/orders?token=●●●");
    expect(t).not.toContain("SECRET123");
    expect(t).toContain("- 開いていた画面: 注文");
    expect(t).toContain("### 直前の操作 (新しい順に 5 件)");
    expect(t.match(/^- \d\d:\d\d:\d\d 操作 /gm)).toHaveLength(5);
    expect(t).toContain("保存できませんでした");
    expect(t).toContain("at b");
    expect(t).toContain("- table: orders");
    expect(t).toContain("日時: 2026-10-17T01:00:00.000Z");
  });
  it("版が取れないとき・操作が無いとき・スタックが無いとき", () => {
    const t = buildErrorReportText(base);
    expect(t).toContain("- 版: 不明 (サーバに接続できませんでした)");
    expect(t).toContain("- (記録なし)");
    expect(t).not.toContain("スタックトレース");
    expect(t).not.toContain("未保存の下書き");
  });
  it("スタックは先頭 12 行まで", () => {
    const stack = Array.from({ length: 40 }, (_, i) => `line${i}`).join("\n");
    const t = buildErrorReportText({ ...base, stack });
    expect(t).toContain("line11");
    expect(t).not.toContain("line12");
  });
});

describe("maskUrl", () => {
  it("token・key・secret・password の値を伏せる (問い合わせ・断片の両方)", () => {
    expect(maskUrl("http://x/a?token=abc&b=1")).toBe("http://x/a?token=●●●&b=1");
    expect(maskUrl("http://x/a?b=1&apiKey=zzz")).toBe("http://x/a?b=1&apiKey=●●●");
    expect(maskUrl("http://x/a#password=p")).toBe("http://x/a#password=●●●");
    expect(maskUrl("http://x/table/edit/orders")).toBe("http://x/table/edit/orders");
  });
});
