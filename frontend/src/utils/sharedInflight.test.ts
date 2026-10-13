import { describe, it, expect, vi } from "vitest";
import { shareInflight, invalidateAllInflight, isReadOnlyRpc } from "./sharedInflight";

describe("shareInflight", () => {
  it("同時に出た呼び出しは、読み出し 1 回を待つ。終わったあとの呼び出しは、あらためて読む", async () => {
    let n = 0;
    const load = vi.fn(async () => { await Promise.resolve(); return { n: ++n }; });
    const get = shareInflight(load);
    const [a, b, c] = await Promise.all([get(), get(), get()]);
    expect(load).toHaveBeenCalledTimes(1);
    expect([a.n, b.n, c.n]).toEqual([1, 1, 1]);
    expect((await get()).n).toBe(2);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("結果は呼び出しごとに複製する (一方が書き換えても、他方に影響しない)", async () => {
    const get = shareInflight(async () => ({ list: [1, 2] }));
    const [a, b] = await Promise.all([get(), get()]);
    a.list.push(3);
    expect(b.list).toEqual([1, 2]);
  });

  it("invalidate のあとの呼び出しは、進行中の読み出しを使わない (保存前の結果を返さない)", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    let n = 0;
    const get = shareInflight(async () => { const mine = ++n; if (mine === 1) await gate; return mine; });
    const first = get();
    get.invalidate();
    const second = get();
    release();
    expect(await second).toBe(2);
    expect(await first).toBe(1);
  });

  it("読み出しが失敗しても、次の呼び出しは読み直す", async () => {
    let n = 0;
    const get = shareInflight(async () => { if (++n === 1) throw new Error("x"); return n; });
    await expect(get()).rejects.toThrow("x");
    expect(await get()).toBe(2);
  });

  it("invalidateAllInflight は、登録された全部の進行中の読み出しを使わせなくする (書き込み・変更通知のあと)", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    let n = 0;
    const get = shareInflight(async () => { const mine = ++n; if (mine === 1) await gate; return mine; });
    const first = get();
    invalidateAllInflight();
    const second = get();
    release();
    expect(await second).toBe(2);
    expect(await first).toBe(1);
  });

  it("isReadOnlyRpc: 読み出しの RPC だけを読み出しとみなす", () => {
    for (const m of ["loadProject", "listAllTables", "getExtensions", "findEntityReferences", "searchDesign", "editSession.list", "editSession.fetchPayload", "fileVersions.get"]) expect(isReadOnlyRpc(m)).toBe(true);
    for (const m of ["saveProject", "deleteScreen", "renameEntity", "editSession.save", "workspace.open"]) expect(isReadOnlyRpc(m)).toBe(false);
  });
});
