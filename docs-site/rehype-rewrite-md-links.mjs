import { visit } from 'unist-util-visit';

/**
 * md 内の相対 link を Astro route に書換える rehype plugin。
 *
 * 想定する link 形式と挙動:
 * - `foo.md` / `./foo.md` → `/<current-area>/foo/` (同 area)
 * - `../<known-area>/foo.md` → `/<known-area>/foo/` (known 別 area)
 * - `../../AGENTS.md` / `../scripts/.../file.md` 等の 4 area 外 → GitHub blob URL
 * - `https://...` / `mailto:...` / `#anchor` はそのまま
 * - `*.md#anchor` の anchor は保持
 */

const KNOWN_AREAS = new Set(['spec', 'user-guide', 'conventions', 'setup']);
const GITHUB_BASE = 'https://github.com/csilost2001/harmony/blob/main/';

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
      if (!href.includes('.md')) return;

      // anchor を分離
      const [linkPath, anchor] = href.split('#');
      if (!linkPath.endsWith('.md')) return;
      const anchorSuffix = anchor ? `#${anchor}` : '';

      // 1. 別 area 参照 (../<known-area>/foo.md → /<area>/foo/)
      const otherAreaMatch = linkPath.match(/^\.\.\/([\w-]+)\/([^/]+)\.md$/);
      if (otherAreaMatch) {
        const [, otherArea, filename] = otherAreaMatch;
        if (KNOWN_AREAS.has(otherArea)) {
          node.properties.href = `/${otherArea}/${filename}/${anchorSuffix}`;
          return;
        }
        // known area でない (例: ../scripts/foo.md) → GitHub URL fallback
        const cleanPath = linkPath.replace(/^(\.\.\/)+/, '');
        node.properties.href = `${GITHUB_BASE}${cleanPath}${anchorSuffix}`;
        return;
      }

      // 2. 2 上以上の参照 (../../AGENTS.md など) → GitHub URL fallback
      if (linkPath.startsWith('../../')) {
        const cleanPath = linkPath.replace(/^(\.\.\/)+/, '');
        node.properties.href = `${GITHUB_BASE}${cleanPath}${anchorSuffix}`;
        return;
      }

      // 3. 同 area 参照 (./foo.md or foo.md)
      const filename = linkPath.replace(/^\.\//, '').replace(/\.md$/, '');
      const lastSegment = filename.split('/').pop() ?? filename;
      node.properties.href = `/${area}/${lastSegment}/${anchorSuffix}`;
    });
  };
}
