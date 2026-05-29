/**
 * puckSubtree.test.ts — 複合部品 subtree 切出し / 展開ユーティリティの単体テスト (#1412 P-4)。
 *
 * - extractSubtree: DropZone 系 (zones map) / slot 系 (props 同居) の両系統。
 * - expandCompositePlaceholders: 展開 / id 一意性 / 冪等 / missing-dependency error-card 差替。
 */

import { describe, it, expect } from "vitest";
import type { Data } from "@measured/puck";
import {
  extractSubtree,
  expandCompositePlaceholders,
  collectSubtreeTypes,
  collectDependencies,
  compositeTypeName,
  type ExpandableComposite,
  type Subtree,
} from "./puckSubtree";

function data(d: unknown): Data {
  return d as Data;
}

// content / zones 全ノードの props.id を集める。
function allIds(d: Data): string[] {
  const ids: string[] = [];
  for (const item of d.content) {
    const id = (item as { props?: { id?: unknown } }).props?.id;
    if (typeof id === "string") ids.push(id);
  }
  if (d.zones) {
    for (const zc of Object.values(d.zones)) {
      for (const item of zc) {
        const id = (item as { props?: { id?: unknown } }).props?.id;
        if (typeof id === "string") ids.push(id);
      }
    }
  }
  return ids;
}

