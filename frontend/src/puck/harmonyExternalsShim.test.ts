/**
 * harmonyExternalsShim.test.ts — 外部 component 用 import map shim mjs の検証 (#1409 P-1)。
 *
 * frontend/public/harmony-externals/*.mjs は host が window.__HARMONY_SHARED_DEPS__ に
 * 設置した実 module を re-export する素の ESM。ここでは window bridge に実 react /
 * react-dom / react-dom/client / react/jsx-runtime / @measured/puck を設置した上で
 * 各 shim を評価し、代表 named export が host 実体と一致 (=== or typeof) することを assert する。
 *
 * jsdom 環境。public/*.mjs は Vite を介さず fs で読み出し、ESM の export 文を
 * 評価可能な形に変換して window bridge 経由の解決を検証する。
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import * as ReactNS from "react";
import * as ReactDOMNS from "react-dom";
import * as ReactDOMClientNS from "react-dom/client";
import * as ReactJsxRuntimeNS from "react/jsx-runtime";
import * as PuckNS from "@measured/puck";

const SHIM_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../public/harmony-externals",
);

/**
 * 素の ESM shim mjs を評価し、export された binding を Record で返す。
 *
 * shim は次の 2 形態のみ使う:
 *   - `export default m;`
 *   - `export const { a, b, ... } = m;`
 * これらを評価可能な JS に変換し、window bridge 経由で解決させて binding を回収する。
 * `window` への参照はそのまま (jsdom の global window を使う)。
 */
function evalShim(fileName: string): Record<string, unknown> {
  const source = readFileSync(resolve(SHIM_DIR, fileName), "utf-8");

  // export 文を回収用の代入に書き換える。
  const exportsBag: Record<string, unknown> = {};
  const rewritten = source
    // `export default X;` → `__exports__.default = X;`
    .replace(/export\s+default\s+([^;]+);/g, "__exports__.default = $1;")
    // `export const { ... } = m;` → `Object.assign(__exports__, (() => { const { ... } = m; return { ... }; })());`
    .replace(
      /export\s+const\s+\{([\s\S]*?)\}\s*=\s*([^;]+);/g,
      (_m, names: string, rhs: string) => {
        // names から identifier (コメント除去) を抽出
        const idents = names
          .split(",")
          .map((s) => s.replace(/\/\/.*$/gm, "").trim())
          .filter((s) => s.length > 0 && /^[A-Za-z_$][\w$]*$/.test(s));
        const destructure = idents.join(", ");
        const reassemble = idents.map((n) => `${n}: ${n}`).join(", ");
        return `Object.assign(__exports__, (() => { const { ${destructure} } = ${rhs}; return { ${reassemble} }; })());`;
      },
    );

  // window はテスト側で設置済みの jsdom global を使う。
  const fn = new Function("__exports__", "window", rewritten);
  fn(exportsBag, window);
  return exportsBag;
}

beforeAll(() => {
  (window as unknown as { __HARMONY_SHARED_DEPS__?: Record<string, unknown> }).__HARMONY_SHARED_DEPS__ =
    {
      react: ReactNS,
      "react-dom": ReactDOMNS,
      "react-dom/client": ReactDOMClientNS,
      "react/jsx-runtime": ReactJsxRuntimeNS,
      "@measured/puck": PuckNS,
    };
});

describe("harmony-externals shim mjs", () => {
  it("react.mjs: 代表 named export が host 実体と一致する", () => {
    const ex = evalShim("react.mjs");
    expect(ex.useState).toBe((ReactNS as Record<string, unknown>).useState);
    expect(ex.useEffect).toBe((ReactNS as Record<string, unknown>).useEffect);
    expect(ex.createElement).toBe(
      (ReactNS as Record<string, unknown>).createElement,
    );
    // React 19 安定 surface (use)。host に存在することを確認。
    expect(ex.use).toBe((ReactNS as Record<string, unknown>).use);
    expect(typeof ex.use).toBe("function");
    // default は React namespace 全体
    expect(ex.default).toBe(ReactNS);
  });

  it("react-dom.mjs: createPortal が host 実体と一致する", () => {
    const ex = evalShim("react-dom.mjs");
    expect(ex.createPortal).toBe(
      (ReactDOMNS as Record<string, unknown>).createPortal,
    );
    expect(typeof ex.createPortal).toBe("function");
    expect(ex.default).toBe(ReactDOMNS);
  });

  it("react-dom-client.mjs: createRoot が host 実体と一致する", () => {
    const ex = evalShim("react-dom-client.mjs");
    expect(ex.createRoot).toBe(
      (ReactDOMClientNS as Record<string, unknown>).createRoot,
    );
    expect(typeof ex.createRoot).toBe("function");
    expect(ex.hydrateRoot).toBe(
      (ReactDOMClientNS as Record<string, unknown>).hydrateRoot,
    );
  });

  it("react-jsx-runtime.mjs: jsx が host 実体と一致する", () => {
    const ex = evalShim("react-jsx-runtime.mjs");
    expect(ex.jsx).toBe((ReactJsxRuntimeNS as Record<string, unknown>).jsx);
    expect(typeof ex.jsx).toBe("function");
  });

  it("puck.mjs: DropZone が host 実体と一致する", () => {
    const ex = evalShim("puck.mjs");
    expect(ex.DropZone).toBe((PuckNS as Record<string, unknown>).DropZone);
    expect(ex.DropZone).toBeDefined();
    expect(ex.default).toBe(PuckNS);
  });

  it("bridge 未設置なら shim は throw する", () => {
    const saved = (window as unknown as { __HARMONY_SHARED_DEPS__?: unknown })
      .__HARMONY_SHARED_DEPS__;
    (window as unknown as { __HARMONY_SHARED_DEPS__?: unknown }).__HARMONY_SHARED_DEPS__ =
      {};
    try {
      expect(() => evalShim("react.mjs")).toThrow(/bridge 未設置/);
    } finally {
      (window as unknown as { __HARMONY_SHARED_DEPS__?: unknown }).__HARMONY_SHARED_DEPS__ =
        saved;
    }
  });
});
