# React + Tailwind CSS + Next.js App Router — Page テンプレート

Screen JSON の `kind` と `items[]` から Next.js App Router (Server Components 優先) のページコンポーネントを生成する。
`techStack.designer.editorKind = "puck"` + `cssFramework = "tailwind"` の前提。
`screen.pageLayoutId` 指定時は下記「Layout Wrap モード」に自動切替し、生成ページを `<AppLayout>` でラップする。

## フィールドマッピング

| Screen JSON フィールド | Next.js 生成物 |
|---|---|
| `name` | ページタイトル / コンポーネント名 |
| `path` | `app/` ディレクトリ構造 (例: `/products/search` → `app/products/search/page.tsx`) |
| `kind` | テンプレートパターン選択 |
| `items[].id` | フォームフィールド名 / state key |
| `items[].label` | `<label>` テキスト |
| `items[].direction = "input"` | `<input>` / `<select>` (クライアントコンポーネント) |
| `items[].direction = "output"` | Server Component での表示 |
| `items[].direction = "viewer"` | データテーブルコンポーネント |
| `items[].required = true` | HTML `required` 属性 + Zod バリデーション |
| `items[].type` | TypeScript 型 / input type |
| `items[].options[]` | `<select>` / radio group |
| `items[].events[]` | Server Action / API call |

## kind 別テンプレートパターン

### kind=search (検索画面)

```tsx
// app/products/search/page.tsx (Server Component)
import { Suspense } from 'react';
import { ProductSearchForm } from '@/components/products/product-search-form';
import { InventoryResultTable } from '@/components/products/inventory-result-table';

/**
 * 商品検索ページ。
 *
 * Screen: product-search
 * ProcessFlow: inventory-by-store-lookup (店舗在庫照会)
 */
export default async function ProductSearchPage({
  searchParams,
}: {
  searchParams: Promise<{ productCode?: string; storeCode?: string }>;
}) {
  const params = await searchParams;

  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold mb-6">商品検索</h1>

      {/* 検索フォーム (items[].direction=input から展開) */}
      <ProductSearchForm
        defaultProductCode={params.productCode}
        defaultStoreCode={params.storeCode}
      />

      {/* 検索結果 (items[].direction=viewer から展開) */}
      {params.storeCode && (
        <Suspense fallback={<div className="mt-4 text-gray-500">検索中...</div>}>
          <InventoryResultTable
            productCode={params.productCode}
            storeCode={params.storeCode}
          />
        </Suspense>
      )}
    </div>
  );
}
```

### 検索フォームコンポーネント (Client Component)

```tsx
// components/products/product-search-form.tsx
'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

/**
 * 商品検索フォームコンポーネント。
 * Screen items[].direction=input から展開。
 */
interface ProductSearchFormProps {
  defaultProductCode?: string;
  defaultStoreCode?: string;
}

export function ProductSearchForm({
  defaultProductCode,
  defaultStoreCode,
}: ProductSearchFormProps) {
  const router = useRouter();
  const [productCode, setProductCode] = useState(defaultProductCode ?? '');
  const [storeCode, setStoreCode] = useState(defaultStoreCode ?? '');
  const [errors, setErrors] = useState<{ productCode?: string; storeCode?: string }>({});

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const newErrors: typeof errors = {};

    // バリデーション (items[].required / pattern から展開)
    if (!storeCode) {
      newErrors.storeCode = '店舗を選択してください。';
    }
    if (productCode && !/^P-\d{4,6}$/.test(productCode)) {
      newErrors.productCode = '商品コードは P-XXXX〜P-XXXXXX 形式で入力してください。';
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    const params = new URLSearchParams();
    if (productCode) params.set('productCode', productCode);
    if (storeCode) params.set('storeCode', storeCode);
    router.push(`/products/search?${params.toString()}`);
  };

  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-lg shadow p-6 mb-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* productCode: items[].direction=input, type=string */}
        <div>
          <label htmlFor="productCode" className="block text-sm font-medium text-gray-700 mb-1">
            商品コード
          </label>
          <input
            type="text"
            id="productCode"
            value={productCode}
            onChange={(e) => setProductCode(e.target.value)}
            placeholder="例: P-0001"
            maxLength={20}
            className={`w-full rounded-md border px-3 py-2 text-sm shadow-sm ${
              errors.productCode ? 'border-red-500' : 'border-gray-300'
            } focus:outline-none focus:ring-2 focus:ring-blue-500`}
          />
          {errors.productCode && (
            <p className="mt-1 text-xs text-red-600">{errors.productCode}</p>
          )}
        </div>

        {/* storeCode: items[].direction=input, options あり → <select> */}
        <div>
          <label htmlFor="storeCode" className="block text-sm font-medium text-gray-700 mb-1">
            店舗 <span className="text-red-500">*</span>
          </label>
          <select
            id="storeCode"
            value={storeCode}
            onChange={(e) => setStoreCode(e.target.value)}
            required
            className={`w-full rounded-md border px-3 py-2 text-sm shadow-sm ${
              errors.storeCode ? 'border-red-500' : 'border-gray-300'
            } focus:outline-none focus:ring-2 focus:ring-blue-500`}
          >
            <option value="">選択してください</option>
            {/* items[].options[] から展開 */}
            <option value="S-001">東京本店</option>
            <option value="S-002">大阪支店</option>
            <option value="S-003">名古屋支店</option>
          </select>
          {errors.storeCode && (
            <p className="mt-1 text-xs text-red-600">{errors.storeCode}</p>
          )}
        </div>

        <div className="flex items-end">
          <button
            type="submit"
            className="w-full bg-blue-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            在庫照会
          </button>
        </div>
      </div>
    </form>
  );
}
```

