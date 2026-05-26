# React + Tailwind CSS + Next.js App Router — Gadget Component テンプレート

Gadget Screen JSON (`screens/<id>.json` の `purpose: "gadget"`) から Next.js App Router 向けの React コンポーネントと Route Handler を生成する。
`techStack.designer.cssFramework = "tailwind"` かつ `techStack.frontend.framework = "next"` の前提。

**参照スキル**: SKILL.md の Step 3-C (NestJS/Next.js 系 Gadget 生成) に対応。

---

## 生成ファイル一覧

```
<出力先>/
  app/components/gadgets/
    <gadgetId>.tsx                        (React コンポーネント — Server Component default)
  app/api/gadgets/<gadgetId>/
    <actionId>/
      route.ts                            (Route Handler — processFlowId 連携時の各 action ごと)
```

`processFlowId` が存在しない (design-only Gadget) 場合: Route Handler (`app/api/...`) は生成しない。
`items[].events[]` を持つ item が存在しない場合も Route Handler は生成しない。

---

## フィールドマッピング

### Component 側 (`app/components/gadgets/<gadgetId>.tsx`)

| Gadget Screen JSON フィールド | Next.js 出力 |
|---|---|
| `id` | ファイル名 `gadgets/<id>.tsx`、コメントで `// Gadget: <id>` |
| `name` | コンポーネント関数名 (PascalCase 変換 + `Gadget` サフィックス)、コメントで `// name: <name>` |
| `processFlowId` | コメントで `// ProcessFlow: <processFlowId>` |
| `items[].id` | props の key / JSX 内の変数名 |
| `items[].label` | `<label>` / `<span>` のテキスト / ボタンラベル |
| `items[].direction = "output"` | `<span>` / `<p>` として Server Component で表示 |
| `items[].direction = "input"` かつ `events[]` あり | `<form action={...}>` 内の `<button type="submit">` (Server Action or fetch) |
| `items[].direction = "input"` かつ `events[]` なし | ナビゲーションリンク `<Link href="...">` |
| `items[].events[].handlerFlowId` | Route Handler の呼び出し先 (ProcessFlow の httpRoute.path) |
| `items[].events[].handlerActionId` | 対応する action ID / Route Handler のパスセグメント |
| `design.cssFramework` | Tailwind クラス規約適用 |

### `'use client'` directive の付与ルール

```
items[] に events[] を持つ item が 1 つ以上存在する場合:
  → コンポーネントファイルの先頭に 'use client' を付与
  → useState / useRouter / fetch を使ったクライアントサイドの送信処理を生成

events[] を持つ item が存在しない場合 (design-only Gadget):
  → 'use client' 不要 (Server Component)
  → props は親 AppLayout または page から渡される静的値のみ
```

### Route Handler 側 (`app/api/gadgets/<gadgetId>/<actionId>/route.ts`)

| ProcessFlow JSON フィールド | Route Handler 出力 |
|---|---|
| `meta.id` | コメントで ProcessFlow ID 記載 |
| `meta.name` | コメント |
| `actions[].id` | ディレクトリ名 `<actionId>/` およびコメント |
| `actions[].httpRoute.method` | `export async function POST(...)` / `GET(...)` |
| `actions[].httpRoute.path` | コメントで記載、`NextRequest` から path は Next.js App Router が解決 |
| `actions[].httpRoute.auth` | `// TODO: 認証チェック (auth: <value>)` コメント |
| `actions[].outputs[name=redirectTo]` | `return NextResponse.redirect(new URL('<value>', request.url))` |

---

## Tailwind region 規約 (Gadget)

Gadget は PageLayout の各 region に配置されるため、region 別の Tailwind クラスを適用する:

| region | Gadget ラッパー div クラス |
|---|---|
| `header` | `flex items-center w-full gap-3` (ヘッダ navbar 内に収まるフレックスレイアウト) |
| `sidebar` | `flex flex-col gap-2` (縦並びナビゲーション) |
| `footer` | `w-full` (コンテンツをセンタリング、footer タグ側で text-center 指定) |
| その他 / 汎用 | (クラスなし、Gadget の design に依存) |

---

