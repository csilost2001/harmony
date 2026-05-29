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
});
