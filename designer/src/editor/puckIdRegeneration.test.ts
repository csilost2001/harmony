import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Data } from "@measured/puck";

const { mockGenerateUUID } = vi.hoisted(() => ({
  mockGenerateUUID: vi.fn<() => string>(() => "uuid-default"),
}));

vi.mock("../utils/uuid", () => ({
  generateUUID: mockGenerateUUID,
}));

import { regeneratePuckDataIds } from "./puckIdRegeneration";

function puckData(data: unknown): Data {
  return data as Data;
}

describe("regeneratePuckDataIds", () => {
  beforeEach(() => {
    let index = 0;
    mockGenerateUUID.mockImplementation(() => `uuid-${++index}`);
  });

  it("content[] の props.id を新しい UUID に置換する", () => {
    const data = puckData({
      root: { props: {} },
      content: [
        { type: "Text", props: { id: "old-1", text: "A" } },
        { type: "Button", props: { id: "old-2", label: "B" } },
      ],
    });

    const result = regeneratePuckDataIds(data);

    expect(result.content[0].props.id).toBe("uuid-1");
    expect(result.content[1].props.id).toBe("uuid-2");
    expect(result.content[0].props.id).not.toBe("old-1");
    expect(result.content[1].props.id).not.toBe("old-2");
    expect(result.content[0].props.id).not.toBe(result.content[1].props.id);
  });

  it("zones 内の props.id も置換する", () => {
    const data = puckData({
      root: { props: {} },
      content: [],
      zones: {
        "main:zone": [
          { type: "Card", props: { id: "zone-old-1" } },
          { type: "Field", props: { id: "zone-old-2" } },
        ],
      },
    });

    const result = regeneratePuckDataIds(data);

    expect(result.zones?.["main:zone"][0].props.id).toBe("uuid-1");
    expect(result.zones?.["main:zone"][1].props.id).toBe("uuid-2");
  });

  it("同じ旧 ID は content と zones で同じ新 ID に対応する", () => {
    const data = puckData({
      root: { props: {} },
      content: [{ type: "Text", props: { id: "shared-old" } }],
      zones: {
        aside: [{ type: "Text", props: { id: "shared-old" } }],
      },
    });

    const result = regeneratePuckDataIds(data);

    expect(result.content[0].props.id).toBe(result.zones?.aside[0].props.id);
    expect(result.content[0].props.id).toBe("uuid-1");
  });

  it("id 以外の props を保持する", () => {
    const nested = { level: "primary" };
    const data = puckData({
      root: { props: {} },
      content: [
        {
          type: "Button",
          props: { id: "old", label: "登録", variant: nested, disabled: false },
        },
      ],
    });

    const result = regeneratePuckDataIds(data);

    expect(result.content[0].props).toMatchObject({
      label: "登録",
      variant: nested,
      disabled: false,
    });
  });

  it("入力 data を mutate しない", () => {
    const data = puckData({
      root: { props: {} },
      content: [{ type: "Text", props: { id: "old", text: "before" } }],
      zones: {
        main: [{ type: "Field", props: { id: "zone-old" } }],
      },
    });

    const result = regeneratePuckDataIds(data);

    expect(result).not.toBe(data);
    expect(result.content).not.toBe(data.content);
    expect(result.content[0]).not.toBe(data.content[0]);
    expect(data.content[0].props.id).toBe("old");
    expect(data.zones?.main[0].props.id).toBe("zone-old");
  });

  it("空の data で例外を投げない", () => {
    const data = puckData({ root: { props: {} }, content: [] });

    expect(() => regeneratePuckDataIds(data)).not.toThrow();
    expect(regeneratePuckDataIds(data).content).toEqual([]);
  });
});
