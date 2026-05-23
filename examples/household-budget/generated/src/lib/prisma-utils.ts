/**
 * Prisma SQLite の $queryRawUnsafe が返す数値型を安全に number に変換するヘルパー。
 * SQLite + Prisma の組み合わせでは bigint や Decimal オブジェクトが返ることがある。
 */
export function toNumber(v: number | bigint | null | undefined | string | { toNumber(): number }): number {
  if (v === null || v === undefined) return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'bigint') return Number(v);
  if (typeof v === 'string') return Number(v);
  if (typeof v === 'object' && typeof (v as { toNumber(): number }).toNumber === 'function') {
    return (v as { toNumber(): number }).toNumber();
  }
  return Number(v);
}
