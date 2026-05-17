/**
 * Conventions catalog category panels — rendering / 基本操作テスト (#1145 Phase-5)
 *
 * 14 panel (13 編集 + 1 read-only ExtensionCategoriesPanel) の最小限 rendering test。
 * 各 panel は ConventionsCatalogView から prop callback で update / commit / remove / add を
 * 受け取る純粋 component。テストは entry 列の table 表示 + 空時の placeholder + 追加 / 削除の
 * callback 発火を中心に検証する。
 */
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { MsgPanel } from "./MsgPanel";
import { RegexPanel } from "./RegexPanel";
import { LimitPanel } from "./LimitPanel";
import { ScopePanel } from "./ScopePanel";
import { CurrencyPanel } from "./CurrencyPanel";
import { TaxPanel } from "./TaxPanel";
import { AuthPanel } from "./AuthPanel";
import { RolePanel } from "./RolePanel";
import { PermissionPanel } from "./PermissionPanel";
import { DbPanel } from "./DbPanel";
import { NumberingPanel } from "./NumberingPanel";
import { TxPanel } from "./TxPanel";
import { ExternalOutcomeDefaultsPanel } from "./ExternalOutcomeDefaultsPanel";
import { ExtensionCategoriesPanel } from "./ExtensionCategoriesPanel";

const noopCallbacks = () => ({
  onAdd: vi.fn(),
  onUpdate: vi.fn(),
  onCommit: vi.fn(),
  onRemove: vi.fn(),
});

describe("MsgPanel", () => {
  it("空エントリで empty placeholder を表示", () => {
    render(<MsgPanel msg={{}} {...noopCallbacks()} />);
    expect(screen.getByText(/エントリがありません/)).toBeInTheDocument();
  });

  it("entry を渡すと key と template が描画される", () => {
    render(
      <MsgPanel
        msg={{ required: { template: "{label}は必須" } }}
        {...noopCallbacks()}
      />,
    );
    expect(screen.getByText("required")).toBeInTheDocument();
    expect(screen.getByDisplayValue("{label}は必須")).toBeInTheDocument();
  });

  it("新規 key 入力 + 追加 ボタンで onAdd が発火", () => {
    const cbs = noopCallbacks();
    render(<MsgPanel msg={{}} {...cbs} />);
    const input = screen.getByPlaceholderText(/新規 key/);
    fireEvent.change(input, { target: { value: "newKey" } });
    fireEvent.click(screen.getByRole("button", { name: /追加/ }));
    expect(cbs.onAdd).toHaveBeenCalledWith("newKey");
  });
});

describe("RegexPanel", () => {
  it("entry の pattern / flags が表示される", () => {
    render(
      <RegexPanel
        regex={{ phoneJp: { pattern: "^0\\d{9,10}$", flags: "i" } }}
        {...noopCallbacks()}
      />,
    );
    expect(screen.getByText("phoneJp")).toBeInTheDocument();
    expect(screen.getByDisplayValue("^0\\d{9,10}$")).toBeInTheDocument();
    expect(screen.getByDisplayValue("i")).toBeInTheDocument();
  });
});

describe("LimitPanel", () => {
  it("numeric value が描画される", () => {
    render(
      <LimitPanel
        limit={{ emailMax: { value: 254, unit: "char" } }}
        {...noopCallbacks()}
      />,
    );
    expect(screen.getByText("emailMax")).toBeInTheDocument();
    expect(screen.getByDisplayValue("254")).toBeInTheDocument();
    expect(screen.getByDisplayValue("char")).toBeInTheDocument();
  });
});

describe("ScopePanel", () => {
  it("default チェックが反映される", () => {
    render(
      <ScopePanel
        scope={{ domestic: { value: "domestic", default: true } }}
        {...noopCallbacks()}
      />,
    );
    const cb = screen.getByRole("checkbox") as HTMLInputElement;
    expect(cb.checked).toBe(true);
  });
});

describe("CurrencyPanel", () => {
  it("code が描画される", () => {
    render(
      <CurrencyPanel
        currency={{ jpy: { code: "JPY", subunit: 0 } }}
        {...noopCallbacks()}
      />,
    );
    expect(screen.getByText("jpy")).toBeInTheDocument();
    expect(screen.getByDisplayValue("JPY")).toBeInTheDocument();
  });
});

describe("TaxPanel", () => {
  it("kind / rate が描画される", () => {
    render(
      <TaxPanel
        tax={{ standard: { kind: "exclusive", rate: 0.1 } }}
        {...noopCallbacks()}
      />,
    );
    expect(screen.getByText("standard")).toBeInTheDocument();
    expect(screen.getByDisplayValue("0.1")).toBeInTheDocument();
  });
});

describe("AuthPanel", () => {
  it("scheme が描画される", () => {
    render(
      <AuthPanel
        auth={{ defaultScheme: { scheme: "session-cookie" } }}
        {...noopCallbacks()}
      />,
    );
    expect(screen.getByText("defaultScheme")).toBeInTheDocument();
    expect(screen.getByDisplayValue("session-cookie")).toBeInTheDocument();
  });
});

