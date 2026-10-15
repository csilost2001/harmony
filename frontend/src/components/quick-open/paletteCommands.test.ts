import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { buildPaletteCommands } from "./paletteCommands";
import { getDisplayPrefs, initDisplayPrefs } from "../../theme/displayPrefs";
import { getAppThemePref } from "../../theme/appTheme";
import { _resetFavoritesCache, isFavorite } from "../../utils/favorites";
import { _resetSplitCache, getSplit, setSplit } from "../../store/splitStore";
import { searchCommands } from "../../utils/quickOpen";
import type { TabItem } from "../../store/tabStore";
import { registerPageCommands } from "../../store/pageCommands";

const tab = (over: Partial<TabItem> = {}): TabItem => ({ id: "table:orders", type: "table", resourceId: "orders", label: "注文", isDirty: false, isPinned: false, ...over });
const byId = (cmds: ReturnType<typeof buildPaletteCommands>, id: string) => cmds.find((c) => c.id === id);

describe("buildPaletteCommands", () => {
  beforeEach(() => { localStorage.clear(); sessionStorage.clear(); _resetFavoritesCache(); _resetSplitCache(); initDisplayPrefs(); vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("保存は、未保存のタブのときだけ出る。元に戻す・タブの操作・お気に入りは、設計のタブに出る", () => {
    expect(byId(buildPaletteCommands({ activeTab: tab(), wsId: "w" }), "save")).toBeUndefined();
    const cmds = buildPaletteCommands({ activeTab: tab({ isDirty: true }), wsId: "w" });
    for (const id of ["save", "undo", "redo", "tab-close", "tab-pin", "favorite"]) expect(byId(cmds, id), id).toBeDefined();
    const dash = buildPaletteCommands({ activeTab: tab({ type: "dashboard", resourceId: "main" }), wsId: "w" });
    expect(byId(dash, "undo")).toBeUndefined();
    expect(byId(dash, "favorite")).toBeUndefined(); // ダッシュボードは設計ではない
    expect(byId(buildPaletteCommands({ activeTab: null, wsId: "w" }), "tab-close")).toBeUndefined();
  });

  it("保存・元に戻す・やり直しは、画面全体へ Ctrl+S / Z / Y のキーを送る (パレットが閉じたあと)", () => {
    const keys: string[] = [];
    const on = (e: KeyboardEvent) => keys.push(`${e.ctrlKey ? "Ctrl+" : ""}${e.key}`);
    window.addEventListener("keydown", on);
    const cmds = buildPaletteCommands({ activeTab: tab({ isDirty: true }), wsId: "w" });
    byId(cmds, "save")!.run(); byId(cmds, "undo")!.run(); byId(cmds, "redo")!.run();
    expect(keys).toEqual([]); // すぐには送らない
    vi.runAllTimers();
    window.removeEventListener("keydown", on);
    expect(keys).toEqual(["Ctrl+s", "Ctrl+z", "Ctrl+y"]);
  });

  it("お気に入りは追加 / 解除が切り替わり、配色・文字サイズ・密度・コントラストを変えられる", () => {
    const c1 = buildPaletteCommands({ activeTab: tab(), wsId: "w" });
    expect(byId(c1, "favorite")!.label).toBe("お気に入りに追加");
    byId(c1, "favorite")!.run();
    expect(isFavorite("w", "table:orders")).toBe(true);
    expect(byId(buildPaletteCommands({ activeTab: tab(), wsId: "w" }), "favorite")!.label).toBe("お気に入りから外す");
    byId(c1, "theme-dark")!.run();
    expect(getAppThemePref()).toBe("dark");
    byId(c1, "font-xlarge")!.run(); byId(c1, "density-compact")!.run(); byId(c1, "contrast-high")!.run();
    expect(getDisplayPrefs()).toEqual({ fontScale: "xlarge", density: "compact", contrast: "high" });
  });

  it("ツアー・並べて表示を閉じるは、あるときだけ出る。操作の検索で見つかる", () => {
    expect(byId(buildPaletteCommands({ activeTab: tab(), wsId: "w" }), "tour")).toBeDefined();
    expect(byId(buildPaletteCommands({ activeTab: tab({ type: "er", resourceId: "main" }), wsId: "w" }), "tour")).toBeUndefined();
    expect(byId(buildPaletteCommands({ activeTab: tab(), wsId: "w" }), "split-close")).toBeUndefined();
    setSplit("w", { path: "/table/list", label: "x", tabId: null });
    const cmds = buildPaletteCommands({ activeTab: tab(), wsId: "w" });
    byId(cmds, "split-close")!.run();
    expect(getSplit("w")).toBeNull();
    expect(searchCommands(cmds, "ほぞん").length).toBe(0); // 未保存でないので、保存は無い
    expect(searchCommands(buildPaletteCommands({ activeTab: tab({ isDirty: true }), wsId: "w" }), "ほぞん")[0].id).toBe("save");
    expect(searchCommands(cmds, "置換")[0].id).toBe("replace");
  });
});

describe("コマンドパレット — この画面の操作 (usePageCommands)", () => {
  beforeEach(() => { localStorage.clear(); sessionStorage.clear(); _resetFavoritesCache(); _resetSplitCache(); initDisplayPrefs(); vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("画面が登録した操作が、パレットに載り、実行できる (パレットが閉じたあとで)。解除すると消える", () => {
    const run = vi.fn();
    const off = registerPageCommands("t", () => [{ id: "col-add", label: "カラムを追加", keywords: ["かんむ"], icon: "bi-plus-lg", run }]);
    const cmds = buildPaletteCommands({ activeTab: tab(), wsId: "w" });
    const add = byId(cmds, "col-add")!;
    expect(add).toBeDefined();
    expect(searchCommands(cmds, "カラム").map((c) => c.id)).toContain("col-add");
    add.run();
    expect(run).not.toHaveBeenCalled(); // 閉じたあとで実行する
    vi.runAllTimers();
    expect(run).toHaveBeenCalledTimes(1);
    off();
    expect(byId(buildPaletteCommands({ activeTab: tab(), wsId: "w" }), "col-add")).toBeUndefined();
  });

  it("編集画面のタブには「この画面の中を検索」が出て、Ctrl+F を送る。ダッシュボードには出ない", () => {
    const keys: string[] = [];
    const on = (e: KeyboardEvent) => keys.push(`${e.ctrlKey ? "Ctrl+" : ""}${e.key}`);
    window.addEventListener("keydown", on);
    byId(buildPaletteCommands({ activeTab: tab(), wsId: "w" }), "find-in-page")!.run();
    vi.runAllTimers();
    window.removeEventListener("keydown", on);
    expect(keys).toContain("Ctrl+f");
    expect(byId(buildPaletteCommands({ activeTab: tab({ type: "dashboard", resourceId: "main" }), wsId: "w" }), "find-in-page")).toBeUndefined();
  });
});
