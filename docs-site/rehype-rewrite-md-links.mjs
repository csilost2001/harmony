import { visit } from 'unist-util-visit';

/**
 * md 内の相対 link を Astro route に書換える rehype plugin。
 *
 * 想定する link 形式:
 * - `foo.md` → `/spec/foo/` (同 area 想定)
 * - `./foo.md` → `/spec/foo/` (同上)
 * - `../user-guide/foo.md` → `/user-guide/foo/` (別 area)
 * - `https://...` や `#anchor` はそのまま
 */
export function rehypeRewriteMdLinks() {
  return (tree, file) => {
    // file.path or file.history から area 推定
    const filePath = file?.path ?? file?.history?.[0] ?? '';
    let area = 'spec';
    if (filePath.includes('/user-guide/')) area = 'user-guide';
    else if (filePath.includes('/conventions/')) area = 'conventions';
    else if (filePath.includes('/setup/')) area = 'setup';

    visit(tree, 'element', (node) => {
      if (node.tagName !== 'a') return;
      const href = node.properties?.href;
      if (typeof href !== 'string') return;
      // 外部 URL / アンカーは skip
      if (/^(https?:|mailto:|#)/i.test(href)) return;
      if (!href.endsWith('.md')) return;

      // 別 area 参照を検出 (../<area>/...md)
      const otherAreaMatch = href.match(/\.\.\/([\w-]+)\/([^/]+)\.md$/);
      if (otherAreaMatch) {
        const [, otherArea, filename] = otherAreaMatch;
        node.properties.href = `/${otherArea}/${filename}/`;
        return;
      }

      // 同 area の参照 (./ or 直接)
      const filename = href.replace(/^\.\//, '').replace(/\.md$/, '');
      // パス区切りがある場合は最後のセグメントのみ使用
      const lastSegment = filename.split('/').pop() ?? filename;
      node.properties.href = `/${area}/${lastSegment}/`;
    });
  };
}
