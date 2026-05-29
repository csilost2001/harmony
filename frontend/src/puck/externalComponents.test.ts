/**
 * externalComponents.test.ts — 外部 component ローダのエラー分類テスト (#1409 P-1)。
 *
 * fetch / import は DI で差し替えてエラー分類を網羅する。
 */
import { describe, it, expect, vi } from "vitest";
import { loadExternalComponents } from "./externalComponents";

const ORIGIN = "http://localhost:5179";

function makeFetch(manifest: unknown, ok = true, status = 200): typeof fetch {
  return vi.fn(async () =>
    ({
      ok,
      status,
      json: async () => manifest,
    }) as unknown as Response,
  ) as unknown as typeof fetch;
}

function fetch404(): typeof fetch {
  return vi.fn(async () =>
    ({ ok: false, status: 404, json: async () => ({}) }) as unknown as Response,
  ) as unknown as typeof fetch;
}

/** ok=false の任意 HTTP status を返す fetch (403/500 等)。 */
function fetchHttpError(status: number): typeof fetch {
  return vi.fn(async () =>
    ({ ok: false, status, json: async () => ({}) }) as unknown as Response,
  ) as unknown as typeof fetch;
}

/** ok=true だが res.json() が throw する fetch (JSON parse 失敗)。 */
function fetchJsonThrows(): typeof fetch {
  return vi.fn(async () =>
    ({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError("Unexpected token < in JSON");
      },
    }) as unknown as Response,
  ) as unknown as typeof fetch;
}

const validEntry = {
  id: "foo",
  label: "Foo",
  module: "./dist/foo.mjs",
  version: "1.0.0",
};

