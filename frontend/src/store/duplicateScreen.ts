import { buildDefaultScreen, loadScreenEntity, saveScreenEntity } from "./screenStore";

/**
 * 画面の内容 (画面項目と業務部品レイアウト) を複製先の画面にコピーする。
 * 複製先の画面 (プロジェクト上のノード) は呼び出し側が先に作っておく。
 * uuid・名前・パスは複製先のものを使う。旧形式のデザイン (GrapesJS / Puck) は複製しない。
 */
export async function duplicateScreenContent(srcScreenId: string, dupScreenId: string): Promise<void> {
  const [src, base] = await Promise.all([loadScreenEntity(srcScreenId), buildDefaultScreen(dupScreenId)]);
  await saveScreenEntity({
    ...base,
    description: src.description,
    items: structuredClone(src.items ?? []),
    layout: src.layout ? structuredClone(src.layout) : base.layout,
  });
}
