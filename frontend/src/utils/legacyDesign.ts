/**
 * 旧デザイン (GrapesJS project data) に中身があるか。空のプロジェクト (新規作成直後) は false、
 * HTML 文字列・部品 JSON が入っているもの、または形式が壊れているもの (旧デザイナで扱う) は true。
 */
export function hasLegacyDesignContent(design: unknown): boolean {
  if (design == null) return false;
  if (typeof design !== "object") return true;
  const pages = (design as { pages?: unknown }).pages;
  // デザインファイルが存在するのに pages が無い = 壊れたデータ (旧デザイナの破損耐性で扱う)。
  // 新規作成直後の画面はデザインファイル自体が無く design は null になる
  if (pages === undefined) return true;
  if (!Array.isArray(pages)) return true;
  return pages.some((p) => {
    const comp = (p as { frames?: Array<{ component?: { components?: unknown; componentsRef?: unknown } }> })?.frames?.[0]?.component;
    if (!comp) return false;
    if (typeof comp.componentsRef === "string") return true;
    const c = comp.components;
    return typeof c === "string" ? c.trim().length > 0 : Array.isArray(c) ? c.length > 0 : c != null;
  });
}
