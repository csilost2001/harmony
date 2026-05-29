import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "bootstrap-icons/font/bootstrap-icons.css";
import "./index.css";
import App from "./App.tsx";
import { ErrorBoundary } from "./components/common/ErrorBoundary";
import { AppErrorFallback } from "./components/common/ErrorFallback";
import { ErrorDialogProvider } from "./components/common/ErrorDialogProvider";
import { installGlobalErrorHandlers } from "./utils/errorLog";

// 外部 React Component 読込基盤 (#1409 P-1): host の React / ReactDOM / Puck インスタンスを
// window bridge に公開する。frontend/public/harmony-externals/*.mjs (import map で bare
// specifier にマップ) がこれを re-export することで、外部 component が host と同一インスタンス
// を共有し二重化 (Invalid hook call 等) を防ぐ。
// namespace import を bridge 専用に追加 (host 自身は通常の named import を使い続ける)。
import * as ReactNamespace from "react";
import * as ReactDOMNamespace from "react-dom";
import * as ReactDOMClientNamespace from "react-dom/client";
import * as ReactJsxRuntimeNamespace from "react/jsx-runtime";
import * as PuckNamespace from "@measured/puck";

declare global {
  interface Window {
    __HARMONY_SHARED_DEPS__?: Record<string, unknown>;
  }
}

window.__HARMONY_SHARED_DEPS__ = {
  "react": ReactNamespace,
  "react-dom": ReactDOMNamespace,
  "react-dom/client": ReactDOMClientNamespace,
  "react/jsx-runtime": ReactJsxRuntimeNamespace,
  "@measured/puck": PuckNamespace,
};

installGlobalErrorHandlers();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary fallback={(error, reset) => <AppErrorFallback error={error} onReset={reset} />}>
      <BrowserRouter>
        <ErrorDialogProvider>
          <App />
        </ErrorDialogProvider>
      </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>
);
