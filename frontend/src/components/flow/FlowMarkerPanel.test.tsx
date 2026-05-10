/**
 * FlowMarkerPanel unit tests (#1003)
 *
 * flowProject.screens + screenEntities mock を渡し、
 * 追加 / 解決 / 削除 / orphan フラグ判定の各分岐を検証する。
 */

import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, screen, waitFor } from "@testing-library/react";
import { FlowMarkerPanel } from "./FlowMarkerPanel";
import type { Screen } from "../../types/v3/screen";
import type { Marker } from "../../types/v3/common";
import type { ScreenNode } from "../../types/flow";

// ── Fixtures ─────────────────────────────────────────────────────────────────

function makeScreenNode(id: string, name: string): ScreenNode {
  return {
    id: id as ScreenNode["id"],
    no: 1,
    name,
    kind: "other",
    description: "",
    path: `/${id}`,
    position: { x: 0, y: 0 },
    size: { width: 160, height: 80 },
    hasDesign: false,
    createdAt: "2026-01-01T00:00:00.000Z" as ScreenNode["createdAt"],
    updatedAt: "2026-01-01T00:00:00.000Z" as ScreenNode["updatedAt"],
  };
}

function makeScreenEntity(id: string, name: string, markers: Marker[] = []): Screen {
  return {
    id: id as Screen["id"],
    name,
    kind: "other",
    path: `/${id}`,
    createdAt: "2026-01-01T00:00:00.000Z" as Screen["createdAt"],
    updatedAt: "2026-01-01T00:00:00.000Z" as Screen["updatedAt"],
    authoring: markers.length > 0 ? { markers } : undefined,
  };
}

