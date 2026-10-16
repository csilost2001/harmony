/**
 * パンくず: タブバーの下に 1 行、「区分 › 一覧 › いま開いている設計」を出す (UI 改善提案 続編 第 6 弾 #108)。
 * 一覧の部分を押すと、一覧のタブへ移る (無ければ開く)。高さは BREADCRUMB_HEIGHT で、AppShell が --tabbar-h に足す。
 */
import { useEffect, useState } from "react";
import { getActiveTabId, getTabs, makeTabId, openTab, subscribe } from "../../store/tabStore";
import { BREADCRUMB_HEIGHT, breadcrumbFor } from "../../utils/breadcrumb";
import "../../styles/pageBreadcrumb.css";

/** いま開いているタブのパンくず (無ければ null) */
function useActiveBreadcrumb() {
  const [state, setState] = useState(() => breadcrumbFor(getTabs().find((t) => t.id === getActiveTabId())));
  useEffect(() => subscribe(() => setState(breadcrumbFor(getTabs().find((t) => t.id === getActiveTabId())))), []);
  return state;
}

export function PageBreadcrumb() {
  const crumbs = useActiveBreadcrumb();
  if (!crumbs) return null;
  return (
    <nav className="page-breadcrumb" aria-label="パンくず" style={{ height: BREADCRUMB_HEIGHT }} data-testid="page-breadcrumb">
      <ol>
        {crumbs.map((c, i) => {
          const last = i === crumbs.length - 1;
          return (
            <li key={`${i}:${c.label}`} aria-current={last ? "page" : undefined}>
              {c.open && !last ? (
                <button type="button" className="page-breadcrumb-link" data-testid="breadcrumb-link"
                  onClick={() => openTab({ id: makeTabId(c.open!.type, c.open!.resourceId), type: c.open!.type, resourceId: c.open!.resourceId, label: c.open!.label })}>
                  {c.label}
                </button>
              ) : <span className={last ? "page-breadcrumb-current" : "page-breadcrumb-group"}>{c.label}</span>}
              {!last && <i className="bi bi-chevron-right page-breadcrumb-sep" aria-hidden="true" />}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