## 完成テンプレート例 — グローバルヘッダ Gadget (events あり → 'use client')

**対象**: `screens/global-header-gadget.json` (グローバルヘッダ)
- items: storeName (output) / userName (output) / logoutButton (input, events=[click → act-logout])
- processFlowId: `header-gadget-handler` (ヘッダーガジェット処理)
- act-logout の httpRoute: POST /api/retail/auth/logout → redirectTo=/login

### Component: `app/components/gadgets/global-header-gadget.tsx`

```tsx
'use client';
// Gadget: global-header-gadget
// name: グローバルヘッダ
// ProcessFlow: header-gadget-handler (ヘッダーガジェット処理)
// parent AppLayout の header region から import される Gadget コンポーネント
//
// 'use client': logoutButton (events=[click → act-logout]) が存在するため付与

import { useRouter } from 'next/navigation';

interface GlobalHeaderGadgetProps {
  /** storeName (direction=output): ログイン中の店舗名。Server Component から渡す場合は props で受け取る */
  storeName?: string;
  /** userName (direction=output): ログイン中のユーザー氏名。Server Component から渡す場合は props で受け取る */
  userName?: string;
}

/**
 * グローバルヘッダ Gadget (global-header-gadget)
 *
 * 全画面共通のグローバルヘッダ。店舗名・ログインユーザー名を表示し、ログアウトボタンを提供する。
 * PageLayout (Main Layout) の header region に割り当てられる gadget。
 */
export default function GlobalHeaderGadget({
  storeName,
  userName,
}: GlobalHeaderGadgetProps) {
  const router = useRouter();

  // act-logout: ログアウト処理
  // ProcessFlow action ID: act-logout
  // httpRoute: POST /api/retail/auth/logout (auth: required)
  const handleLogout = async () => {
    // TODO: 認証チェック (auth: required)
    // TODO: CSRF 対策は別 issue で対応
    const res = await fetch('/api/gadgets/global-header-gadget/act-logout', {
      method: 'POST',
    });
    if (res.ok) {
      const data = await res.json();
      // ProcessFlow step-02: return { redirectTo: '/login' }
      router.push(data.redirectTo ?? '/login');
    }
  };

  return (
    <div className="flex items-center w-full gap-3">

      {/* ブランド / アプリ名 (左端) */}
      <a href="/" className="font-bold text-white text-lg hover:text-blue-200">
        Harmony Retail
      </a>

      {/* storeName (direction=output) */}
      <span className="text-blue-200 text-sm">
        {storeName ?? '店舗未選択'}
      </span>

      <span className="text-blue-300">|</span>

      {/* userName (direction=output) */}
      <span className="text-white text-sm">
        {userName ?? '(未ログイン)'}
      </span>

      {/* 右端に寄せる spacer */}
      <div className="ml-auto" />

      {/* logoutButton (direction=input, events=[click → act-logout]) */}
      <button
        type="button"
        onClick={handleLogout}
        className="border border-white text-white text-sm px-3 py-1 rounded hover:bg-white hover:text-blue-900 transition-colors"
      >
        ログアウト
      </button>

    </div>
  );
}
```

### Route Handler: `app/api/gadgets/global-header-gadget/act-logout/route.ts`

```ts
// Route Handler: act-logout
// Gadget: global-header-gadget (グローバルヘッダ)
// ProcessFlow: header-gadget-handler (ヘッダーガジェット処理)
// httpRoute: POST /api/retail/auth/logout (auth: required)

import { NextRequest, NextResponse } from 'next/server';

/**
 * act-logout: ログアウト処理
 *
 * ヘッダの logoutButton 押下時に発火する。
 * サーバ側でセッションを破棄し、ログイン画面 (/login) へのリダイレクト URL を返す。
 *
 * ProcessFlow step-01: redirectTo = '/login'
 * ProcessFlow step-02: return { redirectTo: '/login' }
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  // TODO: 認証チェック (auth: required) — ミドルウェアまたは NextAuth.js で実装推奨
  // TODO: CSRF 対策 — Next.js 13+ では Server Action 使用が推奨 (別 issue)

  // ProcessFlow: ヘッダーガジェット処理 (header-gadget-handler)
  // step-01: セッション破棄後のリダイレクト先 URL を導出する
  // 具体的なセッション invalidate は framework 側 (NextAuth.js / NestJS Passport 等) に委ねる
  await globalHeaderGadgetService.executeAction('act-logout', {});

  // step-02: return { redirectTo: '/login' }
  return NextResponse.json({ redirectTo: '/login' });
}

// --- Service スタブ (processFlowId 連携) ---
const globalHeaderGadgetService = {
  async executeAction(actionId: string, payload: Record<string, unknown>): Promise<void> {
    // TODO: ProcessFlow header-gadget-handler の
    //       action "${actionId}" を実行するサービス層を実装する
    // 例: セッション破棄 / JWT 無効化 / ログアウトイベント発行
    console.log(`[GlobalHeaderGadget] executeAction: ${actionId}`, payload);
  },
};
```

