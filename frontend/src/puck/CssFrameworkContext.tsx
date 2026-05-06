/**
 * CssFrameworkContext — Puck primitive render 関数に cssFramework を伝える React Context。
 *
 * PuckBackend が Provider で wrap し、各 primitive が useCssFramework() で参照する。
 * Puck の ComponentConfig.render は通常の React コンポーネントなので Hook が使える。
 *
 * 詳細仕様: docs/spec/multi-editor-puck.md § 4.2
 *
 * #806 子 4
 */

import React from "react";
import type { CssFramework } from "./layoutPropsMapping/types";

const CssFrameworkContext = React.createContext<CssFramework>("bootstrap");

/**
 * CssFramework を provide する Provider。
 * PuckBackend の PuckEditorWrapper でこの Provider が Puck コンポーネントを wrap する。
 */
export const CssFrameworkProvider = CssFrameworkContext.Provider;

/**
 * 最寄りの CssFrameworkProvider から cssFramework 値を取得する Hook。
 * Provider がなければ "bootstrap" を fallback とする。
 */
export function useCssFramework(): CssFramework {
  return React.useContext(CssFrameworkContext);
}
