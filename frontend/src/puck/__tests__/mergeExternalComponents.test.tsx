/**
 * mergeExternalComponents.test.tsx — 外部 component の Puck config 統合テスト (#1409 P-1)。
 *
 * - status="ok": 実 component を render する render 関数になる
 * - status="error": ExternalComponentErrorCard を render する render 関数になる
 */
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { buildPuckConfig, mergeExternalComponents } from "../buildConfig";
import type { LoadedExternalComponent } from "../externalComponents";
import type { ExternalComponentEntry } from "../externalComponentManifest";

const entry: ExternalComponentEntry = {
  id: "ext-foo",
  label: "外部Foo",
  module: "./dist/foo.mjs",
  version: "1.0.0",
  props: [
    { name: "title", type: "string", default: "デフォルト見出し" },
    { name: "noDefault", type: "string" },
  ],
};

describe("mergeExternalComponents", () => {
  it("loaded が空なら base をそのまま返す", () => {
    const base = buildPuckConfig();
    const merged = mergeExternalComponents(base, []);
    expect(Object.keys(merged.components).length).toBe(
      Object.keys(base.components).length,
    );
  });

  it("status=ok: 実 component を render する config を登録する", () => {
    const ExtComponent = (props: { title?: string }) => (
      <div data-testid="ext-rendered">{props.title}</div>
    );
    const loaded: LoadedExternalComponent[] = [
      { entry, status: "ok", Component: ExtComponent },
    ];
    const merged = mergeExternalComponents(buildPuckConfig(), loaded);

    const def = merged.components["ext-foo"];
    expect(def).toBeDefined();
    expect(def.label).toBe("(外部) 外部Foo");
    // defaultProps は manifest props の default 集約
    expect(def.defaultProps).toEqual({ title: "デフォルト見出し" });

    const { getByTestId } = render(
      <>{def.render({ title: "実行時タイトル", puck: { renderDropZone: () => null } } as never)}</>,
    );
    expect(getByTestId("ext-rendered").textContent).toBe("実行時タイトル");
  });

  it("status=error: エラーカードを render する config を登録する", () => {
    const loaded: LoadedExternalComponent[] = [
      {
        entry,
        status: "error",
        errorKind: "load-error",
        detail: "boom detail",
      },
    ];
    const merged = mergeExternalComponents(buildPuckConfig(), loaded);

    const def = merged.components["ext-foo"];
    expect(def).toBeDefined();
    expect(def.label).toBe("(外部·エラー) 外部Foo");

    const { getByTestId } = render(
      <>{def.render({ puck: { renderDropZone: () => null } } as never)}</>,
    );
    const card = getByTestId("external-component-error-card");
    expect(card.getAttribute("data-error-kind")).toBe("load-error");
    expect(card.textContent).toContain("モジュール読込失敗");
    expect(card.textContent).toContain("外部Foo");
  });

  it("id 衝突 (built-in Container): 既存を上書きせずエラーカードを別 key で登録", () => {
    const base = buildPuckConfig();
    // built-in の Container 実体 (config object) を控えておく
    const originalContainer = base.components["Container"];
    const originalContainerRender = originalContainer.render;
    const collidingEntry: ExternalComponentEntry = {
      ...entry,
      id: "Container",
      label: "悪意のContainer",
    };
    const loaded: LoadedExternalComponent[] = [
      { entry: collidingEntry, status: "ok", Component: () => null },
    ];
    const merged = mergeExternalComponents(base, loaded);

    // built-in Container は上書きされず元の実体がそのまま保持される
    expect(merged.components["Container"]).toBe(originalContainer);
    expect(merged.components["Container"].render).toBe(originalContainerRender);
    expect(merged.components["Container"].label).not.toContain("外部");

    // 衝突は base に無い一意 key でエラーカードとして登録される
    const collisionEntries = Object.entries(merged.components).filter(
      ([k]) => !(k in base.components) && k !== "Container",
    );
    expect(collisionEntries.length).toBe(1);
    const [collisionKey, collisionDef] = collisionEntries[0];
    // 採番 key は base.components の既存 key と衝突しない
    expect(base.components[collisionKey]).toBeUndefined();
    expect(collisionDef).toBeDefined();
    const { getByTestId } = render(
      <>{collisionDef.render({ puck: { renderDropZone: () => null } } as never)}</>,
    );
    const card = getByTestId("external-component-error-card");
    expect(card.getAttribute("data-error-kind")).toBe("id-collision");
    expect(card.textContent).toContain("ID 衝突");
  });

  it("id 衝突なし: 通常通り実 component を登録する", () => {
    const base = buildPuckConfig();
    const baseKeyCount = Object.keys(base.components).length;
    const loaded: LoadedExternalComponent[] = [
      { entry, status: "ok", Component: () => null },
    ];
    const merged = mergeExternalComponents(base, loaded);
    const def = merged.components["ext-foo"];
    expect(def).toBeDefined();
    expect(def.label).toBe("(外部) 外部Foo");
    // 衝突カードは作られず、base + 1 component のみ
    expect(Object.keys(merged.components).length).toBe(baseKeyCount + 1);
  });

  it("同一 manifest 内で id 重複: 1 件目は実 component、2 件目は id-collision、base 不変", () => {
    const base = buildPuckConfig();
    const baseKeys = Object.keys(base.components);
    const dupEntry: ExternalComponentEntry = {
      ...entry,
      id: "ext-dup",
      label: "重複ext",
    };
    const loaded: LoadedExternalComponent[] = [
      { entry: dupEntry, status: "ok", Component: () => <div>first</div> },
      { entry: dupEntry, status: "ok", Component: () => <div>second</div> },
    ];
    const merged = mergeExternalComponents(base, loaded);

    // 1 件目は実 component として ext-dup key に登録
    expect(merged.components["ext-dup"]).toBeDefined();
    expect(merged.components["ext-dup"].label).toBe("(外部) 重複ext");

    // 2 件目は id-collision エラーカードとして別 key に登録
    const extra = Object.entries(merged.components).filter(
      ([k]) => !baseKeys.includes(k) && k !== "ext-dup",
    );
    expect(extra.length).toBe(1);
    const [collisionKey, collisionDef] = extra[0];
    expect(base.components[collisionKey]).toBeUndefined();
    const { getByTestId } = render(
      <>{collisionDef.render({ puck: { renderDropZone: () => null } } as never)}</>,
    );
    expect(getByTestId("external-component-error-card").getAttribute("data-error-kind")).toBe(
      "id-collision",
    );

    // base.components は不変 (key 数も実体も)
    for (const k of baseKeys) {
      expect(merged.components[k]).toBe(base.components[k]);
    }
  });

  it("衝突カード key が既存 literal key と衝突しない (一意採番)", () => {
    // base に collision カードが採番しうる literal key を仕込んでおく。
    // i=0 の衝突カードは `__ext_error__Container__0` を採番しようとするため、
    // それを base に literal で予約しておき、別の一意 key に逃げることを検証する。
    const rawBase = buildPuckConfig();
    const occupiedKey = "__ext_error__Container__0";
    const base: typeof rawBase = {
      ...rawBase,
      components: {
        ...rawBase.components,
        [occupiedKey]: {
          label: "占有済みカスタム",
          fields: {},
          defaultProps: {},
          render: () => <div data-testid="occupier">occupier</div>,
        },
      },
    };
    const occupierDef = base.components[occupiedKey];
    const collidingEntry: ExternalComponentEntry = {
      ...entry,
      id: "Container",
      label: "悪意のContainer",
    };
    const loaded: LoadedExternalComponent[] = [
      { entry: collidingEntry, status: "ok", Component: () => null },
    ];
    const merged = mergeExternalComponents(base, loaded);

    // 占有済み key は上書きされず元の実体がそのまま保持される
    expect(merged.components[occupiedKey]).toBe(occupierDef);

    // 衝突カードは occupiedKey とも Container とも別の一意 key に登録される
    const collisionEntries = Object.entries(merged.components).filter(
      ([k]) => !(k in base.components),
    );
    expect(collisionEntries.length).toBe(1);
    const [collisionKey, collisionDef] = collisionEntries[0];
    expect(collisionKey).not.toBe(occupiedKey);
    expect(collisionKey).not.toBe("Container");
    const { getByTestId } = render(
      <>{collisionDef.render({ puck: { renderDropZone: () => null } } as never)}</>,
    );
    expect(getByTestId("external-component-error-card").getAttribute("data-error-kind")).toBe(
      "id-collision",
    );
  });

  it("base の既存 component を保持する", () => {
    const base = buildPuckConfig();
    const baseKeys = Object.keys(base.components);
    const loaded: LoadedExternalComponent[] = [
      { entry, status: "ok", Component: () => null },
    ];
    const merged = mergeExternalComponents(base, loaded);
    for (const k of baseKeys) {
      expect(merged.components[k]).toBeDefined();
    }
    expect(merged.components["ext-foo"]).toBeDefined();
  });
});

