/**
 * EditorBackend interface の契約テスト。
 *
 * Mock Backend を使って load / save の round-trip と renderEditor の戻り値型を検証する。
 * GrapesJSBackend と PuckBackend の基本動作も確認する。
 *
 * #806 子 3 / #815 (renderEditor: ReactNode 返却に統一)
 */
import { describe, it, expect, vi } from "vitest";
import type { ReactNode } from "react";
import { isValidElement } from "react";
import type {
  EditorBackend,
  EditorState,
  GrapesJSRenderEditorProps,
  RenderEditorBaseProps,
} from "./EditorBackend";
import { GrapesJSBackend, isEmptyGjsPayload } from "./GrapesJSBackend";

// -----------------------------------------------------------------------
// Mock EditorBackend — interface 契約テスト用
// -----------------------------------------------------------------------

class MockBackend implements EditorBackend {
  async load(_screenId: string, draftRead: () => Promise<unknown>): Promise<EditorState> {
    const payload = await draftRead();
    return { payload };
  }

  async save(
    _screenId: string,
    state: EditorState,
    draftWrite: (payload: unknown) => Promise<void>,
  ): Promise<void> {
    await draftWrite(state.payload);
  }

  renderEditor(props: RenderEditorBaseProps): ReactNode {
    void props;
    return null;
  }
}

const baseRenderProps: Omit<RenderEditorBaseProps, "state"> = {
  cssFramework: "bootstrap",
  themeVariant: "standard",
  isReadonly: false,
  subToolbarSlot: null,
  dialogsSlot: null,
  panelMode: "pinned",
  onTogglePin: () => { /* no-op */ },
  onClosePanel: () => { /* no-op */ },
  screenId: "screen-001",
  onStartEditing: () => { /* no-op */ },
  reloadPayload: async () => null,
};

const grapesRenderProps: Omit<GrapesJSRenderEditorProps, "state"> = {
  ...baseRenderProps,
  onServerChanged: () => { /* no-op */ },
  onMcpStatusChange: () => { /* no-op */ },
  onExternalThemeChange: () => { /* no-op */ },
};

// -----------------------------------------------------------------------
// テスト
// -----------------------------------------------------------------------

describe("EditorBackend interface — Mock Backend round-trip", () => {
  it("load で draftRead の戻り値を payload に持つ EditorState を返す", async () => {
    const backend = new MockBackend();
    const payload = { pages: [{ frames: [{ component: { type: "wrapper" } }] }] };
    const draftRead = vi.fn().mockResolvedValue(payload);

    const state = await backend.load("screen-001", draftRead);

    expect(draftRead).toHaveBeenCalledOnce();
    expect(state.payload).toEqual(payload);
  });

  it("save で draftWrite に state.payload が渡される", async () => {
    const backend = new MockBackend();
    const payload = { pages: [{ id: "main" }] };
    const state: EditorState = { payload };
    const draftWrite = vi.fn().mockResolvedValue(undefined);

    await backend.save("screen-001", state, draftWrite);

    expect(draftWrite).toHaveBeenCalledOnce();
    expect(draftWrite).toHaveBeenCalledWith(payload);
  });

  it("load → save の round-trip で payload が保持される", async () => {
    const backend = new MockBackend();
    const originalPayload = { data: "test-payload-value" };
    const stored: { value: unknown } = { value: null };

    const draftRead = vi.fn().mockResolvedValue(originalPayload);
    const draftWrite = vi.fn().mockImplementation(async (p: unknown) => {
      stored.value = p;
    });

    const state = await backend.load("screen-001", draftRead);
    await backend.save("screen-001", state, draftWrite);

    expect(stored.value).toEqual(originalPayload);
  });

  it("renderEditor は ReactNode を返す (例外なし)", () => {
    const backend = new MockBackend();
    const state: EditorState = { payload: {} };
    expect(() => backend.renderEditor({ ...baseRenderProps, state })).not.toThrow();
  });
});

// -----------------------------------------------------------------------
// GrapesJSBackend の基本テスト
// -----------------------------------------------------------------------

describe("GrapesJSBackend", () => {
  it("load: draftRead が成功すれば payload に値が入る", async () => {
    const backend = new GrapesJSBackend();
    const expected = { pages: [{ id: "page-1" }] };
    const draftRead = vi.fn().mockResolvedValue(expected);

    const state = await backend.load("screen-001", draftRead);

    expect(state.payload).toEqual(expected);
  });

  it("load: draftRead が reject したら payload は null (GrapesJS が autoload で処理)", async () => {
    const backend = new GrapesJSBackend();
    const draftRead = vi.fn().mockRejectedValue(new Error("draft not found"));

    const state = await backend.load("screen-001", draftRead);

    expect(state.payload).toBeNull();
  });

  it("save: draftWrite に state.payload が渡される", async () => {
    const backend = new GrapesJSBackend();
    const payload = { pages: [{ id: "main" }], styles: [] };
    const state: EditorState = { payload };
    const draftWrite = vi.fn().mockResolvedValue(undefined);

    await backend.save("screen-001", state, draftWrite);

    expect(draftWrite).toHaveBeenCalledWith(payload);
  });

  it("renderEditor: <GrapesJSEditorPane> を含む React Element を返す", () => {
    // PR-B で <GjsEditor> + Canvas + BlocksPanel + RightPanel を含む完全実装に格上げ。
    const backend = new GrapesJSBackend();
    const state: EditorState = { payload: null };
    const node = backend.renderEditor({ ...grapesRenderProps, state });
    expect(node).not.toBeNull();
    expect(isValidElement(node)).toBe(true);
  });
});

// -----------------------------------------------------------------------
// isEmptyGjsPayload のテスト
// -----------------------------------------------------------------------

describe("isEmptyGjsPayload", () => {
  it("null は empty とみなす", () => {
    expect(isEmptyGjsPayload(null)).toBe(true);
  });

  it("undefined は empty とみなす", () => {
    expect(isEmptyGjsPayload(undefined)).toBe(true);
  });

  it("pages が空配列なら empty とみなす", () => {
    expect(isEmptyGjsPayload({ pages: [] })).toBe(true);
  });

  it("pages が 1 件以上あれば empty ではない", () => {
    expect(isEmptyGjsPayload({ pages: [{ id: "main" }] })).toBe(false);
  });
});
