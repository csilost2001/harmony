/**
 * スキップリンク (UI 改善提案 続編 第 10 弾 #181)。Tab の最初のフォーカスで「本文へ移動」などが現れ、ヘッダーとタブの長い操作列を飛ばせる。
 * Enter で、その領域へフォーカスを移す (領域は、フォーカスを受けるよう tabindex=-1 を付ける)。マウスでは、フォーカスされるまで見えない。
 */
import { useCallback } from "react";
import { focusRegion } from "../../utils/focusRegion";

const TARGETS: Array<{ id: string; label: string; selector: string }> = [
  { id: "main", label: "本文へ移動", selector: "#app-main" },
  { id: "tabs", label: "タブへ移動", selector: 'nav[aria-label="開いているタブ"]' },
  { id: "header", label: "ヘッダーへ移動", selector: "header.common-header" },
];

export function SkipLinks() {
  const go = useCallback((e: React.MouseEvent | React.KeyboardEvent, selector: string) => {
    e.preventDefault();
    focusRegion(selector);
  }, []);
  return (
    <div className="skip-links" data-testid="skip-links">
      {TARGETS.map((t) => (
        <a key={t.id} className="skip-link" href={`#${t.id}`} onClick={(e) => go(e, t.selector)} data-testid={`skip-link-${t.id}`}>{t.label}</a>
      ))}
    </div>
  );
}
