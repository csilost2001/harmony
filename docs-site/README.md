# Harmony Docs Site

Harmony の仕様書・プレゼン (`docs/spec/*.md` / `docs/user-guide/*.md` / `docs/conventions/*.md` / `docs/setup/*.md`) を HTML 化する Astro 5 静的サイト。出力先は `../docs/html/` (git tracked、配布物)。

## 前提

- Node.js **20.3.0+** または **22+** (Astro 5.x 要件、Astro 6 は Node 22+ 必須なため本プロジェクトでは 5 系を採用)
- npm 9.6.5+

## セットアップ (初回のみ)

```bash
cd docs-site
npm install

# rehype-mermaid が Playwright chromium を必要とするため、初回のみ:
npx playwright install chromium
```

## build

```bash
cd docs-site
npm run build
# → ../docs/html/ に出力
# → ../docs/html/pagefind/ に検索 index 生成
```

## dev (live reload)

```bash
cd docs-site
npm run dev
# → http://localhost:4321
```

## 技術スタック

| 領域 | 採用 | バージョン |
|---|---|---|
| 静的サイト生成 | [Astro](https://astro.build/) | ^5.18.1 |
| CSS | [Tailwind CSS v4](https://tailwindcss.com/) | ^4.x |
| プラグイン | `@tailwindcss/vite` / `@tailwindcss/typography` | ^4.x / ^0.5.16 |
| 全文検索 | [pagefind](https://pagefind.app/) + `astro-pagefind` | ^2.0.0 |
| syntax highlight | shiki (Astro 同梱) | — |
| mermaid 図 | `rehype-mermaid` (build-time SVG、Playwright 経由) | ^3.0.0 |

## 構成

```
docs-site/
├── astro.config.mjs          # Astro + Tailwind + pagefind + rehype-mermaid 設定
├── package.json
├── tsconfig.json
└── src/
    ├── layouts/
    │   └── SpecLayout.astro  # 共通レイアウト (sidebar / 検索 / dark mode toggle / copy button)
    ├── components/
    │   └── SchemaTable.astro # JSON Schema → table 自動生成
    ├── pages/
    │   ├── index.astro       # トップ
    │   └── spec/             # 仕様書 (Phase C で実コンテンツ追加)
    └── styles/
        └── global.css        # Tailwind v4 + typography + dark variant
```

## 出力先と運用ルール

- **出力**: `../docs/html/` (git tracked、配布物として commit)
- **編集対象**: `../docs/spec/*.md` 等の Markdown を編集 → `npm run build` で再生成
- **`docs/html/` を手編集することは禁止** (build artifact)
- AGENTS.md / CLAUDE.md の運用フローは Phase E (#1129) で更新予定

## 関連

- メタ ISSUE: [#1124](https://github.com/csilost2001/harmony/issues/1124)
- Phase B (本ディレクトリ): [#1126](https://github.com/csilost2001/harmony/issues/1126)
- 監査レポート: [`../docs/spec/_audit-2026-05-17.md`](../docs/spec/_audit-2026-05-17.md)