describe("extractSubtree", () => {
  it("DropZone 系: ルートノード + 紐づく zones サブセットを切り出す", () => {
    const d = data({
      root: { props: {} },
      content: [
        { type: "Card", props: { id: "card-1" } },
        { type: "Heading", props: { id: "other" } }, // subtree 外
      ],
      zones: {
        "card-1:content": [{ type: "Paragraph", props: { id: "p-1" } }],
        "other:content": [{ type: "Text", props: { id: "t-other" } }], // 切り出さない
      },
    });

    const sub = extractSubtree(d, "card-1");
    expect(sub).not.toBeNull();
    expect(sub!.content).toHaveLength(1);
    expect((sub!.content[0] as { props: { id: string } }).props.id).toBe("card-1");
    expect(sub!.zones).toHaveProperty("card-1:content");
    // subtree 外の zones は含めない。
    expect(sub!.zones).not.toHaveProperty("other:content");
  });

  it("DropZone 系: ネストした DropZone も再帰的に収集する", () => {
    const d = data({
      root: { props: {} },
      content: [{ type: "Card", props: { id: "outer" } }],
      zones: {
        "outer:content": [{ type: "Row", props: { id: "inner" } }],
        "inner:content": [{ type: "Text", props: { id: "leaf" } }],
      },
    });

    const sub = extractSubtree(d, "outer");
    expect(sub!.zones).toHaveProperty("outer:content");
    expect(sub!.zones).toHaveProperty("inner:content");
  });

  it("slot 系: 子が props 同居なのでルートノードを含めれば自然に取り込まれる", () => {
    const d = data({
      root: { props: {} },
      content: [
        {
          type: "ExtWidget",
          props: {
            id: "w-1",
            body: [{ type: "Heading", props: { id: "h-1" } }], // slot prop
          },
        },
      ],
    });

    const sub = extractSubtree(d, "w-1");
    expect(sub!.content).toHaveLength(1);
    // slot 中身は content ノードに co-located のまま含まれる。
    const props = (sub!.content[0] as { props: Record<string, unknown> }).props;
    expect(props.body).toBeDefined();
    // DropZone を使っていないので zones は付かない。
    expect(sub!.zones).toBeUndefined();
  });

  it("存在しない rootItemId は null を返す", () => {
    const d = data({ root: { props: {} }, content: [] });
    expect(extractSubtree(d, "missing")).toBeNull();
  });

  // --- #1415 P2-3: slot 子孫ノードが持つ legacy DropZone zones も収集する ---
  it("slot 系: slot 内の built-in が持つ legacy DropZone zones も subtree に保持する", () => {
    // root (外部 slot 部品) の props.body に、自前 DropZone (zones) を持つ built-in Card を
    // 内包するケース。slot 子ノード自体は props 同居で取り込まれるが、その Card が所有する
    // "inner-card:content" は zones map に別格納されるため別途収集が必要。
    const d = data({
      root: { props: {} },
      content: [
        {
          type: "ExtSection",
          props: {
            id: "sec-1",
            body: [{ type: "Card", props: { id: "inner-card" } }], // slot prop 内 built-in
          },
        },
        { type: "Heading", props: { id: "other" } }, // subtree 外
      ],
      zones: {
        // slot 子 (inner-card) が所有する legacy DropZone。
        "inner-card:content": [{ type: "Paragraph", props: { id: "p-inner" } }],
        "other:content": [{ type: "Text", props: { id: "t-other" } }], // 切り出さない
      },
    });

    const sub = extractSubtree(d, "sec-1");
    expect(sub).not.toBeNull();
    expect(sub!.content).toHaveLength(1);
    // slot 子孫の zones が脱落せず収集されている。
    expect(sub!.zones).toHaveProperty("inner-card:content");
    // subtree 外の zones は含めない。
    expect(sub!.zones).not.toHaveProperty("other:content");
  });

  it("slot 系: slot 子孫の DropZone がさらに slot 部品を含む場合も再帰収集する", () => {
    // ExtSection (root) → slot body 内 Card → Card の DropZone 内 ExtWidget → その slot 内 Card
    // という多段ネストでも全 zones が漏れず収集されることを検証。
    const d = data({
      root: { props: {} },
      content: [
        {
          type: "ExtSection",
          props: {
            id: "sec-1",
            body: [{ type: "Card", props: { id: "card-a" } }],
          },
        },
      ],
      zones: {
        "card-a:content": [
          {
            type: "ExtWidget",
            props: {
              id: "w-1",
              // slot 内にさらに legacy DropZone を持つ Card。
              slot: [{ type: "Card", props: { id: "card-b" } }],
            },
          },
        ],
        "card-b:content": [{ type: "Text", props: { id: "leaf" } }],
      },
    });

    const sub = extractSubtree(d, "sec-1");
    expect(sub!.zones).toHaveProperty("card-a:content");
    // slot 子孫 (card-b) の DropZone も収集される (zone 子の slot 走査経由)。
    expect(sub!.zones).toHaveProperty("card-b:content");
  });

  it("slot 系: save (extract) → expand round-trip で slot 子孫の nested 内容が保持される (#1415 P2-3)", () => {
    const d = data({
      root: { props: {} },
      content: [
        {
          type: "ExtSection",
          props: {
            id: "sec-1",
            body: [{ type: "Card", props: { id: "inner-card" } }],
          },
        },
      ],
      zones: {
        "inner-card:content": [{ type: "Paragraph", props: { id: "p-inner" } }],
      },
    });

    const sub = extractSubtree(d, "sec-1");
    expect(sub!.zones).toHaveProperty("inner-card:content");

    // この subtree を複合部品として展開する。
    const composite: ExpandableComposite = {
      id: "comp-sec",
      label: "セクション複合",
      tree: sub!,
      errorType: "__composite_error__comp-sec",
    };
    const available = new Set([
      "ExtSection",
      "Card",
      "Paragraph",
      compositeTypeName("comp-sec"),
    ]);
    const placeholder = data({
      root: { props: {} },
      content: [{ type: compositeTypeName("comp-sec"), props: { id: "ph" } }],
    });

    const result = expandCompositePlaceholders(placeholder, [composite], available);

    // root (ExtSection) が展開され、その slot 子 Card が保持されている。
    const root = result.content.find(
      (i) => (i as { type: string }).type === "ExtSection",
    ) as { props: { body: { type: string }[] } };
    expect(root).toBeDefined();
    expect(root.props.body[0].type).toBe("Card");
    // Card の nested DropZone (id 再生成済) の中身 Paragraph が脱落していない。
    const paragraphZone = Object.values(result.zones ?? {}).find((zc) =>
      zc.some((n) => (n as { type: string }).type === "Paragraph"),
    );
    expect(paragraphZone).toBeDefined();
  });

  it("zones 内のみに存在する rootItemId を切り出せる (S-2)", () => {
    // DropZone 内のノードを選択して複合部品化するケース。content 直下には無い。
    const d = data({
      root: { props: {} },
      content: [{ type: "Container", props: { id: "container-1" } }],
      zones: {
        "container-1:content": [
          { type: "Card", props: { id: "card-in-zone" } },
          { type: "Heading", props: { id: "h-sibling" } }, // subtree 外
        ],
        "card-in-zone:content": [{ type: "Paragraph", props: { id: "p-1" } }],
        "h-sibling:content": [{ type: "Text", props: { id: "t-other" } }], // 切り出さない
      },
    });

    const sub = extractSubtree(d, "card-in-zone");
    expect(sub).not.toBeNull();
    expect(sub!.content).toHaveLength(1);
    expect((sub!.content[0] as { props: { id: string } }).props.id).toBe(
      "card-in-zone",
    );
    // card-in-zone 配下の zone は収集する。
    expect(sub!.zones).toHaveProperty("card-in-zone:content");
    // root 自身が属していた zone (container-1:content) や兄弟の zone は含めない。
    expect(sub!.zones).not.toHaveProperty("container-1:content");
    expect(sub!.zones).not.toHaveProperty("h-sibling:content");
  });

  it("content・zones いずれにも存在しない rootItemId は null を返す (S-2)", () => {
    const d = data({
      root: { props: {} },
      content: [{ type: "Container", props: { id: "container-1" } }],
      zones: {
        "container-1:content": [{ type: "Card", props: { id: "card-1" } }],
      },
    });
    expect(extractSubtree(d, "missing")).toBeNull();
  });
});

