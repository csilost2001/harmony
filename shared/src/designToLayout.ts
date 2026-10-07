/**
 * 旧形式の画面デザイン (GrapesJS / Puck が出力した HTML) を業務部品の木 (ScreenLayout) に
 * 変換する。決定的なヒューリスティック変換で、業務部品に当てはまらない部分は html 部品として
 * 原文のまま残す (情報を落とさない)。
 *
 * HTML パーサには依存しない。呼び出し側 (backend: htmlparser2 / frontend: DOMParser) が
 * SimpleNode 木に変換して渡す。
 *
 * 仕様: docs/spec/screen-layout.md §5
 */
import type { LayoutNode, LayoutNodeProps, ScreenLayout } from "./screenLayout.js";
import { nextNodeId } from "./screenLayout.js";

export type SimpleNode =
  | { kind: "el"; tag: string; attrs: Record<string, string>; children: SimpleNode[]; outerHTML: string }
  | { kind: "text"; text: string };

type SimpleEl = Extract<SimpleNode, { kind: "el" }>;

/** 変換で新たに作る画面項目 (screen-item.v3 ScreenItem のサブセット) */
export interface ConvertedItem {
  id: string;
  label: string;
  type: unknown;
  direction?: "in" | "out" | "both";
  required?: boolean;
  maxLength?: number;
  min?: number;
  max?: number;
  pattern?: string;
  placeholder?: string;
  options?: Array<{ value: string; label: string }>;
  presentation?: { kind: "table"; columns: Array<{ id: string; label: string; path: string; type: string }> };
}

export interface ExistingItemLike {
  id: string;
  label?: string;
  type?: unknown;
  presentation?: { kind?: string };
}

export interface DesignToLayoutResult {
  layout: ScreenLayout;
  newItems: ConvertedItem[];
  stats: { nodes: number; fields: number; tables: number; buttons: number; html: number };
}

const IDENT = /^[a-z][a-zA-Z0-9]*$/;
const GRAPES_AUTO_ID = /^i[a-z0-9]{3,6}$/;
const SHELL_CLASS = /\b(app-header|app-sidebar|app-footer|sidebar|navbar|site-header|site-footer|global-header|global-footer)\b/;
const SKIP_TAGS = new Set(["script", "style", "noscript", "template", "head", "meta", "link", "title"]);
const INLINE_TAGS = new Set(["span", "strong", "b", "em", "i", "small", "code", "mark", "u", "s", "sub", "sup", "abbr", "time", "label", "br"]);

/** 日本語のボタン・リンク文言から ID の語幹を作るための語彙 */
const JA_WORDS: Array<[RegExp, string]> = [
  [/クリア|リセット/, "clear"], [/検索/, "search"], [/照会/, "inquiry"], [/登録/, "register"], [/更新/, "update"],
  [/削除/, "delete"], [/戻る/, "back"], [/キャンセル|取消/, "cancel"], [/保存/, "save"], [/追加/, "add"],
  [/確定/, "confirm"], [/確認/, "check"], [/送信/, "submit"], [/次へ/, "next"], [/前へ/, "prev"], [/編集/, "edit"],
  [/新規/, "new"], [/印刷/, "print"], [/ログアウト/, "logout"], [/ログイン/, "login"], [/閉じる/, "close"],
  [/選択/, "select"], [/詳細/, "detail"], [/出力|ダウンロード/, "export"], [/取込|アップロード/, "import"],
  [/カート/, "cart"], [/注文/, "order"], [/一覧/, "list"], [/ホーム|トップ/, "home"], [/配送/, "shipment"], [/在庫/, "inventory"],
];
function jaStem(label: string): string {
  const words = JA_WORDS.filter(([re]) => re.test(label)).map(([, w]) => w);
  return words.length ? words.slice(0, 2).map((w, i) => (i === 0 ? w : w.charAt(0).toUpperCase() + w.slice(1))).join("") : "";
}

const cls = (el: SimpleEl): string => el.attrs.class ?? "";
const hasCls = (el: SimpleEl, re: RegExp): boolean => re.test(cls(el));
const els = (n: SimpleEl): SimpleEl[] => n.children.filter((c): c is SimpleEl => c.kind === "el" && !SKIP_TAGS.has(c.tag));

