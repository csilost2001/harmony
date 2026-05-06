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
