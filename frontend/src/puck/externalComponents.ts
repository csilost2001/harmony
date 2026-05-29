/**
 * externalComponents.ts — 外部 React Component の runtime ESM ローダ (#1409 P-1)。
 *
 * 案 B (runtime ESM import) + import map による React/Puck 共有方式。
 * backend の `/workspace-assets/puck-components/` 静的配信から manifest.json と
 * 各 component の `.mjs` を取得し、`import()` で読み込む。
 *
 * - manifest が無い (404) / fetch 到達不可 (backend down) → 空配列 (正常系)
 * - manifest HTTP error (403/500 等) / JSON parse 失敗 / manifest 不正 → errorKind="manifest-invalid"
 * - engine major 不一致 → errorKind="version-mismatch"
 * - module パスが配信範囲外 (任意 origin / 配信外脱出 / 拡張子不正) → errorKind="load-error" (SSRF 防止)
 * - import 失敗 → errorKind="load-error"
 * - export が関数でない → errorKind="missing-export"
 *
 * fetch / import は引数で差し替え可能 (DI) にしてテスト容易化している。
 * JSX は持ち込まない (frontend/AGENTS.md: src/puck/ はロジックのみ)。
 *
 * RFC #1405 シリーズ P-1。
 */

import type { ComponentType } from "react";
import {
  validateExternalComponentManifest,
  type ExternalComponentEntry,
} from "./externalComponentManifest";

/** host が提供する依存の major version。version-mismatch 判定の基準。 */
export const HOST_REACT_MAJOR = 19;
export const HOST_PUCK_MAJOR = 0;
/** Puck は 0.x のため minor も互換境界として扱う (0.20)。 */
export const HOST_PUCK_MINOR = 20;

export type ExternalComponentErrorKind =
  | "manifest-invalid"
  | "version-mismatch"
  | "load-error"
  | "missing-export"
  | "id-collision"
  // 複合部品 (#1412 P-4) 展開時、subtree 内ノードの type が config に存在しない場合。
  // 主に未ロードの外部 component (#1409 P-1) を内包する複合部品で発生する。
  | "missing-dependency";

export type LoadedExternalComponent =
  | {
      entry: ExternalComponentEntry;
      status: "ok";
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      Component: ComponentType<any>;
    }
  | {
      entry: ExternalComponentEntry;
      status: "error";
      errorKind: ExternalComponentErrorKind;
      detail?: string;
    };

/** mcpBridge と同一ロジックで backend origin を算出する。 */
export function defaultBackendOrigin(): string {
  const port =
    (import.meta.env?.VITE_DESIGNER_MCP_PORT as string | undefined) ?? "5179";
  const hostname =
    typeof window !== "undefined" ? window.location.hostname : "localhost";
  return `http://${hostname}:${port}`;
}

const ASSET_PREFIX = "/workspace-assets/puck-components/";

export interface LoadExternalComponentsOptions {
  /** backend origin。省略時は defaultBackendOrigin()。 */
  backendOrigin?: string;
  /** fetch 差し替え (テスト用)。 */
  fetchImpl?: typeof fetch;
  /**
   * dynamic import 差し替え (テスト用)。
   * 本番では vite-ignore 付き dynamic import (defaultImport) を使う。
   */
  importImpl?: (url: string) => Promise<Record<string, unknown>>;
}

function defaultImport(url: string): Promise<Record<string, unknown>> {
  return import(/* @vite-ignore */ url) as Promise<Record<string, unknown>>;
}

/** "19.2.4" → 19 / "0.20.2" → 0 のように先頭の数値を取り出す。 */
function parseMajor(version: string): number | null {
  const m = /^\s*\^?~?(\d+)/.exec(version);
  return m ? Number(m[1]) : null;
}

/** "0.20.2" → 20。 */
function parseMinor(version: string): number | null {
  const m = /^\s*\^?~?\d+\.(\d+)/.exec(version);
  return m ? Number(m[1]) : null;
}

