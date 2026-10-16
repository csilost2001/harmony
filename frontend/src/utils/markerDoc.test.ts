import { describe, it, expect } from "vitest";
import { authoringWithMarkers, unresolvedCountByPath, unresolvedCount } from "./markerDoc";
import type { Marker } from "../types/v3";

const m = (id: string, path: string | undefined, resolved = false): Marker => ({
  id: id as Marker["id"], kind: "todo", body: id, author: "human", createdAt: "2026-01-01T00:00:00Z" as Marker["createdAt"],
  ...(path ? { anchor: { fieldPath: path } } : {}), ...(resolved ? { resolvedAt: "2026-01-02T00:00:00Z" as Marker["resolvedAt"] } : {}),
});

describe("markerDoc", () => {
  it("マーカーを入れ替える。空になり、ほかの欄も無ければ authoring ごと外す。ほかの欄は残す", () => {
    expect(authoringWithMarkers(undefined, [m("a", undefined)])?.markers).toHaveLength(1);
    expect(authoringWithMarkers({ markers: [m("a", undefined)] }, [])).toBeUndefined();
    expect(authoringWithMarkers({ markers: [m("a", undefined)], notes: [{ id: "n" } as never] }, [])).toEqual({ notes: [{ id: "n" }] });
    expect(authoringWithMarkers({ notes: [{ id: "n" } as never] }, [m("a", undefined)])).toEqual({ notes: [{ id: "n" }], markers: [expect.objectContaining({ id: "a" })] });
  });

  it("位置ごとの未解決の件数 (解決済み・位置なしは数えない)", () => {
    const list = [m("a", "$.columns[c1]"), m("b", "$.columns[c1]"), m("c", "$.columns[c1]", true), m("d", "$.columns[c2]"), m("e", undefined)];
    const map = unresolvedCountByPath(list);
    expect(map.get("$.columns[c1]")).toBe(2);
    expect(map.get("$.columns[c2]")).toBe(1);
    expect(map.size).toBe(2);
    expect(unresolvedCount(list)).toBe(4);
    expect(unresolvedCount(undefined)).toBe(0);
    expect(unresolvedCountByPath(undefined).size).toBe(0);
  });
});
