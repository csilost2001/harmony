# React + Tailwind CSS + Next.js App Router — PageLayout テンプレート

PageLayout JSON (`page-layouts/<id>.json`) から Next.js App Router 向けの Custom AppLayout コンポーネントを生成する。
`techStack.designer.cssFramework = "tailwind"` かつ `techStack.frontend.framework = "next"` の前提。
生成先: `app/components/layouts/<pageLayoutId>.tsx`

**参照スキル**: SKILL.md の Step 3-D に対応。

---

## 設計判断: Custom AppLayout パターン (App Router Nested Layout との比較)

Next.js App Router には 2 種類の layout 方式がある:

| 方式 | 採用 | 理由 |
|---|---|---|
| `app/(group)/layout.tsx` (route group Nested Layout) | **不採用** | PageLayout の自由度を制限する (1 PageLayout = 1 route group に強制束縛) |
| Custom `<AppLayout>` コンポーネント (本テンプレ採用) | **採用** | page 側が明示 import + wrap するため、複数 PageLayout の切り替えが柔軟。Server Components 互換 |

採用パターン:
- `app/components/layouts/<pageLayoutId>.tsx` に `AppLayout` を default export
- page 側: `import AppLayout from '@/app/components/layouts/<pageLayoutId>'; return <AppLayout><Body /></AppLayout>;`
- `<AppLayout>` は `children` prop を受ける Server Component (Gadget 内で `'use client'` を持つため、Layout 自体は `'use client'` 不要)

---

## フィールドマッピング

| PageLayout JSON フィールド | Next.js 生成物 |
|---|---|
| `id` | ファイル名 `layouts/<id>.tsx`、コンポーネントコメントで `// PageLayout: <id>` |
| `name` | コンポーネントコメントで `// name: <name>` |
| `regions[].name` | JSX slot タグ (`<header>` / `<aside>` / `<main>` / `<footer>`) |
| `assignments["header"]` | `import HeaderGadget from '@/app/components/gadgets/<gadgetId>'` + `<header>` 内 mount |
| `assignments["sidebar"]` | `import SidebarGadget from '@/app/components/gadgets/<gadgetId>'` + `<aside>` 内 mount |
| `assignments["footer"]` | `import FooterGadget from '@/app/components/gadgets/<gadgetId>'` + `<footer>` 内 mount |
| `assignments["main"]` | main region は assignment 不要。`{children}` を inject する slot |
| `design.cssFramework="tailwind"` | Tailwind class 規約適用 (下記 Tailwind region 規約参照) |
| `design.editorKind="puck"` | Region primitive と互換 (本テンプレでは静的 import を選択、Puck Render は別 issue) |
| `design.designFileRef` | コード生成時は構造のみ採用 (wireframe ヒントとして参照するが出力に含めない) |

### assignments が未指定の region の扱い

`assignments` に `regionName` が存在しない region は **空のプレースホルダコメント** として出力する:

```tsx
{/* region: <name> — 未割り当て (assignments に "<name>" なし) */}
{/* 必要に応じて Gadget を割り当ててください */}
```

main region は常に assignment なし (`assignments` にキーがあっても無視) — `{children}` inject 先の予約 slot。

---

## Tailwind region 規約

全テンプレート (LAYOUT.md / COMPONENT.md / PAGE.md) で一貫して使用する Tailwind クラス:

| region | HTML タグ | Tailwind クラス |
|---|---|---|
| `header` | `<header>` | `flex items-center justify-between bg-blue-900 text-white px-4 py-3 shadow` |
| `sidebar` | `<aside>` | `w-64 bg-gray-100 p-4 border-r` |
| `main` | `<main>` | `flex-1 p-6` |
| `footer` | `<footer>` | `text-center bg-gray-50 py-4 border-t mt-auto` |

全体構造:
- `<div className="flex flex-col min-h-screen">` — flexbox による縦全画面レイアウト
- main + sidebar は `<div className="flex flex-1">` の flex で横並び配置

---

## 完成テンプレート TSX 例

**対象**: `examples/retail/harmony/page-layouts/main-layout.json` (Main Layout)
- regions: header / sidebar / footer / main
- assignments: header → `global-header-gadget` (グローバルヘッダ) / sidebar → `navigation-sidebar-gadget` (ナビゲーションサイドバー) / footer → `global-footer-gadget` (グローバルフッタ)
- main は assignment なし (各 page が children を inject)

### `app/components/layouts/main-layout.tsx`