describe("loadExternalComponents", () => {
  it("manifest が 404 なら空配列を返す (正常系)", async () => {
    const result = await loadExternalComponents({
      backendOrigin: ORIGIN,
      fetchImpl: fetch404(),
      importImpl: async () => ({}),
    });
    expect(result).toEqual([]);
  });

  it("fetch が例外を投げたら空配列を返す", async () => {
    const result = await loadExternalComponents({
      backendOrigin: ORIGIN,
      fetchImpl: vi.fn(async () => {
        throw new Error("network");
      }) as unknown as typeof fetch,
      importImpl: async () => ({}),
    });
    expect(result).toEqual([]);
  });

  it("manifest 不正なら manifest-invalid を返す", async () => {
    const result = await loadExternalComponents({
      backendOrigin: ORIGIN,
      fetchImpl: makeFetch({ schemaVersion: "1", components: [{ id: "x" }] }),
      importImpl: async () => ({}),
    });
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe("error");
    if (result[0].status === "error") {
      expect(result[0].errorKind).toBe("manifest-invalid");
    }
  });

  it("ok: export が関数なら status=ok で Component を返す", async () => {
    const Component = () => null;
    const result = await loadExternalComponents({
      backendOrigin: ORIGIN,
      fetchImpl: makeFetch({ schemaVersion: "1", components: [validEntry] }),
      importImpl: async () => ({ default: Component }),
    });
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe("ok");
    if (result[0].status === "ok") {
      expect(result[0].Component).toBe(Component);
    }
  });

  it("カスタム export 名を解決する", async () => {
    const Component = () => null;
    const result = await loadExternalComponents({
      backendOrigin: ORIGIN,
      fetchImpl: makeFetch({
        schemaVersion: "1",
        components: [{ ...validEntry, export: "MyComp" }],
      }),
      importImpl: async () => ({ MyComp: Component, default: 123 }),
    });
    expect(result[0].status).toBe("ok");
  });

  it("missing-export: export が関数でないなら missing-export", async () => {
    const result = await loadExternalComponents({
      backendOrigin: ORIGIN,
      fetchImpl: makeFetch({ schemaVersion: "1", components: [validEntry] }),
      importImpl: async () => ({ default: 42 }),
    });
    expect(result[0].status).toBe("error");
    if (result[0].status === "error") {
      expect(result[0].errorKind).toBe("missing-export");
    }
  });

  it("load-error: import が例外を投げたら load-error", async () => {
    const result = await loadExternalComponents({
      backendOrigin: ORIGIN,
      fetchImpl: makeFetch({ schemaVersion: "1", components: [validEntry] }),
      importImpl: async () => {
        throw new Error("boom");
      },
    });
    expect(result[0].status).toBe("error");
    if (result[0].status === "error") {
      expect(result[0].errorKind).toBe("load-error");
      expect(result[0].detail).toContain("boom");
    }
  });

  it("version-mismatch: react major 不一致なら version-mismatch (import せず)", async () => {
    const importSpy = vi.fn(async () => ({ default: () => null }));
    const result = await loadExternalComponents({
      backendOrigin: ORIGIN,
      fetchImpl: makeFetch({
        schemaVersion: "1",
        components: [{ ...validEntry, engine: { react: "18" } }],
      }),
      importImpl: importSpy,
    });
    expect(result[0].status).toBe("error");
    if (result[0].status === "error") {
      expect(result[0].errorKind).toBe("version-mismatch");
    }
    expect(importSpy).not.toHaveBeenCalled();
  });

  it("version-mismatch: puck minor 不一致なら version-mismatch", async () => {
    const result = await loadExternalComponents({
      backendOrigin: ORIGIN,
      fetchImpl: makeFetch({
        schemaVersion: "1",
        components: [{ ...validEntry, engine: { puck: "0.19" } }],
      }),
      importImpl: async () => ({ default: () => null }),
    });
    expect(result[0].status).toBe("error");
    if (result[0].status === "error") {
      expect(result[0].errorKind).toBe("version-mismatch");
    }
  });

  it("engine が host と一致 (react 19 / puck 0.20) なら ok", async () => {
    const result = await loadExternalComponents({
      backendOrigin: ORIGIN,
      fetchImpl: makeFetch({
        schemaVersion: "1",
        components: [
          { ...validEntry, engine: { react: "^19.2.4", puck: "0.20.2" } },
        ],
      }),
      importImpl: async () => ({ default: () => null }),
    });
    expect(result[0].status).toBe("ok");
  });

  it("module URL を backend origin + asset prefix で解決して import する", async () => {
    const importSpy = vi.fn(async () => ({ default: () => null }));
    await loadExternalComponents({
      backendOrigin: ORIGIN,
      fetchImpl: makeFetch({ schemaVersion: "1", components: [validEntry] }),
      importImpl: importSpy,
    });
    expect(importSpy).toHaveBeenCalledWith(
      `${ORIGIN}/workspace-assets/puck-components/dist/foo.mjs`,
    );
  });

  // --- SF2: manifest fetch の HTTP / parse error を握り潰さない ---
  it("manifest が 500 等の HTTP error なら manifest-invalid を返す", async () => {
    const result = await loadExternalComponents({
      backendOrigin: ORIGIN,
      fetchImpl: fetchHttpError(500),
      importImpl: async () => ({}),
    });
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe("error");
    if (result[0].status === "error") {
      expect(result[0].errorKind).toBe("manifest-invalid");
      expect(result[0].detail).toContain("HTTP 500");
    }
  });

  it("manifest が 403 でも manifest-invalid を返す (404 のみ空配列)", async () => {
    const result = await loadExternalComponents({
      backendOrigin: ORIGIN,
      fetchImpl: fetchHttpError(403),
      importImpl: async () => ({}),
    });
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe("error");
    if (result[0].status === "error") {
      expect(result[0].errorKind).toBe("manifest-invalid");
      expect(result[0].detail).toContain("HTTP 403");
    }
  });

  it("manifest の JSON parse 失敗なら manifest-invalid を返す", async () => {
    const result = await loadExternalComponents({
      backendOrigin: ORIGIN,
      fetchImpl: fetchJsonThrows(),
      importImpl: async () => ({}),
    });
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe("error");
    if (result[0].status === "error") {
      expect(result[0].errorKind).toBe("manifest-invalid");
    }
  });

  it("network throw (backend down) は空配列 (エラーカードを出さない)", async () => {
    const result = await loadExternalComponents({
      backendOrigin: ORIGIN,
      fetchImpl: vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }) as unknown as typeof fetch,
      importImpl: async () => ({}),
    });
    expect(result).toEqual([]);
  });

  // --- MF1: loader の任意 origin import を塞ぐ (SSRF 防止) ---
  it("module が他 origin (https://evil) なら import せず load-error", async () => {
    const importSpy = vi.fn(async () => ({ default: () => null }));
    const result = await loadExternalComponents({
      backendOrigin: ORIGIN,
      fetchImpl: makeFetch({
        schemaVersion: "1",
        components: [{ ...validEntry, module: "https://evil.example.com/x.mjs" }],
      }),
      importImpl: importSpy,
    });
    expect(result[0].status).toBe("error");
    if (result[0].status === "error") {
      expect(result[0].errorKind).toBe("load-error");
      expect(result[0].detail).toContain("配信範囲外");
    }
    expect(importSpy).not.toHaveBeenCalled();
  });

  it("module が ../ で配信範囲外へ脱出するなら import せず load-error", async () => {
    const importSpy = vi.fn(async () => ({ default: () => null }));
    const result = await loadExternalComponents({
      backendOrigin: ORIGIN,
      fetchImpl: makeFetch({
        schemaVersion: "1",
        components: [{ ...validEntry, module: "../../etc/secret.mjs" }],
      }),
      importImpl: importSpy,
    });
    expect(result[0].status).toBe("error");
    if (result[0].status === "error") {
      expect(result[0].errorKind).toBe("load-error");
      expect(result[0].detail).toContain("配信範囲外");
    }
    expect(importSpy).not.toHaveBeenCalled();
  });

  it("module が protocol-relative (//host) なら import せず load-error", async () => {
    const importSpy = vi.fn(async () => ({ default: () => null }));
    const result = await loadExternalComponents({
      backendOrigin: ORIGIN,
      fetchImpl: makeFetch({
        schemaVersion: "1",
        components: [{ ...validEntry, module: "//evil.example.com/x.mjs" }],
      }),
      importImpl: importSpy,
    });
    expect(result[0].status).toBe("error");
    if (result[0].status === "error") {
      expect(result[0].errorKind).toBe("load-error");
    }
    expect(importSpy).not.toHaveBeenCalled();
  });

  it("module の拡張子が allowlist 外 (.json 等) なら import せず load-error", async () => {
    const importSpy = vi.fn(async () => ({ default: () => null }));
    const result = await loadExternalComponents({
      backendOrigin: ORIGIN,
      fetchImpl: makeFetch({
        schemaVersion: "1",
        components: [{ ...validEntry, module: "./dist/foo.json" }],
      }),
      importImpl: importSpy,
    });
    expect(result[0].status).toBe("error");
    if (result[0].status === "error") {
      expect(result[0].errorKind).toBe("load-error");
      expect(result[0].detail).toContain("拡張子");
    }
    expect(importSpy).not.toHaveBeenCalled();
  });

  it("正常な ./dist/foo.mjs は import して ok", async () => {
    const importSpy = vi.fn(async () => ({ default: () => null }));
    const result = await loadExternalComponents({
      backendOrigin: ORIGIN,
      fetchImpl: makeFetch({ schemaVersion: "1", components: [validEntry] }),
      importImpl: importSpy,
    });
    expect(result[0].status).toBe("ok");
    expect(importSpy).toHaveBeenCalledOnce();
  });
});
