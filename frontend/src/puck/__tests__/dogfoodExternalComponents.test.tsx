/**
 * dogfoodExternalComponents.test.tsx — 外部 component + 複合部品 dogfood 通し検証 (#1413 P-5)。
 *
 * RFC #1405 シリーズ P-5。P-1〜P-4 で実装した外部 React Component 読込基盤を、
 * **実 scaffold → vite build した本物の業務部品** (承認ステータス帯) で 1 ファイルに通し検証する。
 *
 * fixture (hermetic):
 *   - fixtures/external-dogfood/approval-status-bar.mjs  : 実 vite build 成果物 (ESM)
 *   - fixtures/external-dogfood/manifest.json            : 編集済 manifest (enum prop + slot)
 *   - fixtures/external-dogfood/ApprovalStatusBar.source.tsx : 出典ソース (参照用)
 *
 * capability 1-6 を it 名に cap 番号付きで明示する:
 *   cap1: loading + React 二重化防止 (実 .mjs を vitest 経由で実 import → render → hooks 動作)
 *   cap2: palette カテゴリ登録 / cap3: props→fields 変換
 *   cap4: slot field + 複合部品 (#1412) 展開 (ロード済 / 未ロード)
 *   cap5: project scoping (workspace 間で混入しない / id 衝突防御)
 *   cap6: validation / fallback (manifest-invalid / version-mismatch / missing-export / load-error)
 *
 * 既存 externalComponents.test.ts / mergeExternalComponents.test.tsx / puckSubtree.test.ts の
 * API シグネチャ・書き方に合わせている。
 */
import { createElement } from "react";
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import type { Data } from "@measured/puck";

import manifestJson from "./fixtures/external-dogfood/manifest.json";
import { loadExternalComponents } from "../externalComponents";
import type { LoadedExternalComponent } from "../externalComponents";
import {
  buildPuckConfig,
  mergeExternalComponents,
  mergeCompositeComponents,
  compositeErrorTypeName,
  BUILTIN_PRIMITIVE_TYPE_NAMES,
} from "../buildConfig";
import {
  compositeTypeName,
  expandCompositePlaceholders,
  collectDependencies,
  type ExpandableComposite,
  type Subtree,
} from "../../editor/puckSubtree";
import type { CompositePuckComponentDef } from "../../store/puckComponentsStore";

const ORIGIN = "http://localhost:5179";
const ASSET_PREFIX = "/workspace-assets/puck-components/";
// 実 vite build 成果物 (.mjs)。loader が解決する moduleUrl はこの fixture へ向ける。
const FIXTURE_MJS_URL = `${ORIGIN}${ASSET_PREFIX}dist/approval-status-bar.mjs`;

/** fixture manifest.json をそのまま返す fetch stub。 */
function fixtureFetch(manifest: unknown = manifestJson): typeof fetch {
  return vi.fn(async (url: string) => {
    // loader は `${origin}${prefix}manifest.json` を取りに来る。
    expect(String(url)).toContain("manifest.json");
    return {
      ok: true,
      status: 200,
      json: async () => manifest,
    } as unknown as Response;
  }) as unknown as typeof fetch;
}

/**
 * 実 .mjs を vitest (vite transform) 経由で動的 import する importImpl。
 *
 * loader が resolveSafeModuleUrl で生成する moduleUrl
 * (= `${ORIGIN}${ASSET_PREFIX}dist/approval-status-bar.mjs`) を、ローカル fixture の
 * 相対 import に振り替える。これにより「実 build 成果物を host React で実 import して render」
 * = cap1 (React 二重化防止) を本物の artifact で検証できる。
 *
 * fixture .mjs は bare specifier `import * as React from "react"` /
 * `import { jsx } from "react/jsx-runtime"` を持つため、vitest がそれを host (テストプロセス) の
 * react に解決する → host React と同一インスタンスになる (= 二重化しない)。
 */
async function realFixtureImport(url: string): Promise<Record<string, unknown>> {
  expect(url).toBe(FIXTURE_MJS_URL);
  const mod = await import("./fixtures/external-dogfood/approval-status-bar.mjs");
  return mod as unknown as Record<string, unknown>;
}

