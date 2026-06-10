import type { PageLayoutRegion } from "../../store/pageLayoutStore";

export type PageLayoutRegionRole = "header" | "sidebar" | "main" | "footer" | "custom";

export interface PageLayoutPatternRegion extends PageLayoutRegion {
  role: PageLayoutRegionRole;
  contentSlot?: boolean;
}

export interface PageLayoutPattern {
  id: string;
  label: string;
  description: string;
  previewClassName: string;
  regions: PageLayoutPatternRegion[];
}

export const PAGE_LAYOUT_PATTERNS: PageLayoutPattern[] = [
  {
    id: "header-main-footer",
    label: "ヘッダー + コンテンツ + フッター",
    description: "最も基本的な 3 段レイアウト。業務画面本文を中央に差し込みます。",
    previewClassName: "plm-preview-layout-hmf",
    regions: [
      { name: "header", role: "header", description: "グローバルヘッダ" },
      { name: "main", role: "main", description: "ページ本文 slot", contentSlot: true },
      { name: "footer", role: "footer", description: "グローバルフッタ" },
    ],
  },
  {
    id: "header-sidebar-main-footer",
    label: "ヘッダー + 左パネル + コンテンツ + フッター",
    description: "管理画面向けの標準レイアウト。左側にナビゲーション gadget を配置します。",
    previewClassName: "plm-preview-layout-hsmf",
    regions: [
      { name: "header", role: "header", description: "グローバルヘッダ" },
      { name: "sidebar", role: "sidebar", description: "左サイドバー" },
      { name: "main", role: "main", description: "ページ本文 slot", contentSlot: true },
      { name: "footer", role: "footer", description: "グローバルフッタ" },
    ],
  },
  {
    id: "top-nav-main",
    label: "トップナビ + コンテンツ",
    description: "ヘッダー内にナビゲーションを含める軽量レイアウト。",
    previewClassName: "plm-preview-layout-top-main",
    regions: [
      { name: "header", role: "header", description: "トップナビゲーション" },
      { name: "main", role: "main", description: "ページ本文 slot", contentSlot: true },
    ],
  },
  {
    id: "two-column-main",
    label: "左パネル + コンテンツ",
    description: "ヘッダーやフッターを持たない分割作業画面向けレイアウト。",
    previewClassName: "plm-preview-layout-two-column",
    regions: [
      { name: "sidebar", role: "sidebar", description: "左パネル" },
      { name: "main", role: "main", description: "ページ本文 slot", contentSlot: true },
    ],
  },
];

export const CUSTOM_PAGE_LAYOUT_PATTERN: PageLayoutPattern = {
  id: "custom",
  label: "カスタム",
  description: "既存の region 構成をそのまま使います。",
  previewClassName: "plm-preview-layout-custom",
  regions: [],
};

export function isContentSlotRegion(regionName: string): boolean {
  return regionName === "main" || regionName === "content";
}

export function getRegionRole(regionName: string): PageLayoutRegionRole {
  if (regionName === "header") return "header";
  if (regionName === "sidebar" || regionName === "leftPanel" || regionName === "left-panel") return "sidebar";
  if (isContentSlotRegion(regionName)) return "main";
  if (regionName === "footer") return "footer";
  return "custom";
}

export function getPatternById(patternId: string): PageLayoutPattern {
  return PAGE_LAYOUT_PATTERNS.find((pattern) => pattern.id === patternId) ?? CUSTOM_PAGE_LAYOUT_PATTERN;
}

export function inferPageLayoutPattern(regions: PageLayoutRegion[] | undefined): PageLayoutPattern {
  const names = new Set((regions ?? []).map((region) => region.name));
  const matched = PAGE_LAYOUT_PATTERNS.find((pattern) =>
    pattern.regions.length === names.size &&
    pattern.regions.every((region) => names.has(region.name)),
  );
  return matched ?? CUSTOM_PAGE_LAYOUT_PATTERN;
}

export function buildPatternRegions(pattern: PageLayoutPattern): PageLayoutRegion[] {
  return pattern.regions.map(({ name, description }) => ({ name, description }));
}
