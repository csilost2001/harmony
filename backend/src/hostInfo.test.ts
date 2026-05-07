/**
 * hostInfo 単体テスト (#858)
 *
 * /proc/version の文字列マッチで WSL 検出を行うので、fs.readFile を mock して
 * 各バリエーション (WSL2 / WSL1 / native Linux / 読み込み失敗) を直接検証する。
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import os from "node:os";
import fs from "node:fs/promises";
import { getHostInfo, __resetHostInfoCacheForTest } from "./hostInfo.js";

describe("getHostInfo", () => {
  beforeEach(() => {
    __resetHostInfoCacheForTest();
    vi.restoreAllMocks();
  });

  it("platform / homeDir を返す", async () => {
    const info = await getHostInfo();
    expect(["linux", "win32", "darwin", "other"]).toContain(info.platform);
    expect(info.homeDir).toBe(os.homedir());
    expect(typeof info.isWSL).toBe("boolean");
  });

  it("結果がキャッシュされる (2 回目は同一インスタンス)", async () => {
    const a = await getHostInfo();
    const b = await getHostInfo();
    expect(b).toBe(a);
  });

  // ── WSL 検出ロジックの直接検証 (process.platform="linux" 想定の環境のみ) ─────
  // /proc/version の内容を mock し、isWSL の判定が正しいかを文字列バリアント別に確認

  describe("WSL 検出 (Linux ホストでの /proc/version マッチ)", () => {
    const isLinux = process.platform === "linux";

    it.runIf(isLinux)("WSL2 文字列を含む /proc/version → isWSL=true", async () => {
      vi.spyOn(fs, "readFile").mockResolvedValue(
        "Linux version 5.15.90.1-microsoft-standard-WSL2 (oe-user@oe-host) ...",
      );
      const info = await getHostInfo();
      expect(info.isWSL).toBe(true);
    });

    it.runIf(isLinux)("Microsoft 文字列 (WSL1 想定) → isWSL=true", async () => {
      vi.spyOn(fs, "readFile").mockResolvedValue(
        "Linux version 4.4.0-19041-Microsoft (Microsoft@Microsoft.com) ...",
      );
      const info = await getHostInfo();
      expect(info.isWSL).toBe(true);
    });

    it.runIf(isLinux)("native Linux (Microsoft/WSL を含まない) → isWSL=false", async () => {
      vi.spyOn(fs, "readFile").mockResolvedValue(
        "Linux version 5.15.0-91-generic (buildd@lcy02-amd64-009) ...",
      );
      const info = await getHostInfo();
      expect(info.isWSL).toBe(false);
    });

    it.runIf(isLinux)("/proc/version 読み込み失敗 → isWSL=false (例外を伝播しない)", async () => {
      vi.spyOn(fs, "readFile").mockRejectedValue(new Error("ENOENT"));
      const info = await getHostInfo();
      expect(info.isWSL).toBe(false);
    });
  });

  it("Linux 以外 (win32 / darwin) では isWSL=false を即返す", async () => {
    if (process.platform === "linux") return; // Linux 環境では skip
    const info = await getHostInfo();
    expect(info.isWSL).toBe(false);
  });
});