```tsx
// PageLayout: main-layout
// name: Main Layout
// regions: header, sidebar, footer, main
// assignments:
//   header → global-header-gadget (グローバルヘッダ)
//   sidebar → navigation-sidebar-gadget (ナビゲーションサイドバー)
//   footer → global-footer-gadget (グローバルフッタ)
//
// 使い方 (page 側): import AppLayout from '@/app/components/layouts/main-layout';
//                   return <AppLayout><YourPageBody /></AppLayout>;

import type { ReactNode } from 'react';
import GlobalHeaderGadget from '@/app/components/gadgets/global-header-gadget';
import NavigationSidebarGadget from '@/app/components/gadgets/navigation-sidebar-gadget';
import GlobalFooterGadget from '@/app/components/gadgets/global-footer-gadget';

interface AppLayoutProps {
  children: ReactNode;
}

/**
 * Main Layout (PageLayout: main-layout)
 *
 * retail サンプルの標準レイアウト (ヘッダ + サイドバー + フッタ)。
 * ヘッダ・サイドバー・フッタは Gadget コンポーネントを静的 import で配置。
 * main region は children として page 側から渡される。
 *
 * Server Component (Gadget 側で 'use client' を管理するため、本コンポーネントは非クライアント)。
 */
export default function AppLayout({ children }: AppLayoutProps) {
  return (
    <div className="flex flex-col min-h-screen">

      {/* region: header — グローバルヘッダ Gadget (global-header-gadget) */}
      <header className="flex items-center justify-between bg-blue-900 text-white px-4 py-3 shadow">
        <GlobalHeaderGadget />
      </header>

      {/* main コンテンツエリア (sidebar + main を横並び) */}
      <div className="flex flex-1">

        {/* region: sidebar — ナビゲーションサイドバー Gadget (navigation-sidebar-gadget) */}
        <aside className="w-64 bg-gray-100 p-4 border-r">
          <NavigationSidebarGadget />
        </aside>

        {/* region: main — page の children を inject する slot */}
        <main className="flex-1 p-6">
          {children}
        </main>

      </div>

      {/* region: footer — グローバルフッタ Gadget (global-footer-gadget) */}
      <footer className="text-center bg-gray-50 py-4 border-t mt-auto">
        <GlobalFooterGadget />
      </footer>

    </div>
  );
}
```

---

## AI コード生成時の置換ルール

上記テンプレートを生成する際、AI は以下の `<<...>>` placeholder を PageLayout JSON の実値で置換する:

| placeholder | 置換値 |
|---|---|
| `<<pageLayoutId>>` | `PageLayout.id` |
| `<<pageLayoutName>>` | `PageLayout.name` |
| `<<regionNames>>` | `regions[].name` をカンマ区切り |
| `<<headerGadgetId>>` | `assignments["header"]` の gadget ID |
| `<<sidebarGadgetId>>` | `assignments["sidebar"]` の gadget ID |
| `<<footerGadgetId>>` | `assignments["footer"]` の gadget ID |
| `<<HeaderGadgetName>>` | headerGadgetId に対応する Screen.name を PascalCase 変換 + `Gadget` サフィックス |
| `<<SidebarGadgetName>>` | sidebarGadgetId に対応する Screen.name を PascalCase 変換 + `Gadget` サフィックス |
| `<<FooterGadgetName>>` | footerGadgetId に対応する Screen.name を PascalCase 変換 + `Gadget` サフィックス |

### Gadget コンポーネント名の変換規則

| Screen.name (日本語) | import 変数名 (PascalCase) |
|---|---|
| `グローバルヘッダ` | `GlobalHeaderGadget` |
| `ナビゲーションサイドバー` | `NavigationSidebarGadget` |
| `グローバルフッタ` | `GlobalFooterGadget` |

変換手順: Screen.name を英語 PascalCase に意味訳 + `Gadget` サフィックス。

### region が一部未割り当ての場合

`assignments` に未指定の region は対応する JSX タグをプレースホルダコメントに置き換える。例として sidebar が未割り当ての場合:

```tsx
{/* region: sidebar — 未割り当て (assignments に "sidebar" なし) */}
{/* 必要に応じて Gadget を割り当ててください */}
```

main region の `{children}` は assignments に関わらず **常に出力**する (page content の inject 先であるため)。

---

## 生成ファイル一覧

```
<出力先>/
  app/components/layouts/
    <pageLayoutId>.tsx        (Custom AppLayout Server Component)
```

---

## Placeholder 解釈ルール (AI コード生成時必読)

本テンプレートでは **`<<...>>`** を AI が値で置換する placeholder として使用する。
`import` 文内や JSX 内の `<<...>>` は必ず実際の gadget ID / コンポーネント名に置換してから出力すること。
`<<...>>` のまま TSX に出力してはならない。

| テンプレート記法 | 置換後の出力例 |
|---|---|
| `'@/app/components/gadgets/<<headerGadgetId>>'` | `'@/app/components/gadgets/global-header-gadget'` |
| `<<HeaderGadgetName>>` | `GlobalHeaderGadget` |
| `// PageLayout: <<pageLayoutId>>` | `// PageLayout: main-layout` |
