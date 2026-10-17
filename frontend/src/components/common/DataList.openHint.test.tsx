import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { DataList, type DataListColumn } from "./DataList";
import { resetOpenHintForTest } from "../../utils/openHint";

interface Row { id: string; name: string }
const items: Row[] = [{ id: "a", name: "甲" }, { id: "b", name: "乙" }];
const columns: DataListColumn<Row>[] = [{ key: "name", header: "名前", render: (r) => r.name }];

beforeEach(() => resetOpenHintForTest());
afterEach(() => cleanup());

describe("DataList の開き方の案内 (ISSUE #1528 a)", () => {
  it("開く操作 (onActivate) があり、行があるとき、ダブルクリックで開くことを案内する", () => {
    render(<DataList items={items} columns={columns} getId={(r) => r.id} onActivate={() => undefined} />);
    expect(screen.getByTestId("data-list-open-hint").textContent).toContain("ダブルクリック");
  });
  it("開く操作が無い一覧や、行が無い一覧には出さない", () => {
    const { unmount } = render(<DataList items={items} columns={columns} getId={(r) => r.id} />);
    expect(screen.queryByTestId("data-list-open-hint")).toBeNull();
    unmount();
    render(<DataList items={[]} columns={columns} getId={(r) => r.id} onActivate={() => undefined} />);
    expect(screen.queryByTestId("data-list-open-hint")).toBeNull();
  });
  it("一度ダブルクリックで開くと、案内は消え、開く処理も呼ばれる", () => {
    const onActivate = vi.fn();
    render(<DataList items={items} columns={columns} getId={(r) => r.id} onActivate={onActivate} />);
    fireEvent.doubleClick(screen.getAllByTestId("data-list-row")[0]);
    expect(onActivate).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("data-list-open-hint")).toBeNull();
  });
  it("消すボタンで消え、次に一覧を開いても出ない (このブラウザでは以後出さない)", () => {
    const { unmount } = render(<DataList items={items} columns={columns} getId={(r) => r.id} onActivate={() => undefined} />);
    fireEvent.click(screen.getByLabelText("この案内を消す"));
    expect(screen.queryByTestId("data-list-open-hint")).toBeNull();
    unmount();
    render(<DataList items={items} columns={columns} getId={(r) => r.id} onActivate={() => undefined} />);
    expect(screen.queryByTestId("data-list-open-hint")).toBeNull();
  });
});
