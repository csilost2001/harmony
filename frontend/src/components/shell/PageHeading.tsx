/**
 * 画面の見出し (h1) の補い (UI 改善提案 続編 第 10 弾 #186)。スクリーンリーダーで、画面の見出しから画面を巡れるよう、画面ごとに h1 を 1 つにする。
 * 画面が自分で h1 を持つときは、補わない (隠す)。持たない画面だけ、開いているタブの名前を、見えない h1 として出す。
 * 画面は遅れて描かれるので、本文の変化を見張って、そのたびに有無を確かめる (React の状態は使わず、DOM の hidden だけを切り替える)。
 */
import { useEffect, useRef } from "react";
import { useActiveTab } from "../../hooks/useActiveTab";

export function PageHeading() {
  const tab = useActiveTab();
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const el = ref.current;
    const main = document.getElementById("app-main");
    if (!el || !main) return;
    // 設計の中身 (画面の見本・帳票の紙面・設計書の本文) の見出しは、画面の見出しではない
    const CONTENT = ".sld-paper, .pv-root, .rp-paper, .lv-paper, .hd-doc";
    // 見えている h1 (開いていないタブの中の、隠れた h1 は数えない) があれば、補わない
    // 画面の見出し (h1 と、role=heading・aria-level=1 の見出し。エディタのヘッダーなど。本文の外にある場合もあるので、文書全体から探す) が見えていれば、補わない
    const sync = () => { el.hidden = [...document.querySelectorAll('h1:not(.page-auto-h1), [role="heading"][aria-level="1"]')].some((h) => !h.closest(CONTENT) && (h as HTMLElement).getClientRects().length > 0); };
    sync();
    // 本文の変化は多い (描画のたび) ので、続けて起きた分は、まとめて 1 回だけ確かめる
    let timer: ReturnType<typeof setTimeout> | undefined;
    const later = () => { if (timer === undefined) timer = setTimeout(() => { timer = undefined; sync(); }, 150); };
    const mo = new MutationObserver(later);
    // タブの切り替え (display の変更) も見張る。画面の見出しは、本文の外 (エディタのヘッダー) にもあるので、文書全体を見る
    mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["style", "hidden"] });
    return () => { mo.disconnect(); clearTimeout(timer); };
  }, []);
  return <h1 ref={ref} className="an-sr page-auto-h1" data-testid="page-auto-h1">{tab?.label ?? "Harmony"}</h1>;
}
