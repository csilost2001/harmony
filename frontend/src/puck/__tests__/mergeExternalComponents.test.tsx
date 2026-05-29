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