describe("collectSubtreeTypes / collectDependencies", () => {
  const tree: Subtree = {
    content: [{ type: "Card", props: { id: "c" } }],
    zones: {
      "c:content": [
        { type: "Heading", props: { id: "h" } },
        { type: "ExtWidget", props: { id: "w" } },
      ],
    },
  };

  it("content + zones の全 type を列挙する", () => {
    const types = collectSubtreeTypes(tree);
    expect(types.sort()).toEqual(["Card", "ExtWidget", "Heading"]);
  });

  it("built-in 以外の type のみ dependencies として返す", () => {
    const builtins = new Set(["Card", "Heading"]);
    expect(collectDependencies(tree, builtins)).toEqual(["ExtWidget"]);
  });

  // --- #1415 P2-2: slot content (props 内 node 配列) を走査する ---
  it("slot content (props.<slot> の node 配列) 内の nested type も収集する", () => {
    const slotTree: Subtree = {
      content: [
        {
          type: "ExtCard", // 外部 slot 部品 (root)
          props: {
            id: "ext-1",
            // slot field の子は props.<slotName> の Puck node 配列に co-located。
            body: [
              { type: "Heading", props: { id: "h-1" } },
              { type: "InnerExtWidget", props: { id: "iw-1" } }, // nested 外部部品
            ],
          },
        },
      ],
    };
    expect(collectSubtreeTypes(slotTree).sort()).toEqual([
      "ExtCard",
      "Heading",
      "InnerExtWidget",
    ]);
  });

  it("slot content 内の nested 外部部品が dependencies に含まれる (#1415 P2-2)", () => {
    const slotTree: Subtree = {
      content: [
        {
          type: "ExtCard",
          props: {
            id: "ext-1",
            body: [{ type: "InnerExtWidget", props: { id: "iw-1" } }],
          },
        },
      ],
    };
    const builtins = new Set(["Heading", "Card"]);
    // ExtCard と nested InnerExtWidget の両方が依存として上がる。
    expect(collectDependencies(slotTree, builtins).sort()).toEqual([
      "ExtCard",
      "InnerExtWidget",
    ]);
  });

  it("業務 props がたまたま配列でも Puck node 形でなければ slot content とみなさない (誤検出回避)", () => {
    const tricky: Subtree = {
      content: [
        {
          type: "Widget",
          props: {
            id: "w-1",
            // type / props を持たない普通の配列 → slot content ではない。
            tags: ["a", "b"],
            rows: [{ value: 1 }, { value: 2 }],
          },
        },
      ],
    };
    expect(collectSubtreeTypes(tricky)).toEqual(["Widget"]);
  });
});