### kind=form (フォーム画面) — Server Action パターン

```tsx
// app/cart/confirm/page.tsx
import { redirect } from 'next/navigation';

async function confirmOrder(formData: FormData) {
  'use server';
  // Server Action: ProcessFlow httpRoute POST → API call
  const res = await fetch('/api/retail/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      shippingPostalCode: formData.get('shippingPostalCode'),
      shippingAddress: formData.get('shippingAddress'),
      paymentMethod: formData.get('paymentMethod'),
      note: formData.get('note'),
    }),
  });
  if (res.ok) {
    redirect('/order/complete');
  }
}

export default function CartConfirmPage() {
  return (
    <form action={confirmOrder} className="max-w-lg mx-auto p-6 space-y-4">
      {/* items[].direction=input を展開 */}
      <div>
        <label htmlFor="shippingPostalCode" className="block text-sm font-medium text-gray-700">
          配送先郵便番号 <span className="text-red-500">*</span>
        </label>
        <input
          type="text"
          name="shippingPostalCode"
          id="shippingPostalCode"
          required
          pattern="\d{7}"
          maxLength={7}
          placeholder="1600022"
          className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2"
        />
      </div>
      <button
        type="submit"
        className="w-full bg-blue-600 text-white px-4 py-3 rounded-md font-medium hover:bg-blue-700"
      >
        注文確定
      </button>
    </form>
  );
}
```

## 命名規則

| Screen JSON 値 | Next.js App Router パス |
|---|---|
| `path: "/products/search"` | `app/products/search/page.tsx` |
| `path: "/cart/confirm"` | `app/cart/confirm/page.tsx` |
| `path: "/order/complete"` | `app/order/complete/page.tsx` |
| コンポーネント名 | `components/<domain>/<PascalCase>.tsx` |

## Tailwind クラス vs Bootstrap 対応

| Bootstrap | Tailwind 相当 |
|---|---|
| `container` | `container mx-auto px-4` |
| `btn btn-primary` | `bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700` |
| `form-control` | `w-full rounded-md border border-gray-300 px-3 py-2` |
| `table table-striped` | `w-full table-auto border-collapse` + `odd:bg-gray-50` |
| `alert alert-success` | `bg-green-50 border border-green-400 text-green-800 rounded-md p-4` |
| `badge bg-warning` | `bg-yellow-100 text-yellow-800 text-xs font-medium px-2 py-0.5 rounded` |

---

## Layout Wrap モード (pageLayoutId 指定時)

`screen.purpose === "page"` かつ Screen JSON に `pageLayoutId` が指定されている場合、上記 kind 別パターンの JSX 本文を `<AppLayout>` コンポーネントでラップする。
既存の kind 別パターン (search / form / confirm / complete / dashboard 等) は変更なし。本モードは**追加**であって置換ではない。

### 適用条件

```
if (screen.purpose === "page" || screen.purpose === undefined)
  AND screen.pageLayoutId !== undefined:
  → Layout Wrap モード を適用する (kind 別テンプレートの return 文を <AppLayout> でラップ)
else:
  → 従来の kind 別パターン (Layout なし)
```

### 出力差分 (Layout なしモードとの比較)

| 箇所 | Layout なし | Layout Wrap モード |
|---|---|---|
| import 追加 | なし | `import AppLayout from '@/app/components/layouts/<pageLayoutId>';` を追加 |
| return 文 | `return (<Body />)` | `return (<AppLayout><Body /></AppLayout>)` にラップ |
| ファイル名 | `app/<path>/page.tsx` | 同じ (変更なし) |
| Body JSX 本文 | kind 別パターン通り | 同じ (変更なし) |

### 完成例 (kind=dashboard + Main Layout の Layout Wrap モード)

**対象**: kind=dashboard の page Screen で `pageLayoutId: "main-layout"` (Main Layout) を指定

```tsx
// app/dashboard/page.tsx (Server Component)
// Screen: <dashboardScreenId>
// kind: dashboard
// pageLayoutId: main-layout (Main Layout)
// → Layout Wrap モード: <AppLayout> でラップ

import AppLayout from '@/app/components/layouts/main-layout';
import { Suspense } from 'react';

/**
 * ダッシュボードページ。
 * Main Layout (PageLayout: main-layout) に wrapped。
 * ヘッダ・サイドバー・フッタは AppLayout が担当し、このページは main region のコンテンツのみ記述する。
 */
export default async function DashboardPage() {
  return (
    <AppLayout>
      {/* 以下は kind=dashboard の Body JSX (種別別パターン通り) */}
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-gray-800">ダッシュボード</h1>

        {/* items[].direction=output から展開したサマリーカード群 */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Suspense fallback={<div className="bg-white rounded-lg shadow p-6 animate-pulse h-24" />}>
            {/* 各 Metric コンポーネントは items[] から展開 */}
            <div className="bg-white rounded-lg shadow p-6">
              <p className="text-sm text-gray-500">本日の売上</p>
              <p className="text-3xl font-bold text-blue-600 mt-2">¥0</p>
            </div>
          </Suspense>
        </div>
      </div>
    </AppLayout>
  );
}
```

### AppLayout import パスの解決

```
import AppLayout from '@/app/components/layouts/<pageLayoutId>';
```

`<pageLayoutId>` は SKILL.md の Step 2.4 で解決した PageLayout の `id` フィールドの値をそのまま使う。
AppLayout コンポーネント自体の生成は LAYOUT.md テンプレートに委ねる (Step 3-D)。

pageLayoutId が見つからない場合 (SKILL.md Step 2.4 の警告ケース):
→ Layout Wrap モードをスキップし、Layout なしモードで page を生成する。