function makeMarker(id: string, body: string, resolved = false): Marker {
  return {
    id: id as Marker["id"],
    kind: "todo",
    body,
    author: "human",
    createdAt: "2026-01-01T00:00:00.000Z" as Marker["createdAt"],
    resolvedAt: resolved
      ? ("2026-01-02T00:00:00.000Z" as Marker["resolvedAt"])
      : undefined,
    resolution: resolved ? "(手動解決)" : undefined,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("FlowMarkerPanel", () => {
  const screenA = makeScreenNode("screen-a", "画面A");
  const screenB = makeScreenNode("screen-b", "画面B");

  it("画面横断で markers を集約表示する", () => {
    const entityA = makeScreenEntity("screen-a", "画面A", [makeMarker("mk-01", "テスト指示A")]);
    const entityB = makeScreenEntity("screen-b", "画面B", [makeMarker("mk-02", "テスト指示B")]);
    const entitiesMap = new Map<string, Screen>([
      ["screen-a", entityA],
      ["screen-b", entityB],
    ]);

    render(
      <FlowMarkerPanel
        screens={[screenA, screenB]}
        screenEntities={entitiesMap}
        onMarkerChange={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText("テスト指示A")).toBeTruthy();
    expect(screen.getByText("テスト指示B")).toBeTruthy();
  });

  it("マーカーを追加すると onMarkerChange が呼ばれる", async () => {
    const entityA = makeScreenEntity("screen-a", "画面A");
    const entitiesMap = new Map<string, Screen>([["screen-a", entityA]]);
    const onMarkerChange = vi.fn().mockResolvedValue(undefined);

    render(
      <FlowMarkerPanel
        screens={[screenA]}
        screenEntities={entitiesMap}
        onMarkerChange={onMarkerChange}
        onClose={vi.fn()}
      />,
    );

    const input = screen.getByTestId("marker-body-input");
    fireEvent.change(input, { target: { value: "ヘッダー統一して" } });
    const addBtn = screen.getByTestId("marker-add-btn");
    fireEvent.click(addBtn);

    await waitFor(() => {
      expect(onMarkerChange).toHaveBeenCalledTimes(1);
      const [calledScreenId, calledMarkers] = onMarkerChange.mock.calls[0] as [string, Marker[]];
      expect(calledScreenId).toBe("screen-a");
      expect(calledMarkers).toHaveLength(1);
      expect(calledMarkers[0].body).toBe("ヘッダー統一して");
      expect(calledMarkers[0].kind).toBe("chat"); // 初期値
    });
  });

  it("解決ボタンを押すと resolvedAt が埋まる", async () => {
    const mk = makeMarker("mk-resolve", "解決検証用");
    const entityA = makeScreenEntity("screen-a", "画面A", [mk]);
    const entitiesMap = new Map<string, Screen>([["screen-a", entityA]]);
    const onMarkerChange = vi.fn().mockResolvedValue(undefined);

    render(
      <FlowMarkerPanel
        screens={[screenA]}
        screenEntities={entitiesMap}
        onMarkerChange={onMarkerChange}
        onClose={vi.fn()}
      />,
    );

    // 解決ボタンをクリック
    const resolveBtn = screen.getByTestId("resolve-btn-mk-resolve");
    fireEvent.click(resolveBtn);

    // 解決確定ボタンをクリック
    const confirmBtn = screen.getByTestId("resolve-confirm-btn");
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(onMarkerChange).toHaveBeenCalledTimes(1);
      const [, calledMarkers] = onMarkerChange.mock.calls[0] as [string, Marker[]];
      expect(calledMarkers[0].resolvedAt).toBeDefined();
      expect(calledMarkers[0].resolution).toBeTruthy();
    });
  });

  it("「解決済みも表示」オフ時は resolved marker は非表示", () => {
    const resolvedMk = makeMarker("mk-resolved", "解決済みマーカー", true);
    const entityA = makeScreenEntity("screen-a", "画面A", [resolvedMk]);
    const entitiesMap = new Map<string, Screen>([["screen-a", entityA]]);

    render(
      <FlowMarkerPanel
        screens={[screenA]}
        screenEntities={entitiesMap}
        onMarkerChange={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    // 解決済みは非表示 (初期状態は showResolved=false)
    expect(screen.queryByText("解決済みマーカー")).toBeNull();

    // 「解決済みも表示」チェックオン
    const checkbox = screen.getByTestId("show-resolved-checkbox");
    fireEvent.click(checkbox);

    expect(screen.getByText("解決済みマーカー")).toBeTruthy();
  });

  it("orphan marker (flowProject.screens に存在しない screenId) に orphan バッジが表示される", () => {
    const orphanMk = makeMarker("mk-orphan", "orphan マーカー");
    // orphan-screen は screenNode 一覧に含まれない
    const orphanEntity = makeScreenEntity("orphan-screen", "消えた画面", [orphanMk]);
    const entitiesMap = new Map<string, Screen>([["orphan-screen", orphanEntity]]);

    render(
      <FlowMarkerPanel
        screens={[screenA]} // orphan-screen は含まれない
        screenEntities={entitiesMap}
        onMarkerChange={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText("orphan マーカー")).toBeTruthy();
    expect(screen.getByTestId("marker-orphan-badge")).toBeTruthy();
  });

  it("マーカーを削除すると onMarkerChange が空配列で呼ばれる", async () => {
    const mk = makeMarker("mk-delete", "削除検証");
    const entityA = makeScreenEntity("screen-a", "画面A", [mk]);
    const entitiesMap = new Map<string, Screen>([["screen-a", entityA]]);
    const onMarkerChange = vi.fn().mockResolvedValue(undefined);

    render(
      <FlowMarkerPanel
        screens={[screenA]}
        screenEntities={entitiesMap}
        onMarkerChange={onMarkerChange}
        onClose={vi.fn()}
      />,
    );

    // trash ボタンをクリック
    const row = screen.getByTestId("marker-row-mk-delete");
    const deleteBtn = row.querySelector(".btn-link.text-danger") as HTMLButtonElement;
    fireEvent.click(deleteBtn);

    await waitFor(() => {
      expect(onMarkerChange).toHaveBeenCalledTimes(1);
      const [, calledMarkers] = onMarkerChange.mock.calls[0] as [string, Marker[]];
      expect(calledMarkers).toHaveLength(0);
    });
  });
});
