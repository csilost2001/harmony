import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { collectHits, isEditorPath, type FindHit } from "../../utils/editorFind";
import { isImeComposing } from "../../utils/imeKeys";
import "../../styles/editorFind.css";

type HighlightCtor = new (...ranges: Range[]) => unknown;
type HighlightRegistry = { set(name: string, h: unknown): void; delete(name: string): void };

function highlightApi(): { Highlight: HighlightCtor; registry: HighlightRegistry } | null {
  const g = globalThis as unknown as { Highlight?: HighlightCtor; CSS?: { highlights?: HighlightRegistry } };
  return g.Highlight && g.CSS?.highlights ? { Highlight: g.Highlight, registry: g.CSS.highlights } : null;
}

function clearMarks() {
  document.querySelectorAll("[data-find-hit]").forEach((el) => { el.removeAttribute("data-find-hit"); el.removeAttribute("data-find-current"); });
  const api = highlightApi();
  api?.registry.delete("hm-find");
  api?.registry.delete("hm-find-current");
}

/**
 * 編集画面の中の検索 (Ctrl+F)。ブラウザの検索では見つからない入力欄の値も探す。
 * 編集画面 (isEditorPath) でだけ Ctrl+F を受ける (一覧などは、ブラウザの検索のまま)。
 * Enter = 次、Shift+Enter = 前、Esc = 閉じる (見つけた入力欄にフォーカスを移す)。
 */
export function EditorFind() {
  const { pathname } = useLocation();
  const editor = isEditorPath(pathname);
  // 開いた画面の経路を覚える (別の画面へ移ったら、閉じた扱い)
  const [openPath, setOpenPath] = useState<string | null>(null);
  const open = openPath === pathname;
  const setOpen = useCallback((v: boolean) => setOpenPath(v ? pathname : null), [pathname]);
  const [query, setQuery] = useState("");
  const [count, setCount] = useState(0);
  const [index, setIndex] = useState(0);
  const hitsRef = useRef<FindHit[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const close = useCallback((focusHit: boolean) => {
    const hit = hitsRef.current[index];
    clearMarks();
    hitsRef.current = [];
    setOpen(false);
    setCount(0);
    if (focusHit && hit?.kind === "field") hit.el.focus();
  }, [index, setOpen]);

  // Ctrl+F / ⌘F で開く (編集画面のとき)。すでに開いていれば、検索欄を選び直す
  useEffect(() => {
    if (!editor) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && (e.key === "f" || e.key === "F")) {
        e.preventDefault();
        setOpen(true);
        setTimeout(() => { inputRef.current?.focus(); inputRef.current?.select(); }, 0);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [editor, setOpen]);

  // 画面を移ったら閉じる
  useEffect(() => () => { clearMarks(); }, [pathname]);

  const show = useCallback((hits: FindHit[], at: number) => {
    clearMarks();
    const api = highlightApi();
    const ranges: Range[] = [];
    hits.forEach((h, i) => {
      if (h.kind === "field") h.el.setAttribute("data-find-hit", i === at ? "current" : "1");
      else ranges.push(h.range);
    });
    const cur = hits[at];
    if (cur?.kind === "field") cur.el.setAttribute("data-find-current", "1");
    if (api) {
      if (ranges.length > 0) api.registry.set("hm-find", new api.Highlight(...ranges));
      if (cur?.kind === "text") api.registry.set("hm-find-current", new api.Highlight(cur.range));
    }
    if (cur) (cur.kind === "field" ? cur.el : cur.scrollTo).scrollIntoView?.({ block: "center", inline: "nearest" });
  }, []);

  const search = useCallback((q: string, keepIndex = false) => {
    const root = document.getElementById("app-main") ?? document.body;
    const hits = collectHits(root, q);
    hitsRef.current = hits;
    const at = hits.length === 0 ? 0 : keepIndex ? Math.min(index, hits.length - 1) : 0;
    setCount(hits.length);
    setIndex(at);
    show(hits, at);
  }, [index, show]);

  // 入力のたびに探し直す (打ち終わるのを少し待つ)
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => search(query), 120);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, open]);

  const move = (dir: 1 | -1) => {
    // 画面が変わっているかもしれないので、移る前に探し直す
    const root = document.getElementById("app-main") ?? document.body;
    const hits = collectHits(root, query);
    hitsRef.current = hits;
    if (hits.length === 0) { setCount(0); show(hits, 0); return; }
    const at = (index + dir + hits.length) % hits.length;
    setCount(hits.length);
    setIndex(at);
    show(hits, at);
  };

  if (!editor || !open) return null;
  return (
    <div className="editor-find" role="search" aria-label="画面内の検索" data-find-ignore data-testid="editor-find">
      <i className="bi bi-search" aria-hidden="true" />
      <input
        ref={inputRef}
        type="text"
        className="editor-find-input"
        placeholder="この画面を検索 (入力欄の中も探します)"
        aria-label="検索語"
        value={query}
        autoFocus
        data-testid="editor-find-input"
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (isImeComposing(e)) return;
          if (e.key === "Enter" && !isImeComposing(e)) { e.preventDefault(); move(e.shiftKey ? -1 : 1); }
          else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(true); }
        }}
      />
      <span className="editor-find-count" aria-live="polite" data-testid="editor-find-count">
        {query.trim() === "" ? "" : count === 0 ? "見つかりません" : `${index + 1} / ${count}${count >= 500 ? "+" : ""}`}
      </span>
      <button type="button" className="editor-find-btn" aria-label="前を探す" title="前 (Shift+Enter)" disabled={count === 0} onClick={() => move(-1)}><i className="bi bi-chevron-up" /></button>
      <button type="button" className="editor-find-btn" aria-label="次を探す" title="次 (Enter)" disabled={count === 0} onClick={() => move(1)}><i className="bi bi-chevron-down" /></button>
      <button type="button" className="editor-find-btn" aria-label="検索を閉じる" title="閉じる (Esc)" onClick={() => close(false)}><i className="bi bi-x-lg" /></button>
    </div>
  );
}