/** engine 宣言が host と互換か検証する。null = OK、文字列 = 不一致理由。 */
function checkEngineCompat(entry: ExternalComponentEntry): string | null {
  const engine = entry.engine;
  if (!engine) return null;

  if (engine.react) {
    const major = parseMajor(engine.react);
    if (major !== null && major !== HOST_REACT_MAJOR) {
      return `react major ${major} != host ${HOST_REACT_MAJOR}`;
    }
  }
  if (engine.puck) {
    const major = parseMajor(engine.puck);
    if (major !== null && major !== HOST_PUCK_MAJOR) {
      return `puck major ${major} != host ${HOST_PUCK_MAJOR}`;
    }
    // Puck は 0.x のため minor も互換境界
    if (major === 0) {
      const minor = parseMinor(engine.puck);
      if (minor !== null && minor !== HOST_PUCK_MINOR) {
        return `puck minor 0.${minor} != host 0.${HOST_PUCK_MINOR}`;
      }
    }
  }
  return null;
}

/**
 * 外部 component manifest を読み込み、各 entry を解決する。
 * manifest 取得失敗 (404 / network) は外部部品未使用とみなし空配列を返す。
 */
export async function loadExternalComponents(
  opts: LoadExternalComponentsOptions = {},
): Promise<LoadedExternalComponent[]> {
  const backendOrigin = opts.backendOrigin ?? defaultBackendOrigin();
  const fetchImpl = opts.fetchImpl ?? fetch;
  const importImpl = opts.importImpl ?? defaultImport;

  const manifestUrl = `${backendOrigin}${ASSET_PREFIX}manifest.json`;

  // 1. manifest fetch
  let raw: unknown;
  try {
    const res = await fetchImpl(manifestUrl);
    if (!res.ok) {
      // 404 = manifest 無し = 外部部品未使用 (正常系) → 空配列。
      if (res.status === 404) return [];
      // それ以外の HTTP error (403/500 等) は設定/サーバ異常 → manifest-invalid で可視化。
      return [manifestError(`HTTP ${res.status}`)];
    }
    try {
      raw = await res.json();
    } catch (e) {
      // JSON parse 失敗 = manifest 破損 → manifest-invalid で可視化 (握り潰さない)。
      return [
        manifestError(
          `JSON parse 失敗: ${e instanceof Error ? e.message : String(e)}`,
        ),
      ];
    }
  } catch {
    // fetch 自体の throw = network 到達不可 (= backend 未起動)。
    // editor で backend 未起動時にエラーカードを出さないため空配列扱い (正常系)。
    return [];
  }

  // 2. manifest 検証
  const validated = validateExternalComponentManifest(raw);
  if (!validated.ok) {
    const detail = validated.errors.join("; ");
    // entry を取り出せる範囲でエラー列挙、無理なら 1 件の汎用エラー
    const entries = extractEntriesForErrorReport(raw);
    if (entries.length === 0) {
      return [manifestError(detail)];
    }
    return entries.map((entry) => ({
      entry,
      status: "error" as const,
      errorKind: "manifest-invalid" as const,
      detail,
    }));
  }

  // 3-5. 各 entry を解決
  const results: LoadedExternalComponent[] = [];
  for (const entry of validated.manifest.components) {
    // 3. engine 互換
    const incompat = checkEngineCompat(entry);
    if (incompat) {
      results.push({
        entry,
        status: "error",
        errorKind: "version-mismatch",
        detail: incompat,
      });
      continue;
    }

    // 4. module URL を解決し、配信範囲内であることを検証する (SSRF 防止)。
    //    entry.module に "https://evil/..." / "//host/..." / "../../" などが書かれていても
    //    backend の asset 配信範囲外へ import が飛ばないようにする。
    const resolved = resolveSafeModuleUrl(backendOrigin, entry.module);
    if (!resolved.ok) {
      results.push({
        entry,
        status: "error",
        errorKind: "load-error",
        detail: resolved.detail,
      });
      continue;
    }
    const moduleUrl = resolved.url;

    // dynamic import
    let mod: Record<string, unknown>;
    try {
      mod = await importImpl(moduleUrl);
    } catch (e) {
      results.push({
        entry,
        status: "error",
        errorKind: "load-error",
        detail: e instanceof Error ? e.message : String(e),
      });
      continue;
    }

    // 5. export 取得
    const exportName = entry.export ?? "default";
    const candidate = mod[exportName];
    if (typeof candidate !== "function") {
      results.push({
        entry,
        status: "error",
        errorKind: "missing-export",
        detail: `export "${exportName}" が関数ではありません`,
      });
      continue;
    }

    results.push({
      entry,
      status: "ok",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      Component: candidate as ComponentType<any>,
    });
  }

  return results;
}

