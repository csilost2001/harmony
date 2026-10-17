import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "bootstrap-icons/font/bootstrap-icons.css";
import "./styles/tokens.css";
import "./styles/bootstrapCompat.css";
import "./styles/viewEditors.css";
import "./index.css";
import "./styles/print.css";
import "./styles/motion.css";
import "./styles/a11y.css";
import App from "./App.tsx";
import { ErrorBoundary } from "./components/common/ErrorBoundary";
import { AppErrorFallback } from "./components/common/ErrorFallback";
import { ErrorDialogProvider } from "./components/common/ErrorDialogProvider";
import { installGlobalErrorHandlers } from "./utils/errorLog";
import { installFailureToasts } from "./utils/failureToast";
import { initAppTheme } from "./theme/appTheme";
import { initDisplayPrefs } from "./theme/displayPrefs";
import { initMotionPrefs } from "./theme/motionPrefs";
import { installPreloadErrorReload } from "./utils/preloadErrorReload";

installGlobalErrorHandlers();
installFailureToasts();
initAppTheme();
initDisplayPrefs();
initMotionPrefs();
installPreloadErrorReload();

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
