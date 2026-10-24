/**
 * 作り直された JSON の、前と同じ内容の部分を、前の物 (同じ参照) に置き換える。
 *
 * 「流れ」の編集は、操作のたびにアクション全体を複製して直す (取り消し単位のため)。そのままでは、直していない工程も、すべて新しい物に見え、
 * 行の描き直しを省けない。同じ内容の部分を前の参照のまま返せば、React.memo が「変わっていない行」を見分けられる。
 * 純粋関数。値は書き換えない (前も、あとも)。
 */
const isPlain = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
const idOf = (v: unknown): string | undefined => (isPlain(v) && typeof v.id === "string" ? v.id : undefined);

export function shareStructure<T>(prev: unknown, next: T): T {
  if (Object.is(prev, next)) return next;
  if (Array.isArray(prev) && Array.isArray(next)) {
    // 並べ替え・挿入・削除でも、id が同じ要素は前の物を使い回す (id がなければ、位置で)
    const byId = new Map<string, unknown>();
    for (const p of prev) { const id = idOf(p); if (id !== undefined && !byId.has(id)) byId.set(id, p); }
    let same = prev.length === next.length;
    const out = next.map((n, i) => {
      const id = idOf(n);
      const s = shareStructure(id !== undefined && byId.has(id) ? byId.get(id) : prev[i], n);
      if (!Object.is(s, prev[i])) same = false;
      return s;
    });
    return (same ? prev : out) as unknown as T;
  }
  if (isPlain(prev) && isPlain(next)) {
    const keys = Object.keys(next);
    let same = keys.length === Object.keys(prev).length;
    const out: Record<string, unknown> = {};
    for (const k of keys) {
      const s = shareStructure(prev[k], next[k]);
      out[k] = s;
      if (!(k in prev) || !Object.is(s, prev[k])) same = false;
    }
    return (same ? prev : out) as T;
  }
  return next;
}