describe("RolePanel", () => {
  it("permissions / inherits が描画される", () => {
    render(
      <RolePanel
        role={{ customer: { permissions: ["order.create"], inherits: ["base"] } }}
        permissionKeys={["order.create", "order.read"]}
        issues={[]}
        {...noopCallbacks()}
      />,
    );
    expect(screen.getByText("customer")).toBeInTheDocument();
    expect(screen.getByDisplayValue("order.create")).toBeInTheDocument();
    expect(screen.getByDisplayValue("base")).toBeInTheDocument();
  });

  it("issues がある場合 row issue 行が描画される", () => {
    render(
      <RolePanel
        role={{ customer: { permissions: ["unknown.x"] } }}
        permissionKeys={["order.create"]}
        issues={[
          {
            code: "UNKNOWN_CONV_ROLE_PERMISSION",
            path: "role.customer.permissions[0]",
            message: "unknown permission key: unknown.x",
            severity: "error",
          },
        ]}
        {...noopCallbacks()}
      />,
    );
    expect(screen.getByText(/unknown permission key/)).toBeInTheDocument();
  });
});

describe("PermissionPanel", () => {
  it("resource / action が描画される", () => {
    render(
      <PermissionPanel
        permission={{ "order.create": { resource: "Order", action: "create" } }}
        {...noopCallbacks()}
      />,
    );
    expect(screen.getByText("order.create")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Order")).toBeInTheDocument();
    expect(screen.getByDisplayValue("create")).toBeInTheDocument();
  });
});

describe("DbPanel", () => {
  it("engine / namingConvention が描画される", () => {
    render(
      <DbPanel
        db={{ defaultDb: { engine: "postgresql@14", namingConvention: "snake_case" } }}
        {...noopCallbacks()}
      />,
    );
    expect(screen.getByText("defaultDb")).toBeInTheDocument();
    expect(screen.getByDisplayValue("postgresql@14")).toBeInTheDocument();
    expect(screen.getByDisplayValue("snake_case")).toBeInTheDocument();
  });
});

describe("NumberingPanel", () => {
  it("format が描画される", () => {
    render(
      <NumberingPanel
        numbering={{ customerCode: { format: "C-NNNN" } }}
        {...noopCallbacks()}
      />,
    );
    expect(screen.getByText("customerCode")).toBeInTheDocument();
    expect(screen.getByDisplayValue("C-NNNN")).toBeInTheDocument();
  });
});

describe("TxPanel", () => {
  it("policy が描画される (textarea)", () => {
    render(
      <TxPanel
        tx={{ singleOperation: { policy: "単一操作は 1 TX" } }}
        {...noopCallbacks()}
      />,
    );
    expect(screen.getByText("singleOperation")).toBeInTheDocument();
    expect(screen.getByDisplayValue(/単一操作は 1 TX/)).toBeInTheDocument();
  });
});

describe("ExternalOutcomeDefaultsPanel", () => {
  it("outcome / action select が描画される", () => {
    render(
      <ExternalOutcomeDefaultsPanel
        entries={{ httpDefault: { outcome: "failure", action: "abort" } }}
        {...noopCallbacks()}
      />,
    );
    expect(screen.getByText("httpDefault")).toBeInTheDocument();
    // 各 select の selected value 検証
    const selects = screen.getAllByRole("combobox");
    // outcome select は最初の select、value=failure
    expect((selects[0] as HTMLSelectElement).value).toBe("failure");
    // action select は 2 番目、value=abort
    expect((selects[1] as HTMLSelectElement).value).toBe("abort");
  });
});

describe("ExtensionCategoriesPanel (read-only)", () => {
  it("空の場合 placeholder を表示", () => {
    render(<ExtensionCategoriesPanel extensionCategories={{}} />);
    expect(screen.getByText(/拡張カテゴリは定義されていません/)).toBeInTheDocument();
  });

  it("カテゴリ entry がある場合 keys が描画される", () => {
    render(
      <ExtensionCategoriesPanel
        extensionCategories={{
          industryRetail: { ageCategory: { value: "A" }, vipTier: { value: "gold" } },
        }}
      />,
    );
    expect(screen.getByText("@conv.industryRetail.*")).toBeInTheDocument();
    expect(screen.getByText(/ageCategory, vipTier/)).toBeInTheDocument();
  });
});

describe("Shared NewKeyRow / DeleteBtn behavior", () => {
  it("MsgPanel: isReadonly=true で入力欄と追加ボタンが disabled", () => {
    render(<MsgPanel msg={{}} isReadonly {...noopCallbacks()} />);
    expect(screen.getByPlaceholderText(/新規 key/)).toBeDisabled();
    expect(screen.getByRole("button", { name: /追加/ })).toBeDisabled();
  });

  it("RegexPanel: delete ボタン click で onRemove が key 引数で発火", () => {
    const cbs = noopCallbacks();
    render(
      <RegexPanel
        regex={{ phoneJp: { pattern: "^0\\d+$" } }}
        {...cbs}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /削除/ }));
    expect(cbs.onRemove).toHaveBeenCalledWith("phoneJp");
  });
});
