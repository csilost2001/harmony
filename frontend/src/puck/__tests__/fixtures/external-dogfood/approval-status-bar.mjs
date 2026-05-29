import { jsxs as o, jsx as d } from "react/jsx-runtime";
import * as c from "react";
const b = {
  pending: "承認待ち",
  approved: "承認済み",
  rejected: "却下"
}, a = {
  pending: { bg: "#fff8e1", fg: "#7a5b00", border: "#f0c040" },
  approved: { bg: "#e8f5e9", fg: "#1b5e20", border: "#4caf50" },
  rejected: { bg: "#ffebee", fg: "#b71c1c", border: "#e53935" }
};
function g({
  status: r = "pending",
  title: p = "承認ステータス",
  content: t
}) {
  const [n, i] = c.useState(!0), e = a[r] ?? a.pending, s = b[r] ?? r;
  return /* @__PURE__ */ o(
    "div",
    {
      "data-external-component": "ApprovalStatusBar",
      "data-status": r,
      style: {
        border: `1px solid ${e.border}`,
        borderRadius: 6,
        overflow: "hidden"
      },
      children: [
        /* @__PURE__ */ o(
          "div",
          {
            style: {
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              padding: "8px 12px",
              background: e.bg,
              color: e.fg
            },
            children: [
              /* @__PURE__ */ d("strong", { children: p }),
              /* @__PURE__ */ d(
                "span",
                {
                  "data-testid": "approval-status-badge",
                  style: {
                    border: `1px solid ${e.border}`,
                    borderRadius: 999,
                    padding: "2px 10px",
                    fontSize: 12,
                    fontWeight: 600,
                    background: "#fff"
                  },
                  children: s
                }
              ),
              /* @__PURE__ */ d(
                "button",
                {
                  type: "button",
                  onClick: () => i((l) => !l),
                  style: {
                    border: "none",
                    background: "transparent",
                    cursor: "pointer",
                    color: e.fg,
                    fontSize: 12
                  },
                  children: n ? "折りたたむ" : "展開する"
                }
              )
            ]
          }
        ),
        n && t ? /* @__PURE__ */ d("div", { style: { padding: 12 }, children: t() }) : null
      ]
    }
  );
}
export {
  g as default
};
