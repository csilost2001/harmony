import type { Config } from "tailwindcss";

export default {
  content: [
    "./src/styles/themes/theme-tailwind.css",
    // theme-tailwind.css 内の @apply で使う class を全 scan
    // sample HTML 内 (design.json の components 文字列) に直書きされた Tailwind
    // utility class も canvas iframe で効くよう JIT scan 対象に含める (#793 子 7 で発見)。
    // glob は ../examples/ 配下の任意の階層の *.design.json を再帰スキャンするため、
    // screens/*.design.json は包含済 (重複追加しない)
    "../examples/**/*.design.json",
    // Puck primitive ファイルも scan 対象 (静的完全 class 名を含む)
    "./src/puck/**/*.{ts,tsx}",
  ],
  theme: { extend: {} },
  plugins: [],
  // Puck primitive の共通レイアウト props マッピングで使う全 utility class を safelist に列挙。
  // tailwind.ts の mapper で完全 class 名を static に出力しているため、
  // content scan で検出できるはずだが、Puck の動的レンダリング経由での取りこぼしを
  // 防ぐため明示的に safelist にも追加する (§ 4.4 / § 11.1 の "両方やる" 推奨に従う)。
  safelist: [
    // flex direction (Container primitive)
    "flex", "flex-row", "flex-col",
    // align
    "text-left", "text-center", "text-right",
    // padding (全方向)
    "p-0", "p-2", "p-4", "p-6", "p-8",
    // paddingX
    "px-0", "px-2", "px-4", "px-6", "px-8",
    // paddingY
    "py-0", "py-2", "py-4", "py-6", "py-8",
    // margin (全方向)
    "m-0", "m-2", "m-4", "m-6", "m-8",
    // marginBottom
    "mb-0", "mb-2", "mb-4", "mb-6", "mb-8",
    // marginTop
    "mt-0", "mt-2", "mt-4", "mt-6", "mt-8",
    // gap
    "gap-0", "gap-2", "gap-4", "gap-6",
    // colorAccent
    "text-gray-900", "text-blue-600", "text-purple-600",
    "text-gray-500", "text-green-600", "text-yellow-600", "text-red-600",
    // bgAccent
    "bg-white", "bg-gray-50", "bg-blue-50",
    "bg-green-50", "bg-yellow-50", "bg-red-50",
    // border
    "border", "border-2",
    // rounded
    "rounded-none", "rounded-sm", "rounded-md", "rounded-lg", "rounded-full",
    // shadow
    "shadow-sm", "shadow-md", "shadow-lg",
  ],
} satisfies Config;