function text(n: SimpleNode): string {
  if (n.kind === "text") return n.text;
  if (SKIP_TAGS.has(n.tag)) return "";
  // アイコン (bootstrap-icons) は文字を持たない
  if (n.tag === "i" && /\bbi\b|\bbi-/.test(cls(n))) return "";
  return n.children.map(text).join("");
}
const clean = (s: string): string => s.replace(/\s+/g, " ").trim();

/** 任意の文字列を lowerCamelCase の Identifier にする */
export function toIdentifier(raw: string, fallback = "item"): string {
  const parts = raw.replace(/([a-z0-9])([A-Z])/g, "$1 $2").split(/[^A-Za-z0-9]+/).filter(Boolean);
  if (parts.length === 0) return fallback;
  const id = parts.map((p, i) => (i === 0 ? p.toLowerCase() : p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())).join("");
  return /^[a-z]/.test(id) ? id.slice(0, 64) : fallback;
}

function find(el: SimpleEl, pred: (e: SimpleEl) => boolean): SimpleEl | null {
  for (const c of els(el)) {
    if (pred(c)) return c;
    const hit = find(c, pred);
    if (hit) return hit;
  }
  return null;
}
function findAll(el: SimpleEl, pred: (e: SimpleEl) => boolean, out: SimpleEl[] = []): SimpleEl[] {
  for (const c of els(el)) {
    if (pred(c)) out.push(c);
    findAll(c, pred, out);
  }
  return out;
}

const isFormControl = (e: SimpleEl): boolean =>
  (e.tag === "input" && !["hidden", "submit", "button", "reset", "image"].includes((e.attrs.type ?? "text").toLowerCase())) ||
  e.tag === "select" || e.tag === "textarea";
const isButton = (e: SimpleEl): boolean =>
  e.tag === "button" || (e.tag === "input" && ["submit", "button", "reset"].includes((e.attrs.type ?? "").toLowerCase())) ||
  (e.tag === "a" && hasCls(e, /\bbtn\b/));

export interface DesignToLayoutOptions {
  /** 画面 path → 画面 id。リンク・ボタンの href を遷移先画面 (screenRef) に変換するのに使う */
  screenIdByPath?: Record<string, string>;
  /** ガジェット画面 (ヘッダ / サイドバー等そのもの) では枠要素を除外せず変換する */
  keepShell?: boolean;
  /** 画面 id。新しく作る一覧項目の ID の語幹に使う (例: customer-master → customerMasterRows) */
  screenId?: string;
}

