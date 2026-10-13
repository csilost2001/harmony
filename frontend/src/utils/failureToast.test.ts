import { describe, it, expect, beforeEach } from "vitest";
import { vi } from "vitest";
import { _resetFailureToastDedupe, failureToastText, reportFailure } from "./failureToast";
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
  beforeEach(() => _resetFailureToastDedupe());

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

  it("同じ失敗が続けて来ても、通知は 1 回 (サーバが落ちて、同時に何件も失敗したとき)。中断は通知しない", () => {
    const seen: string[] = [];
    const off = subscribeToasts((t) => seen.push(t.text));
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    for (let i = 0; i < 5; i++) reportFailure(new Error("重複確認の失敗"), "重複確認の保存");
    const abort = new Error("aborted"); abort.name = "AbortError";
    reportFailure(abort, "中断の保存");
    off();
    log.mockRestore();
    expect(seen).toEqual(["重複確認の保存に失敗しました: 重複確認の失敗"]);
  });

  it("接続できない失敗は、操作の名前に関わらず、サーバの状態の案内を出す", () => {
    const seen: string[] = [];
    const off = subscribeToasts((t) => seen.push(t.text));
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    reportFailure(new Error("wsBridge に接続されていません"), "接続の保存");
    off();
    log.mockRestore();
    expect(seen).toEqual(["サーバに接続できないため、操作できませんでした"]);
  });

  it("操作の名前つきでも、サーバの ID 検査の英語は日本語の案内になる。中身が空なら、名前だけ", () => {
    const seen: string[] = [];
    const off = subscribeToasts((t) => seen.push(t.text));
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    reportFailure(new Error("Invalid tableId: must be kebab-case EntityId matching ^[a-z]"), "テーブル一覧の保存");
    reportFailure(new Error(""), "空の保存");
    off();
    log.mockRestore();
    expect(seen).toEqual(["テーブル一覧の保存に失敗しました: ID の形式が正しくありません (英小文字で始まり、英小文字・数字・ハイフンだけ。64 字まで)", "空の保存に失敗しました"]);
  });
});