/** loaded 配列から id で 1 件取り出す。 */
function pick(
  loaded: LoadedExternalComponent[],
  id: string,
): LoadedExternalComponent {
  const found = loaded.find((l) => l.entry.id === id);
  if (!found) throw new Error(`loaded entry not found: ${id}`);
  return found;
}

describe("dogfood: 外部 component 通し検証 (#1413 P-5)", () => {
  // -----------------------------------------------------------------------
  // cap1: loading + React 二重化防止
  // -----------------------------------------------------------------------
  it("cap1: 実 build した .mjs を loader で読み込み status=ok、render すると hooks が動く (React 同一インスタンス)", async () => {
    const loaded = await loadExternalComponents({
      backendOrigin: ORIGIN,
      fetchImpl: fixtureFetch(),
      importImpl: realFixtureImport,
    });
    expect(loaded).toHaveLength(1);
    const item = pick(loaded, "approval-status-bar");
    expect(item.status).toBe("ok");
    if (item.status !== "ok") return;

    // 実 component を React element として render する (createElement、Puck の render 経路と同じ)。
    // 内部で useState を使うため、host React と別インスタンスなら "Invalid hook call" で throw
    // する。throw せず描画できることが二重化防止の証跡。
    // 注意: Component({...}) と直呼びすると render 外実行になり dispatcher が null で hooks が
    // 必ず落ちる。必ず createElement 経由で render する。
    const { getByText, getByTestId } = render(
      createElement(item.Component, { status: "approved", title: "稟議書 #42" }),
    );
    // 見出しと status バッジ (hooks 経由の描画) が出る。
    expect(getByText("稟議書 #42")).toBeTruthy();
    const badge = getByTestId("approval-status-badge");
    expect(badge.textContent).toBe("承認済み");
  });

  // -----------------------------------------------------------------------
  // cap2 (palette) + cap3 (props→fields)
  // -----------------------------------------------------------------------
  it("cap2+cap3: mergeExternalComponents で projectExternal カテゴリ登録 + props が Puck fields に変換される", async () => {
    const loaded = await loadExternalComponents({
      backendOrigin: ORIGIN,
      fetchImpl: fixtureFetch(),
      importImpl: realFixtureImport,
    });
    const config = mergeExternalComponents(buildPuckConfig(), loaded);

    // cap2: component 登録 + palette カテゴリ
    expect(config.components["approval-status-bar"]).toBeDefined();
    expect(config.components["approval-status-bar"].label).toBe("(外部) 承認ステータス帯");
    expect(config.categories?.projectExternal?.components).toContain("approval-status-bar");
    // base カテゴリは不変 (回帰なし)
    expect(config.categories?.layout?.components).toContain("Container");

    // cap3: props→fields
    const fields = config.components["approval-status-bar"].fields!;
    // title (string) → text
    expect(fields.title.type).toBe("text");
    // status (enum) → select、enum options が透過される
    const statusField = fields.status as {
      type: string;
      options: { label: string; value: string }[];
    };
    expect(statusField.type).toBe("select");
    expect(statusField.options).toEqual([
      { label: "承認待ち", value: "pending" },
      { label: "承認済み", value: "approved" },
      { label: "却下", value: "rejected" },
    ]);
    // defaultProps は manifest default 集約 (title / status) + slot 空配列
    const dp = config.components["approval-status-bar"].defaultProps!;
    expect(dp.title).toBe("承認ステータス");
    expect(dp.status).toBe("pending");
  });

  // -----------------------------------------------------------------------
  // cap4: slot field + render-prop 注入
  // -----------------------------------------------------------------------
  it("cap4(slot): content slot が slot field + defaultProps[content]=[] で初期化され、render-prop 注入で内部が描画される", async () => {
    const loaded = await loadExternalComponents({
      backendOrigin: ORIGIN,
      fetchImpl: fixtureFetch(),
      importImpl: realFixtureImport,
    });
    const config = mergeExternalComponents(buildPuckConfig(), loaded);
    const def = config.components["approval-status-bar"];

    // slot field
    const contentField = def.fields!.content as { type: string; label?: string };
    expect(contentField.type).toBe("slot");
    expect(contentField.label).toBe("本文スロット");
    // 空 editable region で初期化
    expect(def.defaultProps!.content).toEqual([]);

    // render-prop 注入: Puck は slot prop を render-prop に変換して注入する。
    // mergeExternalComponents の render は createElement(Component, props) で透過するため、
    // content() が呼ばれて内部が描画される。
    const { getByText } = render(
      <>
        {def.render({
          status: "pending",
          title: "申請書",
          content: () => <span>SLOT_INNER_BODY</span>,
          puck: { renderDropZone: () => null },
        } as never)}
      </>,
    );
    expect(getByText("SLOT_INNER_BODY")).toBeTruthy();
  });

  // -----------------------------------------------------------------------
  // cap4: 複合部品 (#1412) — ロード済 / 未ロード
  // -----------------------------------------------------------------------
  it("cap4(composite): approval-status-bar を内包する複合部品をロード済 config で展開すると成功する", async () => {
    const loaded = await loadExternalComponents({
      backendOrigin: ORIGIN,
      fetchImpl: fixtureFetch(),
      importImpl: realFixtureImport,
    });
    let config = mergeExternalComponents(buildPuckConfig(), loaded);

    const def: CompositePuckComponentDef = {
      id: "approval-card",
      kind: "composite",
      label: "承認カード",
      tree: {
        content: [{ type: "Card", props: { id: "card-root" } }],
        zones: {
          // Card の中に外部部品 approval-status-bar を内包する。
          "card-root:content": [
            { type: "approval-status-bar", props: { id: "asb-1", status: "approved" } },
          ],
        },
      },
      dependencies: ["approval-status-bar"],
    };

    config = mergeCompositeComponents(config, [def]);
    // placeholder が projectComposite カテゴリに並ぶ
    expect(config.categories?.projectComposite?.components).toContain(
      compositeTypeName("approval-card"),
    );

    const expandable: ExpandableComposite = {
      id: def.id,
      label: def.label,
      tree: def.tree as Subtree,
      errorType: compositeErrorTypeName(def.id),
    };
    // availableTypes は config の全 type (外部 component 込み)。
    const availableTypes = new Set(Object.keys(config.components));
    // ロード済なので外部 component は available に含まれる → 依存欠落なし。
    const builtinTypes = new Set(BUILTIN_PRIMITIVE_TYPE_NAMES);
    expect(collectDependencies(def.tree as Subtree, builtinTypes)).toEqual([
      "approval-status-bar",
    ]);

    const data = {
      root: { props: {} },
      content: [{ type: compositeTypeName("approval-card"), props: { id: "ph" } }],
    } as Data;
    const result = expandCompositePlaceholders(data, [expandable], availableTypes);

    // placeholder は消え Card に展開、内部に approval-status-bar が残る (error-card にならない)。
    const contentTypes = result.content.map((i) => (i as { type: string }).type);
    expect(contentTypes).toContain("Card");
    expect(contentTypes).not.toContain(compositeTypeName("approval-card"));
    const zoneNodes = Object.values(result.zones ?? {}).flat();
    const types = zoneNodes.map((n) => (n as { type: string }).type);
    expect(types).toContain("approval-status-bar");
    expect(types).not.toContain(compositeErrorTypeName("approval-card"));
  });

  it("cap4(composite): 未ロードの外部 type を内包する複合部品は missing-dependency error-card に落ちる", () => {
    // approval-status-bar をロードしない config (= built-in のみ)。
    const config = mergeCompositeComponents(buildPuckConfig(), [
      {
        id: "approval-card",
        kind: "composite",
        label: "承認カード",
        tree: {
          content: [{ type: "Card", props: { id: "card-root" } }],
          zones: {
            "card-root:content": [
              { type: "approval-status-bar", props: { id: "asb-1" } },
            ],
          },
        },
        dependencies: ["approval-status-bar"],
      } satisfies CompositePuckComponentDef,
    ]);

    const expandable: ExpandableComposite = {
      id: "approval-card",
      label: "承認カード",
      tree: {
        content: [{ type: "Card", props: { id: "card-root" } }],
        zones: {
          "card-root:content": [
            { type: "approval-status-bar", props: { id: "asb-1" } },
          ],
        },
      },
      errorType: compositeErrorTypeName("approval-card"),
    };
    // availableTypes に approval-status-bar が無い (= 未ロード)。
    const availableTypes = new Set(Object.keys(config.components));
    expect(availableTypes.has("approval-status-bar")).toBe(false);

    const data = {
      root: { props: {} },
      content: [{ type: compositeTypeName("approval-card"), props: { id: "ph" } }],
    } as Data;
    const result = expandCompositePlaceholders(data, [expandable], availableTypes);

    // 依存欠落ノードが error-card 型に差し替わる。
    const zoneNodes = Object.values(result.zones ?? {}).flat();
    const errorNode = zoneNodes.find(
      (n) => (n as { type: string }).type === compositeErrorTypeName("approval-card"),
    );
    expect(errorNode).toBeDefined();
    expect(
      (errorNode as { props: { missingType?: string } }).props.missingType,
    ).toBe("approval-status-bar");
    // error-card 型は config に登録済 (mergeCompositeComponents が登録) → 描画可能。
    expect(config.components[compositeErrorTypeName("approval-card")]).toBeDefined();
  });

  // -----------------------------------------------------------------------
  // cap5: project scoping
  // -----------------------------------------------------------------------
  it("cap5: 別 workspace の manifest を別 fetchImpl で解決すると互いに混入しない", async () => {
    // workspace A = fixture (approval-status-bar)
    const loadedA = await loadExternalComponents({
      backendOrigin: ORIGIN,
      fetchImpl: fixtureFetch(),
      importImpl: realFixtureImport,
    });
    // workspace B = 別 id の manifest (実 import しない簡易 stub)
    const manifestB = {
      schemaVersion: "1",
      components: [
        {
          id: "billing-summary",
          label: "請求サマリ",
          module: "./dist/billing-summary.mjs",
          version: "1.0.0",
        },
      ],
    };
    const loadedB = await loadExternalComponents({
      backendOrigin: ORIGIN,
      fetchImpl: fixtureFetch(manifestB),
      importImpl: async () => ({ default: () => null }),
    });

    const configA = mergeExternalComponents(buildPuckConfig(), loadedA);
    const configB = mergeExternalComponents(buildPuckConfig(), loadedB);

    // A には B の component が混入しない、B には A が混入しない。
    expect(configA.components["approval-status-bar"]).toBeDefined();
    expect(configA.components["billing-summary"]).toBeUndefined();
    expect(configB.components["billing-summary"]).toBeDefined();
    expect(configB.components["approval-status-bar"]).toBeUndefined();
    expect(configA.categories?.projectExternal?.components).toEqual([
      "approval-status-bar",
    ]);
    expect(configB.categories?.projectExternal?.components).toEqual(["billing-summary"]);
  });

  it("cap5: 既存 built-in id と衝突する外部 component は built-in を上書きせず id-collision に落ちる", async () => {
    const collidingManifest = {
      schemaVersion: "1",
      components: [
        {
          id: "Container", // built-in と衝突
          label: "悪意のContainer",
          module: "./dist/x.mjs",
          version: "1.0.0",
        },
      ],
    };
    const loaded = await loadExternalComponents({
      backendOrigin: ORIGIN,
      fetchImpl: fixtureFetch(collidingManifest),
      importImpl: async () => ({ default: () => null }),
    });
    const base = buildPuckConfig();
    const originalContainer = base.components["Container"];
    const merged = mergeExternalComponents(base, loaded);

    // built-in Container は不変。
    expect(merged.components["Container"]).toBe(originalContainer);
    expect(merged.components["Container"].label).not.toContain("外部");
    // 衝突は別 key の id-collision エラーカードに落ちる。
    const collisionKeys = Object.keys(merged.components).filter(
      (k) => !(k in base.components),
    );
    expect(collisionKeys).toHaveLength(1);
    const { getByTestId } = render(
      <>{merged.components[collisionKeys[0]].render({ puck: { renderDropZone: () => null } } as never)}</>,
    );
    expect(
      getByTestId("external-component-error-card").getAttribute("data-error-kind"),
    ).toBe("id-collision");
  });

  // -----------------------------------------------------------------------
  // cap6: validation / fallback (各 errorKind の代表)
  // -----------------------------------------------------------------------
  it("cap6: manifest-invalid (schemaVersion 不正) は manifest-invalid", async () => {
    const loaded = await loadExternalComponents({
      backendOrigin: ORIGIN,
      fetchImpl: fixtureFetch({ schemaVersion: "999", components: [] }),
      importImpl: realFixtureImport,
    });
    expect(loaded[0].status).toBe("error");
    if (loaded[0].status === "error") {
      expect(loaded[0].errorKind).toBe("manifest-invalid");
    }
  });

  it("cap6: version-mismatch (engine.react=18) は version-mismatch (import せず)", async () => {
    const importSpy = vi.fn(async () => ({ default: () => null }));
    const badEngine = {
      ...manifestJson,
      components: [{ ...manifestJson.components[0], engine: { react: "18", puck: "0.20" } }],
    };
    const loaded = await loadExternalComponents({
      backendOrigin: ORIGIN,
      fetchImpl: fixtureFetch(badEngine),
      importImpl: importSpy,
    });
    expect(loaded[0].status).toBe("error");
    if (loaded[0].status === "error") {
      expect(loaded[0].errorKind).toBe("version-mismatch");
    }
    expect(importSpy).not.toHaveBeenCalled();
  });

  it("cap6: missing-export (export 名不在) は missing-export", async () => {
    const wrongExport = {
      ...manifestJson,
      components: [{ ...manifestJson.components[0], export: "NotExist" }],
    };
    const loaded = await loadExternalComponents({
      backendOrigin: ORIGIN,
      fetchImpl: fixtureFetch(wrongExport),
      importImpl: realFixtureImport, // default だけ export する実 .mjs
    });
    expect(loaded[0].status).toBe("error");
    if (loaded[0].status === "error") {
      expect(loaded[0].errorKind).toBe("missing-export");
    }
  });

  it("cap6: load-error (module が配信範囲外 = SSRF) は import せず load-error", async () => {
    const importSpy = vi.fn(async () => ({ default: () => null }));
    const evilModule = {
      ...manifestJson,
      components: [
        { ...manifestJson.components[0], module: "https://evil.example.com/x.mjs" },
      ],
    };
    const loaded = await loadExternalComponents({
      backendOrigin: ORIGIN,
      fetchImpl: fixtureFetch(evilModule),
      importImpl: importSpy,
    });
    expect(loaded[0].status).toBe("error");
    if (loaded[0].status === "error") {
      expect(loaded[0].errorKind).toBe("load-error");
      expect(loaded[0].detail).toContain("配信範囲外");
    }
    expect(importSpy).not.toHaveBeenCalled();
  });

  it("cap6: 各 errorKind の entry は mergeExternalComponents でエラーカード化され UX 文言が出る", async () => {
    const loaded: LoadedExternalComponent[] = [
      {
        entry: { id: "e1", label: "稟議部品", module: "", version: "1.0.0" },
        status: "error",
        errorKind: "version-mismatch",
        detail: "react major 18 != host 19",
      },
    ];
    const merged = mergeExternalComponents(buildPuckConfig(), loaded);
    const { getByTestId } = render(
      <>{merged.components["e1"].render({ puck: { renderDropZone: () => null } } as never)}</>,
    );
    const card = getByTestId("external-component-error-card");
    expect(card.getAttribute("data-error-kind")).toBe("version-mismatch");
    expect(card.textContent).toContain("バージョン不一致");
    expect(card.textContent).toContain("稟議部品");
  });
});
