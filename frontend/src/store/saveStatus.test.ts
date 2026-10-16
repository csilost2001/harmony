import { describe, it, expect, beforeEach } from "vitest";
import { clockLabel, describeSaveStatus, saveStatus } from "./saveStatus";

beforeEach(() => saveStatus.reset());

describe("saveStatus", () => {
  it("下書きを送ると時刻が残り、保存すると下書きの記録は空になる", () => {
    const at = new Date(2026, 9, 16, 12, 3).getTime();
    saveStatus.draftSynced(at);
    expect(saveStatus.get().draftAt).toBe(at);
    saveStatus.saved(at + 60000);
    expect(saveStatus.get()).toEqual({ draftAt: null, savedAt: at + 60000, draftFailed: false });
  });
  it("時刻の表示 (ゼロ埋め)", () => {
    expect(clockLabel(new Date(2026, 0, 1, 9, 5).getTime())).toBe("09:05");
  });
  it("状態の文: 未保存の変更あり (下書き保存済み / 送信中 / 失敗)・変更なし", () => {
    const at = new Date(2026, 9, 16, 12, 3).getTime();
    expect(describeSaveStatus(true, { draftAt: at, savedAt: null, draftFailed: false })).toEqual({ text: "原本に未反映 / 下書きは 12:03 にサーバへ保存済み", tone: "ok" });
    expect(describeSaveStatus(true, { draftAt: null, savedAt: null, draftFailed: false }).text).toContain("送っています");
    expect(describeSaveStatus(true, { draftAt: at, savedAt: null, draftFailed: true }).tone).toBe("warn");
    expect(describeSaveStatus(false, { draftAt: null, savedAt: at, draftFailed: false }).text).toBe("原本と同じ (12:03 に保存)");
  });
  it("下書きの失敗は、次の成功まで残る", () => {
    saveStatus.draftFailed();
    expect(saveStatus.get().draftFailed).toBe(true);
    saveStatus.draftSynced();
    expect(saveStatus.get().draftFailed).toBe(false);
  });
});