export function designToLayout(roots: SimpleNode[], existingItems: readonly ExistingItemLike[], opts: DesignToLayoutOptions = {}): DesignToLayoutResult {
  const screenRefOf = (href: string | undefined): string | undefined => {
    if (!href || !opts.screenIdByPath) return undefined;
    const path = href.split(/[?#]/)[0];
    return opts.screenIdByPath[path];
  };
  const items = new Map(existingItems.map((i) => [i.id, i]));
  const newItems: ConvertedItem[] = [];
  const usedItems = new Set<string>();
  const stats = { nodes: 0, fields: 0, tables: 0, buttons: 0, html: 0 };
  const allNodes: LayoutNode[] = []; // ID 採番用 (平坦)
  const labelFor = new Map<string, string>();

  const rootEl: SimpleEl = { kind: "el", tag: "root", attrs: {}, children: roots, outerHTML: "" };
  const parentOf = new Map<SimpleNode, SimpleEl>();
  const indexParents = (p: SimpleEl): void => { for (const c of p.children) { parentOf.set(c, p); if (c.kind === "el") indexParents(c); } };
  indexParents(rootEl);
  /** 表示項目のラベル候補: aria-label / title / 直前の短い文字列 (「照会結果:」等) */
  const contextLabel = (e: SimpleEl): string => {
    if (e.attrs["aria-label"]) return e.attrs["aria-label"];
    if (e.attrs.title) return e.attrs.title;
    const p = parentOf.get(e);
    if (!p) return "";
    const idx = p.children.indexOf(e);
    for (let i = idx - 1; i >= 0; i--) {
      const t = clean(text(p.children[i])).replace(/[:：]\s*$/, "");
      if (t) return t.length <= 20 ? t : "";
    }
    return "";
  };
  /** 直前に viewer 差し込み位置として置いた一覧項目 (直後のダミー表はその見本) */
  let pendingPreviewTable: string | null = null;
  for (const l of findAll(rootEl, (e) => e.tag === "label" && !!e.attrs.for)) labelFor.set(l.attrs.for, clean(text(l)));

  const mk = (type: LayoutNode["type"], base: string, extra: Partial<LayoutNode> = {}): LayoutNode => {
    const id = nextNodeId(allNodes, base);
    const node: LayoutNode = { id, type, ...extra };
    allNodes.push(node);
    stats.nodes++;
    return node;
  };

  const itemIdOf = (e: SimpleEl): string | null => {
    for (const cand of [e.attrs["data-item-id"], e.attrs.name, e.attrs.id]) {
      if (!cand || GRAPES_AUTO_ID.test(cand)) continue;
      if (items.has(cand)) return cand;
      if (cand === e.attrs["data-item-id"] || cand === e.attrs.name) return IDENT.test(cand) ? cand : toIdentifier(cand);
    }
    return null;
  };

  /** 項目 ID を持たない要素を、表示名が同じ未使用の既存項目に結び付ける */
  const itemByLabel = (label: string): string | null => {
    const norm = (v: string) => v.replace(/\s+/g, "").replace(/[*＊:：]$/, "");
    const key = norm(label);
    if (!key) return null;
    const hit = [...items.values()].find((i) => !usedItems.has(i.id) && i.label && norm(i.label) === key);
    return hit ? hit.id : null;
  };

  const ensureItem = (id: string, make: () => ConvertedItem): string => {
    if (!items.has(id) && !newItems.some((n) => n.id === id)) {
      const it = make();
      newItems.push(it);
    }
    usedItems.add(id);
    return id;
  };

  const fieldFromControl = (ctl: SimpleEl, ctx: SimpleEl | null): LayoutNode | null => {
    const t = (ctl.attrs.type ?? "text").toLowerCase();
    const rawLabel = labelFor.get(ctl.attrs.id ?? "") || (ctx ? clean(text(find(ctx, (e) => e.tag === "label") ?? ctx)) : "") || ctl.attrs["aria-label"] || ctl.attrs.placeholder || "";
    const bound = itemIdOf(ctl);
    const id = (bound && items.has(bound) ? bound : null) ?? itemByLabel(rawLabel) ?? bound;
    if (!id) return null;
    const label = rawLabel || id;
    ensureItem(id, () => {
      const it: ConvertedItem = { id, label: label.replace(/\s*\*\s*$/, ""), type: "string", direction: "in" };
      if (ctl.tag === "select") {
        it.options = findAll(ctl, (e) => e.tag === "option").filter((o) => (o.attrs.value ?? "") !== "").map((o) => ({ value: o.attrs.value ?? clean(text(o)), label: clean(text(o)) || o.attrs.value }));
      } else if (t === "number" || t === "range") it.type = /\./.test(ctl.attrs.step ?? "") ? "number" : "integer";
      else if (t === "date") it.type = "date";
      else if (t === "datetime-local") it.type = "datetime";
      else if (t === "checkbox") it.type = "boolean";
      if ("required" in ctl.attrs) it.required = true;
      if (ctl.attrs.maxlength && /^\d+$/.test(ctl.attrs.maxlength)) it.maxLength = Number(ctl.attrs.maxlength);
      if (ctl.attrs.min && /^-?\d+$/.test(ctl.attrs.min)) it.min = Number(ctl.attrs.min);
      if (ctl.attrs.max && /^-?\d+$/.test(ctl.attrs.max)) it.max = Number(ctl.attrs.max);
      if (ctl.attrs.placeholder) it.placeholder = ctl.attrs.placeholder;
      return it;
    });
    stats.fields++;
    return mk("field", id, { itemRef: id });
  };

  const tableNode = (tbl: SimpleEl): LayoutNode => {
    const bound = [tbl, ...findAll(tbl, () => true)].map((e) => e.attrs["data-item-id"]).find((v) => v && !GRAPES_AUTO_ID.test(v));
    const headers = findAll(tbl, (e) => e.tag === "th").map((th) => clean(text(th))).filter(Boolean);
    let id = bound && (items.has(bound) || IDENT.test(bound)) ? bound : null;
    if (!id) {
      // 未使用の table/list presentation を持つ既存項目があれば割り当てる
      id = [...items.values()].find((i) => !usedItems.has(i.id) && (i.presentation?.kind === "table" || i.presentation?.kind === "list"))?.id ?? null;
    }
    if (!id) id = nextItemId(toIdentifier(tbl.attrs.id ?? "", "") || (opts.screenId ? `${toIdentifier(opts.screenId, "list")}Rows` : "rows"));
    const caption = clean(text(find(tbl, (e) => e.tag === "caption") ?? { kind: "text", text: "" }));
    const pageTitle = clean(text(find(rootEl, (e) => e.tag === "h1" || hasCls(e, /\bpage-title\b/)) ?? { kind: "text", text: "" }));
    ensureItem(id, () => ({
      id,
      label: caption || (pageTitle ? `${pageTitle.replace(/\s*[/／].*$/, "")} 一覧` : "一覧"),
      type: { kind: "array", itemType: "json" },
      direction: "out",
      presentation: {
        kind: "table",
        columns: headers.map((h, i) => ({ id: `col${i + 1}`, label: h, path: `col${i + 1}`, type: "string" })),
      },
    }));
    stats.tables++;
    return mk("table", id, { itemRef: id, ...(caption ? { props: { title: caption } } : {}) });
  };

  const nextItemId = (base: string): string => {
    let id = base, n = 2;
    while (items.has(id) || newItems.some((x) => x.id === id) || usedItems.has(id)) id = `${base}${n++}`;
    return id;
  };

  const buttonNode = (b: SimpleEl): LayoutNode => {
    const label = clean(text(b)) || b.attrs.value || b.attrs["aria-label"] || b.attrs.title || "ボタン";
    const c = cls(b);
    const variant: LayoutNodeProps["variant"] = /btn-(outline-)?danger/.test(c) ? "danger"
      : /btn-primary|btn-success/.test(c) && !/outline/.test(c) ? "primary"
      : b.tag === "a" && /btn-link/.test(c) ? "link" : "secondary";
    const bound = b.attrs["data-item-id"] ?? (b.attrs.id && items.has(b.attrs.id) ? b.attrs.id : undefined) ?? itemByLabel(label) ?? undefined;
    stats.buttons++;
    const screenRef = b.tag === "a" ? screenRefOf(b.attrs.href) : undefined;
    if (bound && !GRAPES_AUTO_ID.test(bound) && (items.has(bound) || IDENT.test(bound))) {
      ensureItem(bound, () => ({ id: bound, label, type: "string", direction: "in" }));
      return mk("button", bound, { itemRef: bound, props: { label, variant, ...(screenRef ? { screenRef } : {}) } });
    }
    const ascii = toIdentifier(label, "");
    const stem = ascii || jaStem(label);
    return mk("button", stem ? `${stem}Button` : "button", { props: { label, variant, ...(screenRef ? { screenRef } : {}) } });
  };

  const htmlNode = (e: SimpleEl): LayoutNode => {
    stats.html++;
    return mk("html", "html", { props: { html: e.outerHTML } });
  };

  /** ボタン / リンクが連続する箇所を button-bar にまとめる */
  const groupButtons = (nodes: LayoutNode[], align?: LayoutNodeProps["align"]): LayoutNode[] => {
    const out: LayoutNode[] = [];
    let run: LayoutNode[] = [];
    const flush = () => {
      if (run.length >= 2 || (run.length === 1 && align)) out.push(mk("button-bar", "buttons", { children: run, ...(align ? { props: { align } } : {}) }));
      else out.push(...run);
      run = [];
    };
    for (const n of nodes) {
      if (n.type === "button" || n.type === "link") run.push(n);
      else { flush(); out.push(n); }
    }
    flush();
    return out;
  };

  const alignOf = (e: SimpleEl): LayoutNodeProps["align"] | undefined =>
    hasCls(e, /\b(text-end|justify-content-end|justify-end|text-right|ms-auto)\b/) ? "right"
      : hasCls(e, /\b(justify-content-between|justify-between)\b/) ? "between"
        : hasCls(e, /\b(text-center|justify-content-center|justify-center)\b/) ? "center" : undefined;

  /** 1 要素を部品列に変換する */
  const convert = (n: SimpleNode): LayoutNode[] => {
    if (n.kind === "text") {
      const t = clean(n.text);
      return t ? [mk("text", "text", { props: { text: t } })] : [];
    }
    const e = n;
    if (SKIP_TAGS.has(e.tag)) return [];
    if (!opts.keepShell && (e.tag === "header" || e.tag === "aside" || e.tag === "footer" || hasCls(e, SHELL_CLASS))) {
      // アプリ共通の枠 (ヘッダ / サイドバー / フッタ) はページレイアウト側の責務なので除外
      if (e.tag !== "header" || hasCls(e, SHELL_CLASS)) return [];
    }
    if (e.tag === "nav" && /breadcrumb/.test(cls(e) + (e.attrs["aria-label"] ?? ""))) return [];
    if (/breadcrumb/.test(cls(e))) return [];

    const dataId = e.attrs["data-item-id"];
    if (dataId && !GRAPES_AUTO_ID.test(dataId) && !isFormControl(e) && !isButton(e) && e.tag !== "table" && e.tag !== "tbody") {
      // 表示項目 (出力) や viewer の差し込み位置
      const it = items.get(dataId);
      if (it?.presentation?.kind === "table" || it?.presentation?.kind === "list") {
        usedItems.add(dataId); stats.tables++;
        if (els(e).length === 0) pendingPreviewTable = dataId;
        return [mk("table", dataId, { itemRef: dataId })];
      }
      if (!usedItems.has(dataId) || it) {
        ensureItem(IDENT.test(dataId) ? dataId : toIdentifier(dataId), () => ({ id: IDENT.test(dataId) ? dataId : toIdentifier(dataId), label: contextLabel(e) || dataId, type: "string", direction: "out" }));
        stats.fields++;
        const id = IDENT.test(dataId) ? dataId : toIdentifier(dataId);
        return [mk("field", id, { itemRef: id })];
      }
    }

    if (/^h[1-6]$/.test(e.tag) || hasCls(e, /\bpage-title\b/)) {
      const t = clean(text(e));
      if (!t) return [];
      const lv = Math.min(3, Math.max(1, Number(e.tag.slice(1)) || 1)) as 1 | 2 | 3;
      return [mk("heading", "heading", { props: { text: t, level: lv } })];
    }
    if (e.tag === "hr") return [mk("divider", "divider")];
    if (e.tag === "img") return [mk("image", "image", { props: { ...(e.attrs.src ? { src: e.attrs.src } : {}), ...(e.attrs.alt ? { alt: e.attrs.alt } : {}) } })];
    if (e.tag === "table") {
      const boundIds = [e, ...findAll(e, () => true)].map((x) => x.attrs["data-item-id"]).filter((v): v is string => !!v);
      if (pendingPreviewTable && !boundIds.some((b) => items.has(b))) {
        // viewer 差し込み位置 (空 div) の直後にある見本表は、その一覧項目の見本なので部品にしない
        pendingPreviewTable = null;
        return [];
      }
      const hasHeader = findAll(e, (x) => x.tag === "th").length > 0;
      if (!hasHeader && !boundIds.some((b) => items.has(b))) return [htmlNode(e)];
      return [tableNode(e)];
    }
    if (isButton(e)) return [buttonNode(e)];
    if (isFormControl(e)) {
      const f = fieldFromControl(e, null);
      return f ? [f] : [];
    }
    if (e.tag === "a") {
      const t = clean(text(e));
      if (!t) return [];
      const screenRef = screenRefOf(e.attrs.href);
      const stem = toIdentifier(t, "") || jaStem(t);
      return [mk("link", stem ? `${stem}Link` : "link", { props: { label: t, ...(screenRef ? { screenRef } : {}) } })];
    }
    if (hasCls(e, /\balert\b/) || e.attrs.role === "alert" || /message-area|messageArea/.test(e.attrs.id ?? "")) {
      return [mk("message-area", "messageArea")];
    }
    if (e.tag === "p" || e.tag === "small" || (e.tag === "div" && els(e).every((c) => INLINE_TAGS.has(c.tag)) && clean(text(e)))) {
      const t = clean(text(e));
      if (!t) return [];
      const tone: LayoutNodeProps["tone"] = hasCls(e, /\b(text-muted|small|form-text|text-gray|text-slate)/) || e.tag === "small" ? "muted" : "normal";
      return [mk("text", "text", { props: { text: t, ...(tone !== "normal" ? { tone } : {}) } })];
    }
    if (e.tag === "ul" || e.tag === "ol" || e.tag === "dl" || e.tag === "svg" || e.tag === "canvas" || e.tag === "iframe") {
      return [htmlNode(e)];
    }

    // 入力欄を 1 つだけ含むグループ (label + input + 補足) は field 1 つにまとめる
    const controls = findAll(e, isFormControl);
    if (controls.length === 1 && !find(e, (x) => x.tag === "table") && findAll(e, isButton).length === 0 && e.tag !== "form") {
      const f = fieldFromControl(controls[0], e);
      return f ? [f] : [];
    }

    const kids = (): LayoutNode[] => groupButtons(e.children.flatMap(convert), alignOf(e));

    if (e.tag === "form" || hasCls(e, /\b(search-area|search-panel|search-form)\b/)) {
      const isSearch = /search/i.test(cls(e) + (e.attrs.id ?? "")) || findAll(e, isButton).some((b) => /検索|照会|search/i.test(text(b)));
      let flatCols = 0;
      const children = kids().flatMap((c) => {
        if (c.type === "form" || c.type === "search-panel") return c.children ?? [];
        if (c.type === "columns" && (c.children ?? []).every((col) => (col.children ?? []).length <= 1)) {
          flatCols = Math.max(flatCols, (c.children ?? []).length);
          return (c.children ?? []).flatMap((col) => col.children ?? []);
        }
        return [c];
      });
      if (children.length === 0) return [];
      const fieldCount = children.filter((c) => c.type === "field").length;
      const guessed = findAll(e, (x) => /\bcol-(md|lg|sm)-(6|4|3)\b|\bgrid-cols-[234]\b|\bsearch-field\b/.test(cls(x))).length >= 2 ? (fieldCount >= 3 ? 3 : 2) : 1;
      const cols = Math.min(4, Math.max(1, flatCols || guessed)) as 1 | 2 | 3 | 4;
      return [mk(isSearch ? "search-panel" : "form", isSearch ? "searchPanel" : (e.attrs.id ? toIdentifier(e.attrs.id, "form") : "form"), {
        ...(cols > 1 ? { props: { columns: cols } } : {}),
        children: children.filter((c) => c.type !== "form"),
      })];
    }

    if (e.tag === "section" || e.tag === "fieldset" || hasCls(e, /(^|\s)(card|panel|box)(\s|$)/)) {
      const header = els(e).find((c) => hasCls(c, /\b(card-header|panel-heading|section-header)\b/) || c.tag === "legend" || /^h[2-6]$/.test(c.tag));
      const title = header ? clean(text(header)) : "";
      const bodyKids = groupButtons(e.children.filter((c) => c !== header).flatMap(convert), alignOf(e));
      if (bodyKids.length === 0 && !title) return [];
      // 中身が form / search-panel 1 つだけなら区画で包まず表題を移す
      if (bodyKids.length === 1 && (bodyKids[0].type === "form" || bodyKids[0].type === "search-panel" || bodyKids[0].type === "table")) {
        if (title) bodyKids[0].props = { ...bodyKids[0].props, title };
        return bodyKids;
      }
      return [mk("section", title ? toIdentifier(title, "section") : "section", {
        props: { ...(title ? { title } : {}), variant: hasCls(e, /(^|\s)card(\s|$)/) ? "card" : "panel" },
        children: bodyKids,
      })];
    }

    // 段組 (.row > .col-*)
    const colKids = els(e).filter((c) => /\bcol(-[a-z]+)?(-\d+)?\b/.test(cls(c)));
    if (hasCls(e, /\brow\b/) && colKids.length >= 2 && colKids.length === els(e).length) {
      const cols = colKids.map((c) => {
        const m = cls(c).match(/\bcol-(?:[a-z]+-)?(\d+)\b/);
        const span = m ? Number(m[1]) : Math.floor(12 / colKids.length);
        return mk("column", "column", { props: { span }, children: groupButtons(convert(c), alignOf(c)) });
      }).filter((c) => c.children && c.children.length > 0);
      if (cols.length >= 2) return [mk("columns", "columns", { children: cols })];
      return cols.flatMap((c) => c.children ?? []);
    }

    // それ以外の入れ物は中身だけ取り出す
    const flat = kids();
    return flat;
  };

  // <main> があればその中身だけを対象にする (アプリ共通の枠を除く)
  const main = opts.keepShell ? null : find(rootEl, (e) => e.tag === "main" || hasCls(e, /\b(app-main|main-content)\b/));
  const nodes = groupButtons((main ? main.children : roots).flatMap(convert));
  return { layout: { version: 1, nodes }, newItems, stats };
}