describe("mergeExternalComponents props→fields (#1410 P-2)", () => {
  const fieldEntry: ExternalComponentEntry = {
    id: "ext-fields",
    label: "外部Fields",
    module: "./dist/fields.mjs",
    version: "1.0.0",
    props: [
      { name: "title", type: "string", label: "タイトル" },
      { name: "count", type: "number", label: "件数" },
      { name: "enabled", type: "boolean", label: "有効" },
      {
        name: "mode",
        type: "enum",
        label: "モード",
        enum: [
          { label: "標準", value: "normal" },
          { label: "高速", value: "fast" },
        ],
      },
    ],
  };

  it("status=ok の props が正しい Puck field 型に変換される", () => {
    const loaded: LoadedExternalComponent[] = [
      { entry: fieldEntry, status: "ok", Component: () => null },
    ];
    const merged = mergeExternalComponents(buildPuckConfig(), loaded);
    const fields = merged.components["ext-fields"].fields!;

    expect(fields.title.type).toBe("text");
    expect(fields.count.type).toBe("number");
    expect(fields.enabled.type).toBe("radio");
    expect(fields.mode.type).toBe("select");
  });

  it("boolean は はい/いいえ の radio options", () => {
    const loaded: LoadedExternalComponent[] = [
      { entry: fieldEntry, status: "ok", Component: () => null },
    ];
    const merged = mergeExternalComponents(buildPuckConfig(), loaded);
    const f = merged.components["ext-fields"].fields!.enabled as {
      type: string;
      options: { label: string; value: string }[];
    };
    expect(f.type).toBe("radio");
    expect(f.options).toEqual([
      { label: "はい", value: "true" },
      { label: "いいえ", value: "false" },
    ]);
  });

  it("enum は options を反映した select", () => {
    const loaded: LoadedExternalComponent[] = [
      { entry: fieldEntry, status: "ok", Component: () => null },
    ];
    const merged = mergeExternalComponents(buildPuckConfig(), loaded);
    const f = merged.components["ext-fields"].fields!.mode as {
      type: string;
      options: { label: string; value: string }[];
    };
    expect(f.type).toBe("select");
    expect(f.options).toEqual([
      { label: "標準", value: "normal" },
      { label: "高速", value: "fast" },
    ]);
  });
});

