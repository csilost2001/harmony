import { describe, it, expect, vi, afterEach } from "vitest";
import { isPaneMode, parsePaneMessage, postToParent } from "./paneMode";

afterEach(() => { window.history.replaceState({}, "", "/"); vi.restoreAllMocks(); });

describe("paneMode", () => {
  it("URL に ?pane=1 が付いているときだけ、右ペインの中", () => {
    expect(isPaneMode()).toBe(false);
    window.history.replaceState({}, "", "/w/ws1/?pane=1");
    expect(isPaneMode()).toBe(true);
    window.history.replaceState({}, "", "/w/ws1/?pane=2");
    expect(isPaneMode()).toBe(false);
  });

  it("親へ知らせる合図は、親が無ければ (トップのウィンドウなら) 何もしない", () => {
    const spy = vi.spyOn(window, "postMessage");
    postToParent({ type: "harmony-pane-dirty", dirty: true });
    expect(spy).not.toHaveBeenCalled();
  });

  it("受け取る合図は、同じオリジンの、正しい形のものだけ", () => {
    const o = window.location.origin;
    expect(parsePaneMessage({ origin: o, data: { type: "harmony-pane-dirty", dirty: true } })).toEqual({ type: "harmony-pane-dirty", dirty: true });
    expect(parsePaneMessage({ origin: o, data: { type: "harmony-pane-nav", path: "/w/ws1/table/list" } })).toEqual({ type: "harmony-pane-nav", path: "/w/ws1/table/list" });
    expect(parsePaneMessage({ origin: "https://evil.example", data: { type: "harmony-pane-dirty", dirty: true } })).toBeNull();
    expect(parsePaneMessage({ origin: o, data: { type: "harmony-pane-dirty", dirty: "yes" } })).toBeNull();
    expect(parsePaneMessage({ origin: o, data: { type: "harmony-pane-nav", path: "//evil.example/x" } })).toBeNull(); // 外のサイトを指す形は受け取らない
    expect(parsePaneMessage({ origin: o, data: { type: "harmony-pane-nav", path: "relative" } })).toBeNull();
    expect(parsePaneMessage({ origin: o, data: null })).toBeNull();
    expect(parsePaneMessage({ origin: o, data: "text" })).toBeNull();
    expect(parsePaneMessage({ origin: o, data: { type: "other" } })).toBeNull();
  });
});