---

## 完成テンプレート例 — ナビゲーションサイドバー Gadget (events なし → Server Component)

**対象**: `screens/navigation-sidebar-gadget.json` (ナビゲーションサイドバー)
- items: navProductSearch / navOrderList / navCustomerList / navMasterManagement (全て input、events なし)
- processFlowId: なし (design-only Gadget → Route Handler 生成しない)

### Component: `app/components/gadgets/navigation-sidebar-gadget.tsx`

```tsx
// Gadget: navigation-sidebar-gadget
// name: ナビゲーションサイドバー
// processFlowId: なし (design-only、Route Handler 不要)
// 'use client' 不要 (events[] なし → Server Component)

import Link from 'next/link';

/**
 * ナビゲーションサイドバー Gadget (navigation-sidebar-gadget)
 *
 * 全画面共通のナビゲーションサイドバー。
 * 商品一覧・注文一覧・顧客一覧・マスタ管理へのリンクメニューを提供する。
 * PageLayout (Main Layout) の sidebar region に割り当てられる gadget。
 */
export default function NavigationSidebarGadget() {
  return (
    <div className="flex flex-col gap-2">

      <p className="text-gray-500 text-xs font-semibold mb-1 uppercase tracking-wide">
        メニュー
      </p>

      {/* navProductSearch (direction=input、ナビリンク → /products/search) */}
      <Link
        href="/products/search"
        className="block text-sm text-gray-700 px-3 py-2 rounded hover:bg-gray-200 transition-colors"
      >
        商品検索
      </Link>

      {/* navOrderList (direction=input、ナビリンク → /orders) */}
      <Link
        href="/orders"
        className="block text-sm text-gray-700 px-3 py-2 rounded hover:bg-gray-200 transition-colors"
      >
        注文一覧
      </Link>

      {/* navCustomerList (direction=input、ナビリンク → /master/customers) */}
      <Link
        href="/master/customers"
        className="block text-sm text-gray-700 px-3 py-2 rounded hover:bg-gray-200 transition-colors"
      >
        顧客一覧
      </Link>

      {/* navMasterManagement (direction=input、ナビリンク → /master/products) */}
      <Link
        href="/master/products"
        className="block text-sm text-gray-700 px-3 py-2 rounded hover:bg-gray-200 transition-colors"
      >
        マスタ管理
      </Link>

    </div>
  );
}
```

Route Handler は生成しない (processFlowId なし)。

---

## 完成テンプレート例 — グローバルフッタ Gadget (events なし → Server Component)

**対象**: `screens/global-footer-gadget.json` (グローバルフッタ)
- items: copyright (output) / version (output)
- processFlowId: なし

### Component: `app/components/gadgets/global-footer-gadget.tsx`

```tsx
// Gadget: global-footer-gadget
// name: グローバルフッタ
// processFlowId: なし (design-only)
// 'use client' 不要 (events[] なし → Server Component)

interface GlobalFooterGadgetProps {
  /** copyright (direction=output): 著作権表記 */
  copyright?: string;
  /** version (direction=output): アプリケーションバージョン文字列 */
  version?: string;
}

/**
 * グローバルフッタ Gadget (global-footer-gadget)
 *
 * 全画面共通のグローバルフッタ。コピーライト表記とアプリバージョンを表示する。
 * PageLayout (Main Layout) の footer region に割り当てられる gadget。
 */
export default function GlobalFooterGadget({
  copyright,
  version,
}: GlobalFooterGadgetProps) {
  return (
    <div className="w-full">

      {/* copyright (direction=output) */}
      <p className="text-gray-500 text-sm mb-1">
        {copyright ?? '© 2026 Harmony Retail Inc.'}
      </p>

      {/* version (direction=output) */}
      <p className="text-gray-400 text-xs">
        {version ?? 'v1.0.0'}
      </p>

    </div>
  );
}
```

