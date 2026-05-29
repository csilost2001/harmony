/**
 * grapesCanvasAssets — GrapesJS canvas が利用する framework / theme CSS asset 定義の
 * 単一 source of truth (#1406)。
 *
 * 背景 (#1406):
 *   従来、canvas 側 (GrapesJSBackend.tsx) と composition preview iframe 側
 *   (GrapesEditorHost.tsx の CompositionPreviewModal) で CSS asset の定義がそれぞれ
 *   ハードコードされており、両者が乖離していた。
 *   - canvas: FRAMEWORK_URLS (theme-bootstrap/tailwind) + VARIANT (card/compact/dark)
 *             + styles/common.css + Bootstrap CDN を注入
 *   - preview: iframe srcDoc に Bootstrap CDN のみを直書き (theme/variant/common.css/project CSS 欠落)
 *   その結果、preview が canvas と異なる見た目で描画され「崩れて見える」問題が発生していた。
 *
 *   本モジュールに asset 定義を集約し、canvas と preview の双方が必ず同じ定義を参照する
 *   ことで CSS source of truth を一本化する。
 *
 * 配置:
 *   `import.meta.url` ベースの相対 asset URL (`new URL("../styles/...", import.meta.url).href`)
 *   は vite が build 時に解決する。本モジュールは `frontend/src/editor/` 配下にあり、
 *   従来 GrapesJSBackend.tsx (同じ `frontend/src/editor/`) で使われていた相対パスを
 *   そのまま流用できる (基準ディレクトリが同一のため)。
 */

import type { CssFramework } from "../types/v3/harmony";
import type { ThemeId } from "./EditorBackend";

/**
 * framework (bootstrap / tailwind) ごとの theme CSS URL。
 * canvas / preview 双方で必ずこの定義を使う。
 */
export const FRAMEWORK_URLS: Record<CssFramework, string> = {
  bootstrap: new URL("../styles/themes/theme-bootstrap.css", import.meta.url).href,
  tailwind: new URL("../styles/themes/theme-tailwind.css", import.meta.url).href,
};

/**
 * theme variant (standard / card / compact / dark) ごとの override CSS URL。
 * standard は override なし (null)。
 */
export const VARIANT_URLS: Record<ThemeId, string | null> = {
  standard: null,
  card: new URL("../styles/theme-card.css", import.meta.url).href,
  compact: new URL("../styles/theme-compact.css", import.meta.url).href,
  dark: new URL("../styles/theme-dark.css", import.meta.url).href,
};

/** Harmony 共通 canvas スタイル (styles/common.css)。 */
export const COMMON_CSS_URL: string = new URL("../styles/common.css", import.meta.url).href;

/** Bootstrap base CSS (CDN)。canvas / preview 双方で読み込む。 */
export const BOOTSTRAP_CSS_URL =
  "https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css";

/** Bootstrap Icons CSS (CDN)。 */
export const BOOTSTRAP_ICONS_CSS_URL =
  "https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.0/font/bootstrap-icons.css";

/** Bootstrap bundle JS (CDN)。canvas のみで利用 (preview は read-only のため script 不要)。 */
export const BOOTSTRAP_JS_URL =
  "https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js";

/**
 * GrapesJS `canvas` option に渡す base CSS / script URL を構築する。
 *
 * GrapesJSBackend.buildGjsOptions() がこれを使い、canvas の初期 base styles を設定する。
 * framework / variant は GrapesJS 初期化後に applyThemeToCanvas() で動的に追加注入される
 * ため、ここでは framework 非依存の base (Bootstrap CDN + common.css) のみを返す。
 */
export function buildCanvasBaseAssets(): { styles: string[]; scripts: string[] } {
  return {
    styles: [BOOTSTRAP_CSS_URL, BOOTSTRAP_ICONS_CSS_URL, COMMON_CSS_URL],
    scripts: [BOOTSTRAP_JS_URL],
  };
}

/**
 * canvas / preview iframe に注入すべき framework + variant の CSS href を、
 * 適用順に並べたリストとして返す。
 *
 * 適用順 (後勝ち):
 *   1. Bootstrap CDN base
 *   2. Bootstrap Icons
 *   3. common.css
 *   4. FRAMEWORK_URLS[framework]  (theme-bootstrap / theme-tailwind)
 *   5. VARIANT_URLS[variant]      (card / compact / dark、standard は省略)
 *
 * composition preview iframe (GrapesEditorHost.tsx) が `<link>` タグ生成にこれを使うことで、
 * canvas (applyThemeToCanvas + buildCanvasBaseAssets) と同一の CSS スタックを再現する。
 */
export function buildPreviewStyleHrefs(
  framework: CssFramework,
  variant: ThemeId,
): string[] {
  const hrefs: string[] = [
    BOOTSTRAP_CSS_URL,
    BOOTSTRAP_ICONS_CSS_URL,
    COMMON_CSS_URL,
    FRAMEWORK_URLS[framework],
  ];
  const variantUrl = VARIANT_URLS[variant];
  if (variantUrl) hrefs.push(variantUrl);
  return hrefs;
}
