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