describe("mergeExternalComponents slot fields (#1411 P-3)", () => {
  const slotEntry: ExternalComponentEntry = {
    id: "ext-slot",
    label: "外部Slot",
    module: "./dist/slot.mjs",
    version: "1.0.0",
    slots: [{ name: "content", label: "本文スロット" }],
  };

  it("slots 宣言された ok entry は当該 slot 名で slot field を生成する", () => {
    const loaded: LoadedExternalComponent[] = [
      { entry: slotEntry, status: "ok", Component: () => null },
    ];
    const merged = mergeExternalComponents(buildPuckConfig(), loaded);
    const fields = merged.components["ext-slot"].fields!;
    expect(fields.content.type).toBe("slot");
    expect((fields.content as { label?: string }).label).toBe("本文スロット");
  });

  it("slot label 省略時は slot 名を label に使う", () => {
    const noLabel: ExternalComponentEntry = {
      ...slotEntry,
      slots: [{ name: "content" }],
    };
    const loaded: LoadedExternalComponent[] = [
      { entry: noLabel, status: "ok", Component: () => null },
    ];
    const merged = mergeExternalComponents(buildPuckConfig(), loaded);
    const f = merged.components["ext-slot"].fields!.content as {
      type: string;
      label?: string;
    };
    expect(f.type).toBe("slot");
    expect(f.label).toBe("content");
  });

  it("defaultProps[slotName] は空配列で初期化される", () => {
    const loaded: LoadedExternalComponent[] = [
      { entry: slotEntry, status: "ok", Component: () => null },
    ];
    const merged = mergeExternalComponents(buildPuckConfig(), loaded);
    expect(merged.components["ext-slot"].defaultProps!.content).toEqual([]);
  });

  it("slot + prop 併存時、両方が fields に乗り prop field 型は従来通り", () => {
    const mixed: ExternalComponentEntry = {
      id: "ext-mixed",
      label: "外部Mixed",
      module: "./dist/mixed.mjs",
      version: "1.0.0",
      props: [
        { name: "title", type: "string", label: "タイトル", default: "T" },
        { name: "count", type: "number", label: "件数" },
      ],
      slots: [{ name: "body", label: "本体" }],
    };
    const loaded: LoadedExternalComponent[] = [
      { entry: mixed, status: "ok", Component: () => null },
    ];
    const merged = mergeExternalComponents(buildPuckConfig(), loaded);
    const fields = merged.components["ext-mixed"].fields!;
    expect(fields.title.type).toBe("text");
    expect(fields.count.type).toBe("number");
    expect(fields.body.type).toBe("slot");
    // prop default は維持、slot は空配列で初期化
    expect(merged.components["ext-mixed"].defaultProps).toEqual({
      title: "T",
      body: [],
    });
  });

  it("slot 無し entry は slot field を追加しない (回帰なし)", () => {
    const loaded: LoadedExternalComponent[] = [
      { entry, status: "ok", Component: () => null },
    ];
    const merged = mergeExternalComponents(buildPuckConfig(), loaded);
    const fields = merged.components["ext-foo"].fields!;
    const slotFieldKeys = Object.entries(fields).filter(
      ([, def]) => (def as { type: string }).type === "slot",
    );
    expect(slotFieldKeys.length).toBe(0);
  });
});

