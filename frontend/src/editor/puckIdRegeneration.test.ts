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

  it("props.id が undefined の component は id 生成しない", () => {
    const data: Data = {
      root: { props: {} },
      content: [{ type: "Heading", props: {} }] as any, // id なし
    };
    const result = regeneratePuckDataIds(data);
    expect((result.content[0] as any).props.id).toBeUndefined();
  });

  // ── zones キーの itemId 同期 (#1412 P-4) ──────────────────────────────────

  it("content の親ノード id 再生成と zones キーの itemId が同期する", () => {
    // 親ノードが content にあり、その DropZone (`<親id>:content`) に子がある構成。
    const data = puckData({
      root: { props: {} },
      content: [{ type: "Card", props: { id: "card-old" } }],
      zones: {
        "card-old:content": [{ type: "Heading", props: { id: "head-old" } }],
      },
    });

    const result = regeneratePuckDataIds(data);

    const newCardId = result.content[0].props.id;
    expect(newCardId).toBe("uuid-1");
    // zones キーの itemId 部分が新 card id に書き換わっている (zoneName は保持)。
    expect(result.zones).toHaveProperty(`${newCardId}:content`);
    expect(result.zones).not.toHaveProperty("card-old:content");
    // 子ノードの props.id も再生成されている。
    expect(result.zones?.[`${newCardId}:content`][0].props.id).toBe("uuid-2");
  });

  it("ネストした DropZone の itemId も再帰的に同期する", () => {
    const data = puckData({
      root: { props: {} },
      content: [{ type: "Card", props: { id: "outer" } }],
      zones: {
        "outer:content": [{ type: "Row", props: { id: "inner" } }],
        "inner:content": [{ type: "Text", props: { id: "leaf" } }],
      },
    });

    const result = regeneratePuckDataIds(data);

    const outerNew = result.content[0].props.id;
    const innerNew = result.zones?.[`${outerNew}:content`][0].props.id;
    expect(typeof innerNew).toBe("string");
    // inner の DropZone キーも新 inner id に同期している。
    expect(result.zones).toHaveProperty(`${innerNew}:content`);
    expect(result.zones).not.toHaveProperty("inner:content");
  });

  it("idMap に無い itemId の zones キー (orphan / リテラル) はそのまま保持される", () => {
    // content / zones value に "main" / "aside" を props.id とするノードが無いため、
    // これらのリテラルキーは idMap に載らず不変のまま (後方互換)。
    const data = puckData({
      root: { props: {} },
      content: [],
      zones: {
        "main:zone": [{ type: "Card", props: { id: "x" } }],
        aside: [{ type: "Field", props: { id: "y" } }],
      },
    });

    const result = regeneratePuckDataIds(data);

    expect(result.zones).toHaveProperty("main:zone");
    expect(result.zones).toHaveProperty("aside");
    // value 内ノードの props.id は再生成される。
    expect(result.zones?.["main:zone"][0].props.id).not.toBe("x");
  });

  it("zoneName に ':' が含まれても最初の ':' でのみ分割しキーを保持する", () => {
    const data = puckData({
      root: { props: {} },
      content: [{ type: "Card", props: { id: "p" } }],
      zones: {
        "p:zone:weird": [{ type: "Text", props: { id: "c" } }],
      },
    });

    const result = regeneratePuckDataIds(data);

    const newP = result.content[0].props.id;
    expect(result.zones).toHaveProperty(`${newP}:zone:weird`);
  });

  it("props.id が数値型等 string 以外でも content 直下なら UUID に置換される (regenerateItem は id キーを無条件置換)", () => {
    // regenerateContent は regenerateItem を直接呼ぶため isComponentItem ガードを経由しない。
    // regenerateItem は key === "id" を無条件で nextId() に渡すので、数値 id も UUID に置換される。
    // (isComponentItem ガードは regenerateUnknown 経由のネスト検索にのみ使用される)
    const data: Data = {
      root: { props: {} },
      content: [{ type: "Heading", props: { id: 123 as any } }] as any,
    };
    const result = regeneratePuckDataIds(data);
    // 数値 id は UUID 文字列に置換される (string 型チェックは regenerateItem にはない)
    expect(typeof (result.content[0] as any).props.id).toBe("string");
    expect((result.content[0] as any).props.id).toBe("uuid-1");
  });
});
