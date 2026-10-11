import { describe, it, expect } from "vitest";
import { vi } from "vitest";
import { failureToastText, reportFailure } from "./failureToast";
import { subscribeToasts } from "./toast";

describe("failureToastText", () => {
  it("エラー 1 つだけ (.catch(console.error) の形) は通知にする", () => {
    expect(failureToastText([new Error("保存に失敗")])).toBe("操作に失敗しました: 保存に失敗");
    expect(failureToastText([new Error("")])).toBe("操作に失敗しました");
  });
  it("接続の失敗は、接続できない旨にする", () => {
    expect(failureToastText([new Error("wsBridge に接続されていません")])).toContain("接続できない");
  });
  it("サーバ側の ID 検査の英語は日本語にする", () => {
    expect(failureToastText([new Error("Invalid sequenceId: must be kebab-case EntityId matching ^[a-z]...")])).toContain("ID の形式が正しくありません");
  });
  it("説明つきのログ (引数が複数)・エラーでない値・中断は通知にしない", () => {
    expect(failureToastText(["[x] failed", new Error("a")])).toBeNull();
    expect(failureToastText(["文字列だけ"])).toBeNull();
    expect(failureToastText([{ message: "x" }])).toBeNull();
    const abort = new Error("aborted"); abort.name = "AbortError";
    expect(failureToastText([abort])).toBeNull();
    expect(failureToastText([])).toBeNull();
  });
});

describe("reportFailure (明示の経路)", () => {
  it("操作の名前つきで、利用者に通知する。開発者向けのログも残す", () => {
    const seen: string[] = [];
    const off = subscribeToasts((t) => seen.push(t.text));
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    reportFailure(new Error("denied"), "テーブルの保存");
    off();
    expect(seen).toEqual(["テーブルの保存に失敗しました: denied"]);
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });
});
