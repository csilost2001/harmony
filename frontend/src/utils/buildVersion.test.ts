import { afterEach, describe, expect, it, vi } from "vitest";
import { __resetStaleBuildForTest, clientBuildId, handleServerBuildId, isStaleBuild } from "./buildVersion";

afterEach(() => {
  vi.unstubAllGlobals();
  __resetStaleBuildForTest();
});

describe("buildVersion (#1572)", () => {
  it("画面とサーバの版が一致すれば古くない", () => {
    vi.stubGlobal("__HARMONY_BUILD_ID__", "b1");
    handleServerBuildId("b1");
    expect(isStaleBuild()).toBe(false);
  });

  it("両方あって違えば古い。あとで一致すれば戻る", () => {
    vi.stubGlobal("__HARMONY_BUILD_ID__", "b1");
    handleServerBuildId("b2");
    expect(isStaleBuild()).toBe(true);
    handleServerBuildId("b1");
    expect(isStaleBuild()).toBe(false);
  });

  it("サーバが版を知らせない (静的配信なし) ときは比べない", () => {
    vi.stubGlobal("__HARMONY_BUILD_ID__", "b1");
    handleServerBuildId(undefined);
    handleServerBuildId("");
    expect(isStaleBuild()).toBe(false);
  });

  it("画面に版がない (dev / 単体テスト) ときは比べない", () => {
    expect(clientBuildId()).toBeNull();
    handleServerBuildId("b2");
    expect(isStaleBuild()).toBe(false);
  });

  it("変化したときだけ購読者へ知らせる", async () => {
    vi.stubGlobal("__HARMONY_BUILD_ID__", "b1");
    const { renderHook, act } = await import("@testing-library/react");
    const { useStaleBuild } = await import("./buildVersion");
    const { result } = renderHook(() => useStaleBuild());
    expect(result.current).toBe(false);
    act(() => handleServerBuildId("b2"));
    expect(result.current).toBe(true);
  });
});