/** frontend 側で import を許可する module 拡張子 allowlist。 */
const ALLOWED_MODULE_EXTENSIONS = [".mjs", ".js"];

type SafeUrlResult =
  | { ok: true; url: string }
  | { ok: false; detail: string };

/**
 * entry.module を backend asset 配信範囲内の URL に解決する (SSRF 防止)。
 *
 * - 解決後 URL の origin が backend origin と一致すること
 * - 解決後 pathname が ASSET_PREFIX 配下に収まること (../ での配信外脱出を拒否)
 * - 拡張子が allowlist (.mjs / .js) であること
 *
 * いずれか満たさない場合は import せず load-error として扱う。
 */
function resolveSafeModuleUrl(
  backendOrigin: string,
  moduleRel: string,
): SafeUrlResult {
  const base = `${backendOrigin}${ASSET_PREFIX}`;
  let resolved: URL;
  let expectedOrigin: string;
  try {
    resolved = new URL(moduleRel, base);
    expectedOrigin = new URL(backendOrigin).origin;
  } catch (e) {
    return {
      ok: false,
      detail: `module パスが解決できません: ${moduleRel} (${e instanceof Error ? e.message : String(e)})`,
    };
  }

  if (resolved.origin !== expectedOrigin) {
    return {
      ok: false,
      detail: `module パスが配信範囲外です (origin 不一致): ${moduleRel}`,
    };
  }
  if (!resolved.pathname.startsWith(ASSET_PREFIX)) {
    return {
      ok: false,
      detail: `module パスが配信範囲外です: ${moduleRel}`,
    };
  }
  if (!ALLOWED_MODULE_EXTENSIONS.some((ext) => resolved.pathname.endsWith(ext))) {
    return {
      ok: false,
      detail: `module の拡張子が許可されていません (.mjs / .js のみ): ${moduleRel}`,
    };
  }
  return { ok: true, url: resolved.href };
}

/** manifest 取得/検証段階の単一エラー結果を生成する。 */
function manifestError(detail: string): LoadedExternalComponent {
  return {
    entry: {
      id: "(manifest)",
      label: "外部コンポーネント manifest",
      module: "",
      version: "",
    },
    status: "error",
    errorKind: "manifest-invalid",
    detail,
  };
}

/**
 * manifest 不正時でも entry っぽいものを取り出してエラー表示に使う。
 * 完全な検証は通っていないため best-effort。
 */
function extractEntriesForErrorReport(raw: unknown): ExternalComponentEntry[] {
  if (
    typeof raw !== "object" ||
    raw === null ||
    !Array.isArray((raw as Record<string, unknown>).components)
  ) {
    return [];
  }
  const components = (raw as Record<string, unknown>).components as unknown[];
  return components.map((c, i) => {
    const obj = (typeof c === "object" && c !== null ? c : {}) as Record<
      string,
      unknown
    >;
    return {
      id: typeof obj.id === "string" ? obj.id : `(entry-${i})`,
      label: typeof obj.label === "string" ? obj.label : `entry ${i}`,
      module: typeof obj.module === "string" ? obj.module : "",
      version: typeof obj.version === "string" ? obj.version : "",
    };
  });
}
