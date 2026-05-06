/**
 * DesignSubToolbar refactor 回帰テスト (#824)
 *
 * 目的:
 *   - editor=undefined (Puck 経路) で crash しないこと
 *   - editor=mock (GrapesJS 経路) で editor 由来の機能が動くこと
 *   - DesignSubToolbarGrapesJSBridge が useEditorMaybe() を呼び editor を forward すること
 *
 * 旧実装 (`useEditorOptional` の try/catch wrapper) では Puck 経路は throw を吸収する
 * 形で同等動作を実現していたが、Rules-of-Hooks anti-pattern だった。本テストは
 * 「editor を props で受ける」に置換しても両経路で挙動同等であることを保証する。
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

// mcpBridge / customBlockStore を全面モック (DesignSubToolbar の useEffect が呼ぶ副作用を遮断)
vi.mock("../../mcp/mcpBridge", () => {
  return {
    mcpBridge: {
      onBroadcast: vi.fn(() => () => {}),
      onStatusChange: vi.fn(() => () => {}),
      setThemeHandler: vi.fn(),
      setCurrentScreenId: vi.fn(),
      getClientId: vi.fn(() => "test-client"),
      request: vi.fn(),
      start: vi.fn(),
    },
  };
});

vi.mock("../../store/customBlockStore", () => {
  return {
    upsertCustomBlock: vi.fn(),
  };
});

// AI rename auth-check の fetch を no-op に
beforeEach(() => {
  global.fetch = vi.fn(() =>
    Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ authenticated: false }),
    } as Response),
  ) as unknown as typeof fetch;
});

import { DesignSubToolbar } from "./DesignSubToolbar";

const baseProps = {
  panelMode: "hidden" as const,
  onOpenPanel: vi.fn(),
  activeTheme: "standard" as const,
  onThemeChange: vi.fn(),
  mcpStatus: "disconnected" as const,
  isReadonly: false,
};

describe("DesignSubToolbar — editor prop 化 refactor (#824)", () => {
  it("editor=undefined (Puck 経路) — Provider 不在環境で crash せず render される", () => {
    // 旧実装は <GjsEditor> ancestor 不在で useEditorMaybe が throw → useEditorOptional が catch
    // 新実装は editor prop で受けるので Provider 不要、かつ try/catch 不要
    expect(() => {
      render(<DesignSubToolbar {...baseProps} editor={undefined} />);
    }).not.toThrow();

    // ヘッダ自体は描画される (EditorHeader 経由)
    expect(screen.getByTestId("editor-header")).toBeInTheDocument();
  });

  it("editor=undefined — Undo/Redo の canUndo/canRedo は false (editor 由来 API 無効化)", () => {
    render(<DesignSubToolbar {...baseProps} editor={undefined} />);
    // EditorHeader が描画する Undo/Redo ボタン (canUndo=false / canRedo=false で disabled)
    expect(screen.getByTestId("editor-header-undo")).toBeDisabled();
    expect(screen.getByTestId("editor-header-redo")).toBeDisabled();
  });

  it("editor=mock (GrapesJS 経路) — UndoManager.hasUndo を呼んで結果を反映する", () => {
    const hasUndo = vi.fn(() => true);
    const hasRedo = vi.fn(() => false);
    const mockEditor = {
      UndoManager: { hasUndo, hasRedo, undo: vi.fn(), redo: vi.fn() },
      Devices: { getSelected: vi.fn(() => ({ get: () => "desktop" })) },
      getSelectedAll: vi.fn(() => []),
      getSelected: vi.fn(() => null),
      on: vi.fn(),
      off: vi.fn(),
      runCommand: vi.fn(),
      setDevice: vi.fn(),
      DomComponents: { clear: vi.fn() },
      BlockManager: { add: vi.fn() },
      getHtml: vi.fn(() => ""),
      getCss: vi.fn(() => ""),
      select: vi.fn(),
    };

    render(
      <DesignSubToolbar
        {...baseProps}
        editor={mockEditor as unknown as Parameters<typeof DesignSubToolbar>[0]["editor"]}
      />,
    );

    // useEffect 内で hasUndo / hasRedo が呼ばれた = editor prop が渡って effect で使われた
    expect(hasUndo).toHaveBeenCalled();
    expect(hasRedo).toHaveBeenCalled();
    // canUndo=true なので Undo ボタンは enabled
    expect(screen.getByTestId("editor-header-undo")).not.toBeDisabled();
  });
});

describe("DesignSubToolbarGrapesJSBridge (#824)", () => {
  it("useEditorMaybe() の戻り値を DesignSubToolbar の editor prop に forward する", async () => {
    // useEditorMaybe を mock し、bridge が呼んで forward することを検証
    const fakeEditor = {
      UndoManager: { hasUndo: vi.fn(() => false), hasRedo: vi.fn(() => false), undo: vi.fn(), redo: vi.fn() },
      Devices: { getSelected: vi.fn(() => ({ get: () => "desktop" })) },
      getSelectedAll: vi.fn(() => []),
      getSelected: vi.fn(() => null),
      on: vi.fn(),
      off: vi.fn(),
      runCommand: vi.fn(),
      setDevice: vi.fn(),
    };
    const useEditorMaybeMock = vi.fn(() => fakeEditor);

    vi.doMock("@grapesjs/react", () => ({
      useEditorMaybe: useEditorMaybeMock,
    }));

    // doMock 後に動的 import (キャッシュ済み module を mock 後の物に差し替え)
    vi.resetModules();
    const { DesignSubToolbarGrapesJSBridge } = await import("./DesignSubToolbar");

    render(<DesignSubToolbarGrapesJSBridge {...baseProps} />);

    // bridge が useEditorMaybe を呼んだ
    expect(useEditorMaybeMock).toHaveBeenCalled();
    // forward された結果 editor.UndoManager.hasUndo が DesignSubToolbar の useEffect で呼ばれた
    expect(fakeEditor.UndoManager.hasUndo).toHaveBeenCalled();

    vi.doUnmock("@grapesjs/react");
  });
});