---

## AI コード生成時の置換ルール

| placeholder | 置換値 |
|---|---|
| `<<gadgetId>>` | `Screen.id` |
| `<<gadgetName>>` | `Screen.name` |
| `<<processFlowId>>` | `Screen.processFlowId` (なければコメント削除) |
| `<<GadgetComponentName>>` | `Screen.name` を PascalCase に変換 + `Gadget` サフィックス |
| `<<actionId>>` | `ProcessFlow.actions[].id` (Route Handler ディレクトリ名) |
| `<<httpRoutePath>>` | `ProcessFlow.actions[actionId].httpRoute.path` |
| `<<httpRouteMethod>>` | `ProcessFlow.actions[actionId].httpRoute.method` (大文字) |
| `<<redirectTo>>` | ProcessFlow action の outputs[name=redirectTo] から推定 (通例 `/login`) |
| `<<ServiceName>>` | `Screen.name` を英語 camelCase + `GadgetService` (サービスオブジェクト名) |

### Gadget コンポーネント名の変換規則

| Screen.name (日本語) | コンポーネント関数名 |
|---|---|
| `グローバルヘッダ` | `GlobalHeaderGadget` |
| `ナビゲーションサイドバー` | `NavigationSidebarGadget` |
| `グローバルフッタ` | `GlobalFooterGadget` |

変換手順: Screen.name を英語 PascalCase に意味訳 + `Gadget` サフィックス。

---

## processFlowId 連携パターン

### events[].handlerActionId を持つ input item → fetch + Route Handler 生成

**Component 側** (client component):
```tsx
const handle<<ActionPascalCase>> = async () => {
  // TODO: CSRF 対策は別 issue で対応
  const res = await fetch('/api/gadgets/<<gadgetId>>/<<actionId>>', {
    method: '<<httpRouteMethod>>',
  });
  if (res.ok) {
    const data = await res.json();
    router.push(data.redirectTo ?? '/');
  }
};

// JSX:
<button type="button" onClick={handle<<ActionPascalCase>>} className="...">
  <<item.label>>
</button>
```

**Route Handler 側**:
```ts
export async function <<HTTP_METHOD>>(request: NextRequest): Promise<NextResponse> {
  // TODO: 認証チェック (auth: <<httpRoute.auth>>)
  await <<serviceName>>.executeAction('<<actionId>>', {});
  return NextResponse.json({ redirectTo: '<<redirectTo>>' });
}
```

### events[] が存在しない input item → Next.js Link コンポーネント生成

```tsx
{/* item: <<itemId>> (direction=input、events なし → ナビリンク) */}
<Link
  href="<<description から path を抽出>>"
  className="block text-sm text-gray-700 px-3 py-2 rounded hover:bg-gray-200 transition-colors"
>
  <<item.label>>
</Link>
```

`items[].description` に `(/path/to/page)` パターンが含まれる場合は正規表現 `/\(([^)]+)\)/` で抽出する。

---

## Placeholder 解釈ルール (AI コード生成時必読)

本テンプレートでは **`<<...>>`** を AI が値で置換する placeholder として使用する。
`import` 文・fetch URL・Route Handler パス内の `<<...>>` は必ず実際の値に置換してから出力すること。
`<<...>>` のまま TSX / TS に出力してはならない。

| テンプレート記法 | 置換後の出力例 |
|---|---|
| `'/api/gadgets/<<gadgetId>>/<<actionId>>'` | `'/api/gadgets/global-header-gadget/act-logout'` |
| `<<GadgetComponentName>>` | `GlobalHeaderGadget` |
| `// Gadget: <<gadgetId>>` | `// Gadget: global-header-gadget` |
