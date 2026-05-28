/**
 * grapesCanvasAssets — canvas / composition preview の CSS asset 定義が
 * 単一 source of truth として共有されていることを検証する (#1406)。
 *
 * 本テストの主眼:
 *   1. buildCanvasBaseAssets() (canvas が使う) と buildPreviewStyleHrefs() (preview が使う) が
 *      同一の base CSS (Bootstrap CDN / Bootstrap Icons / common.css) を含む
 *   2. preview が framework (bootstrap/tailwind) + variant (card/compact/dark) を反映する
 *      = canvas の applyThemeToCanvas と同じ FRAMEWORK_URLS / VARIANT_URLS を使う
 */

import { describe, it, expect } from "vitest";
import {
  FRAMEWORK_URLS,
  VARIANT_URLS,
  COMMON_CSS_URL,
  BOOTSTRAP_CSS_URL,
  BOOTSTRAP_ICONS_CSS_URL,
  BOOTSTRAP_JS_URL,
  buildCanvasBaseAssets,
  buildPreviewStyleHrefs,
} from "./grapesCanvasAssets";

describe("grapesCanvasAssets — canvas / preview の CSS source of truth 共有 (#1406)", () => {
  it("canvas base assets は Bootstrap CDN + Icons + common.css + Bootstrap JS を含む", () => {
    const { styles, scripts } = buildCanvasBaseAssets();
    expect(styles).toContain(BOOTSTRAP_CSS_URL);
    expect(styles).toContain(BOOTSTRAP_ICONS_CSS_URL);
    expect(styles).toContain(COMMON_CSS_URL);
    expect(scripts).toContain(BOOTSTRAP_JS_URL);
  });

  it("preview の style href は canvas と同じ base (Bootstrap CDN / Icons / common.css) を含む", () => {
    const hrefs = buildPreviewStyleHrefs("bootstrap", "standard");
    const canvasBase = buildCanvasBaseAssets().styles;
    // canvas base (script を除く CSS) が全て preview にも載っていること = source of truth 共有
    for (const css of canvasBase) {
      expect(hrefs).toContain(css);
    }
  });

  it("preview は framework の theme CSS を反映する (bootstrap / tailwind)", () => {
    expect(buildPreviewStyleHrefs("bootstrap", "standard")).toContain(FRAMEWORK_URLS.bootstrap);
    expect(buildPreviewStyleHrefs("tailwind", "standard")).toContain(FRAMEWORK_URLS.tailwind);
    // bootstrap 指定時に tailwind theme が混入しないこと
    expect(buildPreviewStyleHrefs("bootstrap", "standard")).not.toContain(FRAMEWORK_URLS.tailwind);
  });

  it("preview は variant override CSS を反映する (card / compact / dark)", () => {
    expect(buildPreviewStyleHrefs("bootstrap", "card")).toContain(VARIANT_URLS.card);
    expect(buildPreviewStyleHrefs("bootstrap", "compact")).toContain(VARIANT_URLS.compact);
    expect(buildPreviewStyleHrefs("bootstrap", "dark")).toContain(VARIANT_URLS.dark);
  });

  it("variant=standard では variant override を含まない (override なし)", () => {
    const hrefs = buildPreviewStyleHrefs("bootstrap", "standard");
    // standard は VARIANT_URLS が null のため、card/compact/dark のいずれも含まない
    expect(hrefs).not.toContain(VARIANT_URLS.card);
    expect(hrefs).not.toContain(VARIANT_URLS.compact);
    expect(hrefs).not.toContain(VARIANT_URLS.dark);
  });

  it("style href の適用順は base → framework → variant (後勝ち)", () => {
    const hrefs = buildPreviewStyleHrefs("bootstrap", "card");
    const fwIdx = hrefs.indexOf(FRAMEWORK_URLS.bootstrap);
    const variantIdx = hrefs.indexOf(VARIANT_URLS.card!);
    const baseIdx = hrefs.indexOf(BOOTSTRAP_CSS_URL);
    expect(baseIdx).toBeGreaterThanOrEqual(0);
    expect(fwIdx).toBeGreaterThan(baseIdx);
    expect(variantIdx).toBeGreaterThan(fwIdx);
  });
});