describe("mergeExternalComponents categories (#1410 P-2)", () => {
  it("外部 0 件 (loaded=[]) のとき categories は base と同一 (projectExternal 無し)", () => {
    const base = buildPuckConfig();
    const merged = mergeExternalComponents(base, []);
    expect(merged.categories?.projectExternal).toBeUndefined();
    // early return で base そのものが返る
    expect(merged.categories).toBe(base.categories);
  });

  it("projectExternal カテゴリに ok 外部 id が入る", () => {
    const loaded: LoadedExternalComponent[] = [
      { entry, status: "ok", Component: () => null },
    ];
    const merged = mergeExternalComponents(buildPuckConfig(), loaded);
    expect(merged.categories?.projectExternal).toBeDefined();
    expect(merged.categories!.projectExternal!.title).toBe("プロジェクト部品 (外部)");
    expect(merged.categories!.projectExternal!.components).toContain("ext-foo");
    // base カテゴリは不変
    expect(merged.categories?.layout?.components).toContain("Container");
  });

  it("status=error の entry の key も projectExternal.components に含まれる", () => {
    const errEntry: ExternalComponentEntry = {
      ...entry,
      id: "ext-err",
      label: "エラーext",
    };
    const loaded: LoadedExternalComponent[] = [
      {
        entry: errEntry,
        status: "error",
        errorKind: "load-error",
        detail: "boom",
      },
    ];
    const merged = mergeExternalComponents(buildPuckConfig(), loaded);
    expect(merged.categories!.projectExternal!.components).toContain("ext-err");
  });

  it("id 衝突カードの採番 key も projectExternal.components に含まれる", () => {
    const base = buildPuckConfig();
    const collidingEntry: ExternalComponentEntry = {
      ...entry,
      id: "Container",
      label: "悪意のContainer",
    };
    const loaded: LoadedExternalComponent[] = [
      { entry: collidingEntry, status: "ok", Component: () => null },
    ];
    const merged = mergeExternalComponents(base, loaded);

    const ext = merged.categories!.projectExternal!.components as string[];
    expect(ext.length).toBe(1);
    const collisionKey = ext[0];
    // Container 本体ではなく採番された衝突カード key
    expect(collisionKey).not.toBe("Container");
    expect(base.components[collisionKey]).toBeUndefined();
    expect(merged.components[collisionKey]).toBeDefined();
  });

  it("base が projectCustom を持つ場合も保持しつつ projectExternal を追加する", () => {
    const base: ReturnType<typeof buildPuckConfig> = {
      ...buildPuckConfig(),
      categories: {
        ...buildPuckConfig().categories,
        projectCustom: { title: "プロジェクト部品 (カスタム)", components: ["c1"] },
      },
    };
    const loaded: LoadedExternalComponent[] = [
      { entry, status: "ok", Component: () => null },
    ];
    const merged = mergeExternalComponents(base, loaded);
    expect(merged.categories?.projectCustom?.components).toContain("c1");
    expect(merged.categories?.projectExternal?.components).toContain("ext-foo");
  });
});
