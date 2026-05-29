import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";

// node:child_process.spawn を差し替える hoisted mock。
// 実際の codex バイナリを起動せず、FakeChild を返す。
const { spawnMock, childRef } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
  // FakeChild を保持する箱 (テスト本体から最後に spawn された child を参照する)
  childRef: { current: null as unknown },
}));

vi.mock("node:child_process", () => ({ spawn: spawnMock }));

import { StdioTransport } from "./transport.js";

/**
 * codex 子プロセスを模した fake。
 * - exit イベントは simulateExit() を呼ばない限り発火しない (= D 状態 / ゾンビ模倣)
 * - kill() は撃たれたシグナルを記録するだけで、exitCode は変えない
 */
class FakeChild extends EventEmitter {
  exitCode: number | null = null;
  killSignals: string[] = [];
  unrefCalled = false;
  stdin = { writable: true, write: vi.fn(() => true), end: vi.fn() };
  stdout = Object.assign(new EventEmitter(), { setEncoding: vi.fn() });
  stderr = Object.assign(new EventEmitter(), { setEncoding: vi.fn() });

  unref(): void {
    this.unrefCalled = true;
  }

  kill(signal?: string): boolean {
    this.killSignals.push(signal ?? "SIGTERM");
    return true;
  }

  /** 子プロセスが実際に exit したことを模擬する */
  simulateExit(code = 0, signal: string | null = null): void {
    this.exitCode = code;
    this.emit("exit", code, signal);
  }
}

function currentChild(): FakeChild {
  return childRef.current as FakeChild;
}

describe("StdioTransport (#1414)", () => {
  beforeEach(() => {
    vi.useRealTimers();
    spawnMock.mockReset();
    spawnMock.mockImplementation(() => {
      const child = new FakeChild();
      childRef.current = child;
      return child;
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("constructor が child.unref() を呼ぶ (親 event loop を保持させない)", () => {
    new StdioTransport({ command: "fake" });
    expect(currentChild().unrefCalled).toBe(true);
  });

  it("close() は exit イベント発火で resolve する", async () => {
    const transport = new StdioTransport({ command: "fake" });
    const child = currentChild();
    const p = transport.close({ sigtermDelayMs: 500, sigkillDelayMs: 1500 });
    child.simulateExit(0, null);
    await expect(p).resolves.toBeUndefined();
  });

  it("exit イベントが永久に来なくても SIGKILL+200ms で force-resolve する", async () => {
    vi.useFakeTimers();
    const transport = new StdioTransport({ command: "fake" });
    const child = currentChild();
    const p = transport.close({ sigtermDelayMs: 500, sigkillDelayMs: 1500 });

    let settled = false;
    void p.then(() => {
      settled = true;
    });

    // SIGTERM 直前 (480ms): まだ kill されていない
    await vi.advanceTimersByTimeAsync(480);
    expect(child.killSignals).not.toContain("SIGTERM");
    expect(settled).toBe(false);

    // SIGTERM 発火後 (520ms): exitCode は null のままなので SIGTERM が撃たれる
    await vi.advanceTimersByTimeAsync(40);
    expect(child.killSignals).toContain("SIGTERM");

    // SIGKILL 発火後・fallback 前 (1600ms): SIGKILL は撃たれたが 200ms fallback 未到達
    await vi.advanceTimersByTimeAsync(1080);
    expect(child.killSignals).toContain("SIGKILL");
    expect(settled).toBe(false);

    // fallback 到達 (1700ms 経過): exit イベント無しでも resolve する
    await vi.advanceTimersByTimeAsync(120);
    await expect(p).resolves.toBeUndefined();
    expect(settled).toBe(true);
  });

  it("既に didClose 済なら close() は即 resolve (二重呼び出し安全)", async () => {
    const transport = new StdioTransport({ command: "fake" });
    const child = currentChild();
    const p1 = transport.close({ sigtermDelayMs: 500, sigkillDelayMs: 1500 });
    child.simulateExit(0, null);
    await p1;
    await expect(transport.close()).resolves.toBeUndefined();
  });
});
