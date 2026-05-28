import { visit } from 'unist-util-visit';
import path from 'node:path';

/**
 * md 内の相対 link を Astro route に書換える rehype plugin。
 *
 * 想定する link 形式と挙動:
 * - `foo.md` / `./foo.md` → `/<current-area>/foo/` (同 area)
 * - `subdir/foo.md` / `./subdir/foo.md` → `/<current-area>/subdir/foo/` (同 area の subdir)
 * - `../<known-area>/foo.md` → `/<known-area>/foo/` (known 別 area)
 * - `../../<known-area>/foo.md` → `/<known-area>/foo/` (深い階層 (例: docs/user-guide/ui-reference/) からの別 area)
 * - `../../AGENTS.md` / `../scripts/.../file.md` 等の 4 area 外 → GitHub blob URL
 * - `https://...` / `mailto:...` / `#anchor` はそのまま
 * - `*.md#anchor` の anchor は保持
 *
 * 戦略: filePath を起点に linkPath を posix path で resolve し、`docs/<known-area>/<rest>.md`
 * の形になれば Astro route `/<area>/<rest>/` に変換する。それ以外は GitHub URL fallback。
 */

const KNOWN_AREAS = new Set(['spec', 'user-guide', 'conventions', 'setup']);
const GITHUB_BASE = 'https://github.com/csilost2001/harmony/blob/main/';

/**
 * filePath (md source の絶対 or repo-relative path) と linkPath (md 内の相対 link) から、
 * **repo root 相対** の正規化 path を返す。
 *
 * 例:
 *   filePath='/abs/repo/docs/user-guide/ui-reference/dashboard.md', linkPath='../../spec/foo.md'
 *     → 'docs/spec/foo.md'
 *   filePath='/abs/repo/docs/setup/dev-containers.md', linkPath='../../ai-skills/foo/SKILL.md'
 *     → 'ai-skills/foo/SKILL.md'
 *   filePath='/abs/repo/docs/user-guide/ui-reference/README.md', linkPath='./dashboard.md'
 *     → 'docs/user-guide/ui-reference/dashboard.md'
 *
 * filePath に `/docs/` が見つからない場合 / link が repo root 外を指す場合は null。
 */
function resolveToRepoRelative(filePath, linkPath) {
  if (!filePath || !linkPath) return null;
  const normalizedFilePath = filePath.replaceAll('\\', '/');
  // repo root は filePath の /docs/ の手前まで (絶対 path / repo-relative 両対応)
  const docsIdx = normalizedFilePath.indexOf('/docs/');
  let fileRepoRel;
  if (docsIdx >= 0) {
    fileRepoRel = normalizedFilePath.substring(docsIdx + 1); // 'docs/...'
  } else if (normalizedFilePath.startsWith('docs/')) {
    fileRepoRel = normalizedFilePath; // 既に repo-relative
  } else {
    return null;
  }
  const fileDir = path.posix.dirname(fileRepoRel);
  const joined = path.posix.normalize(path.posix.join(fileDir, linkPath));
  // repo root の外を指している (例: '../../../foo.md' が repo root を突き抜けた) → null
  if (joined.startsWith('../')) return null;
  return joined;
}

export function rehypeRewriteMdLinks() {
  return (tree, file) => {
    // file.path or file.history から area 推定 (fallback 経路で使用)
    const filePath = file?.path ?? file?.history?.[0] ?? '';

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

      // path resolve で repo-relative に正規化
      const repoRel = resolveToRepoRelative(filePath, linkPath);
      if (!repoRel) return;

      // 1. docs/<known-area>/<rest>.md → Astro route /<area>/<rest>/
      //    subdir 含む (例: docs/user-guide/ui-reference/dashboard.md → /user-guide/ui-reference/dashboard/)
      //    Astro glob loader は entry id を lowercase 化するので URL も lowercase
      //    (例: README.md → /readme/)
      const areaMatch = repoRel.match(/^docs\/([\w-]+)\/(.+)\.md$/);
      if (areaMatch) {
        const [, targetArea, restPath] = areaMatch;
        if (KNOWN_AREAS.has(targetArea)) {
          node.properties.href = `/${targetArea}/${restPath.toLowerCase()}/${anchorSuffix}`;
          return;
        }
        // docs/ 配下だが known area 外 (例: docs/html/... は build artifact なので想定外)
        // → GitHub URL fallback
        node.properties.href = `${GITHUB_BASE}${repoRel}${anchorSuffix}`;
        return;
      }

      // 2. docs/ 外 (AGENTS.md / scripts/ / README.md など) → GitHub URL fallback
      node.properties.href = `${GITHUB_BASE}${repoRel}${anchorSuffix}`;
    });
  };
}