describe("expandCompositePlaceholders", () => {
  const composite: ExpandableComposite = {
    id: "comp-a",
    label: "複合A",
    tree: {
      content: [{ type: "Card", props: { id: "card-orig" } }],
      zones: {
        "card-orig:content": [{ type: "Heading", props: { id: "head-orig" } }],
      },
    },
    errorType: "__composite_error__comp-a",
  };
  const available = new Set(["Card", "Heading", compositeTypeName("comp-a")]);

  it("placeholder を subtree に展開し placeholder 自体は消える", () => {
    const d = data({
      root: { props: {} },
      content: [
        { type: "Paragraph", props: { id: "p-keep" } },
        { type: compositeTypeName("comp-a"), props: { id: "ph-1" } },
      ],
    });

    const result = expandCompositePlaceholders(d, [composite], available);

    const types = result.content.map((i) => (i as { type: string }).type);
    // placeholder は消え、subtree の Card が展開挿入される。
    expect(types).toContain("Card");
    expect(types).not.toContain(compositeTypeName("comp-a"));
    // 既存ノードは保持。
    expect(types).toContain("Paragraph");
    // subtree の zones が merge される (id は再生成済なのでキーは変わる)。
    const zoneKeys = Object.keys(result.zones ?? {});
    expect(zoneKeys.some((k) => k.endsWith(":content"))).toBe(true);
  });

  it("展開後ノードの id は再生成され元の id と異なり一意になる", () => {
    const d = data({
      root: { props: {} },
      content: [{ type: compositeTypeName("comp-a"), props: { id: "ph-1" } }],
    });

    const result = expandCompositePlaceholders(d, [composite], available);
    const ids = allIds(result);
    // 元の "card-orig" / "head-orig" は残っていない。
    expect(ids).not.toContain("card-orig");
    expect(ids).not.toContain("head-orig");
    // 全 id が一意。
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("2 回連続 drop しても id 衝突しない (展開ごとに別 id)", () => {
    const d = data({
      root: { props: {} },
      content: [
        { type: compositeTypeName("comp-a"), props: { id: "ph-1" } },
        { type: compositeTypeName("comp-a"), props: { id: "ph-2" } },
      ],
    });

    const result = expandCompositePlaceholders(d, [composite], available);
    const ids = allIds(result);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("冪等: placeholder が無ければ同一構造をそのまま返す", () => {
    const d = data({
      root: { props: {} },
      content: [{ type: "Paragraph", props: { id: "p-1" } }],
    });

    const result = expandCompositePlaceholders(d, [composite], available);
    expect(result).toBe(d); // 参照透過 (早期 return)
  });

  it("DropZone 内 drop: zone content 配列内の placeholder も展開される", () => {
    const d = data({
      root: { props: {} },
      content: [{ type: "Container", props: { id: "container-1" } }],
      zones: {
        "container-1:content": [
          { type: "Paragraph", props: { id: "p-keep" } },
          { type: compositeTypeName("comp-a"), props: { id: "ph-in-zone" } },
        ],
      },
    });

    const result = expandCompositePlaceholders(d, [composite], available);

    const zone = result.zones!["container-1:content"];
    const zoneTypes = zone.map((i) => (i as { type: string }).type);
    // placeholder は消え、subtree の Card が zone 内に展開挿入される。
    expect(zoneTypes).toContain("Card");
    expect(zoneTypes).not.toContain(compositeTypeName("comp-a"));
    // 既存 zone ノードは保持。
    expect(zoneTypes).toContain("Paragraph");
    // 展開された subtree の nested zones (id 再生成済) も merge される。
    const zoneKeys = Object.keys(result.zones ?? {});
    expect(zoneKeys).toContain("container-1:content");
    // subtree 内 Card の :content zone が新規キー (UUID) で追加されている。
    expect(zoneKeys.filter((k) => k.endsWith(":content")).length).toBeGreaterThan(1);
  });

  it("DropZone 内 drop: nested zones を持つ複合部品を zone 内に展開 → merge & id 一意", () => {
    const d = data({
      root: { props: {} },
      content: [{ type: "Container", props: { id: "container-1" } }],
      zones: {
        "container-1:content": [
          { type: compositeTypeName("comp-a"), props: { id: "ph-in-zone" } },
        ],
      },
    });

    const result = expandCompositePlaceholders(d, [composite], available);
    const ids = allIds(result);
    // 元の subtree id は残っていない (再生成済)。
    expect(ids).not.toContain("card-orig");
    expect(ids).not.toContain("head-orig");
    // 全 id が一意。
    expect(new Set(ids).size).toBe(ids.length);
    // 展開された Card の :content zone が新規キーで追加され、その中に Heading がある。
    const headingZone = Object.entries(result.zones ?? {}).find(
      ([k, zc]) =>
        k !== "container-1:content" &&
        zc.some((n) => (n as { type: string }).type === "Heading"),
    );
    expect(headingZone).toBeDefined();
  });

  it("content + zones 両方に placeholder がある場合に両方展開される", () => {
    const d = data({
      root: { props: {} },
      content: [
        { type: compositeTypeName("comp-a"), props: { id: "ph-top" } },
        { type: "Container", props: { id: "container-1" } },
      ],
      zones: {
        "container-1:content": [
          { type: compositeTypeName("comp-a"), props: { id: "ph-in-zone" } },
        ],
      },
    });

    const result = expandCompositePlaceholders(d, [composite], available);

    // content 直下の placeholder は消え Card に展開。
    const contentTypes = result.content.map((i) => (i as { type: string }).type);
    expect(contentTypes).toContain("Card");
    expect(contentTypes).not.toContain(compositeTypeName("comp-a"));
    // zone 内の placeholder も消え Card に展開。
    const zoneTypes = result.zones!["container-1:content"].map(
      (i) => (i as { type: string }).type,
    );
    expect(zoneTypes).toContain("Card");
    expect(zoneTypes).not.toContain(compositeTypeName("comp-a"));
    // 全 id が一意 (2 回の展開で衝突しない)。
    const ids = allIds(result);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("冪等: placeholder が content・zones いずれにも無ければ同一構造をそのまま返す", () => {
    const d = data({
      root: { props: {} },
      content: [{ type: "Container", props: { id: "container-1" } }],
      zones: {
        "container-1:content": [{ type: "Paragraph", props: { id: "p-1" } }],
      },
    });

    const result = expandCompositePlaceholders(d, [composite], available);
    expect(result).toBe(d); // 参照透過 (早期 return)
  });

  it("missing-dependency: 依存 type が availableTypes に無いノードは error-card 型に差し替える", () => {
    const compositeWithExt: ExpandableComposite = {
      id: "comp-ext",
      label: "外部依存複合",
      tree: {
        content: [{ type: "Card", props: { id: "card-x" } }],
        zones: {
          "card-x:content": [{ type: "ExtWidget", props: { id: "w-x" } }],
        },
      },
      errorType: "__composite_error__comp-ext",
    };
    // ExtWidget は available に無い (= 未ロード外部 component)。
    const availableNoExt = new Set([
      "Card",
      "Heading",
      compositeTypeName("comp-ext"),
      "__composite_error__comp-ext",
    ]);
    const d = data({
      root: { props: {} },
      content: [{ type: compositeTypeName("comp-ext"), props: { id: "ph" } }],
    });

    const result = expandCompositePlaceholders(d, [compositeWithExt], availableNoExt);

    // zones 内の ExtWidget ノードが error-card 型に差し替わっている。
    const zoneNodes = Object.values(result.zones ?? {}).flat();
    const errorNode = zoneNodes.find(
      (n) => (n as { type: string }).type === "__composite_error__comp-ext",
    );
    expect(errorNode).toBeDefined();
    expect(
      (errorNode as { props: { missingType?: string } }).props.missingType,
    ).toBe("ExtWidget");
  });

  // --- #1415 P2-2: slot content 内の未ロード依存も error-card 化する ---
  it("missing-dependency: slot content (props 内 node 配列) 内の未ロード type も error-card 型に差し替える", () => {
    const compositeSlot: ExpandableComposite = {
      id: "comp-slot",
      label: "slot 内外部依存複合",
      tree: {
        // root は available な ExtCard。その slot (props.body) に未ロード InnerExtWidget を内包。
        content: [
          {
            type: "ExtCard",
            props: {
              id: "card-slot",
              body: [{ type: "InnerExtWidget", props: { id: "iw-1" } }],
            },
          },
        ],
      },
      errorType: "__composite_error__comp-slot",
    };
    // ExtCard は available、InnerExtWidget は available に無い (= 未ロード)。
    const availableNoInner = new Set([
      "ExtCard",
      compositeTypeName("comp-slot"),
      "__composite_error__comp-slot",
    ]);
    const d = data({
      root: { props: {} },
      content: [{ type: compositeTypeName("comp-slot"), props: { id: "ph" } }],
    });

    const result = expandCompositePlaceholders(d, [compositeSlot], availableNoInner);

    // 展開後 content の root ノード (ExtCard) は残り、その props.body 内 InnerExtWidget が
    // error-card 型に差し替わっている。
    const root = result.content.find(
      (i) => (i as { type: string }).type === "ExtCard",
    ) as { props: { body: { type: string; props: { missingType?: string } }[] } };
    expect(root).toBeDefined();
    const inner = root.props.body[0];
    expect(inner.type).toBe("__composite_error__comp-slot");
    expect(inner.props.missingType).toBe("InnerExtWidget");
  });

  // --- #1415 P2-4: slot props に drop された複合部品 placeholder も展開する ---
  it("slot props 内に drop された複合部品 placeholder が subtree に展開され transient placeholder が残らない", () => {
    // 外部 component ExtCard の slot (props.body) に comp-a の placeholder を drop した状態の data。
    const d = data({
      root: { props: {} },
      content: [
        {
          type: "ExtCard",
          props: {
            id: "card-host",
            body: [
              { type: "Paragraph", props: { id: "p-keep" } },
              { type: compositeTypeName("comp-a"), props: { id: "ph-in-slot" } },
            ],
          },
        },
      ],
    });
    const availableWithExt = new Set([
      "ExtCard",
      "Card",
      "Heading",
      "Paragraph",
      compositeTypeName("comp-a"),
    ]);

    const result = expandCompositePlaceholders(d, [composite], availableWithExt);

    // host ノード (ExtCard) は残る。
    const host = result.content.find(
      (i) => (i as { type: string }).type === "ExtCard",
    ) as { props: { body: { type: string; props: { id: string } }[] } };
    expect(host).toBeDefined();
    const slotTypes = host.props.body.map((n) => n.type);
    // slot 内の placeholder は展開され Card に置き換わり、transient placeholder は消える。
    expect(slotTypes).toContain("Card");
    expect(slotTypes).not.toContain(compositeTypeName("comp-a"));
    // slot 内の既存ノードは保持。
    expect(slotTypes).toContain("Paragraph");
    // 展開された subtree の nested zones (Card:content の Heading) が merge される。
    const zoneKeys = Object.keys(result.zones ?? {});
    expect(zoneKeys.some((k) => k.endsWith(":content"))).toBe(true);
    // 元の subtree id は再生成され残らない & 全 id 一意。
    const slotIds = host.props.body.map((n) => n.props.id);
    expect(slotIds).not.toContain("card-orig");
    const allResultIds = [...allIds(result), ...slotIds];
    expect(new Set(allResultIds).size).toBe(allResultIds.length);
  });

  it("slot props のみに placeholder がある場合でも早期 return せず展開される (再適用で冪等)", () => {
    const d = data({
      root: { props: {} },
      content: [
        {
          type: "ExtCard",
          props: {
            id: "card-host",
            body: [{ type: compositeTypeName("comp-a"), props: { id: "ph-in-slot" } }],
          },
        },
      ],
    });
    const availableWithExt = new Set([
      "ExtCard",
      "Card",
      "Heading",
      compositeTypeName("comp-a"),
    ]);

    const first = expandCompositePlaceholders(d, [composite], availableWithExt);
    const firstHost = first.content[0] as { props: { body: { type: string }[] } };
    expect(firstHost.props.body.map((n) => n.type)).not.toContain(
      compositeTypeName("comp-a"),
    );
    // 再適用すると placeholder が無いため参照透過に同一構造を返す (冪等)。
    const second = expandCompositePlaceholders(first, [composite], availableWithExt);
    expect(second).toBe(first);
  });
});
