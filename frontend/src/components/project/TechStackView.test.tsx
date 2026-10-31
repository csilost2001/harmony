/**
 * TechStackView — rendering smoke (#1146)
 *
 * loading state / 初期 category 表示 / category 切替を検証。
 * 保存系の deep interaction は e2e (project/*) に委譲。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, waitFor } from "@testing-library/react";

const loadRawProjectMock = vi.fn();
const saveTechStackMock = vi.fn();

vi.mock("../../store/flowStore", () => ({
  loadRawProject: () => loadRawProjectMock(),
  saveTechStack: (...args: unknown[]) => saveTechStackMock(...args),
}));

vi.mock("../../utils/techStackConstraints", () => ({
  validateTechStackConstraints: vi.fn(() => []),
}));

const { TechStackView } = await import("./TechStackView");
const constraints = await import("../../utils/techStackConstraints");
const realConstraints = await vi.importActual<typeof import("../../utils/techStackConstraints")>("../../utils/techStackConstraints");

describe("TechStackView", () => {
  beforeEach(() => {
    loadRawProjectMock.mockReset();
    saveTechStackMock.mockReset();
    loadRawProjectMock.mockResolvedValue({ techStack: {} });
  });

  it("shows loading indicator before load completes", () => {
    // unresolved promise — loading stays true
    loadRawProjectMock.mockReturnValue(new Promise(() => { /* never */ }));
    const { container } = render(<TechStackView />);
    expect(container.textContent).toContain("読み込み中");
  });

  it("renders 6 category buttons after load", async () => {
    const { container } = render(<TechStackView />);
    await waitFor(() => {
      expect(container.textContent).not.toContain("読み込み中");
    });
    // 左ペインの category ボタン
    const labels = ["デザイナー", "バックエンド", "データベース", "フロントエンド", "認証", "デプロイ"];
    for (const l of labels) {
      expect(container.textContent).toContain(l);
    }
  });

  it("switches active panel when category button is clicked", async () => {
    const { container } = render(<TechStackView />);
    await waitFor(() => {
      expect(container.textContent).not.toContain("読み込み中");
    });

    // 初期 = designer panel が active。frontend に切替
    const frontendBtn = Array.from(container.querySelectorAll("button"))
      .find((b) => b.textContent?.includes("フロントエンド"));
    expect(frontendBtn).toBeTruthy();
    fireEvent.click(frontendBtn!);

    // FrontendPanel に固有のテキストが現れる
    await waitFor(() => {
      expect(container.textContent).toContain("ライブラリ");
    });
  });

  it("save button is enabled after successful load with no violations", async () => {
    const { container } = render(<TechStackView />);
    await waitFor(() => {
      expect(container.textContent).not.toContain("読み込み中");
    });
    const saveBtn = Array.from(container.querySelectorAll("button"))
      .find((b) => b.textContent?.includes("保存") && !b.textContent?.includes("中..."));
    expect(saveBtn).toBeTruthy();
    expect((saveBtn as HTMLButtonElement).disabled).toBe(false);
  });
});

describe("プリセット", () => {
  it("選ぶと、バックエンド・DB・フロントエンド・認証・デプロイがまとめて入り、右の概要に出る。保存するまで、保存の呼び出しはしない", async () => {
    loadRawProjectMock.mockResolvedValue({ techStack: { designer: { cssFramework: "tailwind" } } });
    saveTechStackMock.mockResolvedValue(undefined);
    const { findByTestId, findByText, getByText, getByRole } = render(<TechStackView />);
    fireEvent.change((await findByTestId("techstack-preset-select")) as HTMLSelectElement, { target: { value: "go-k8s" } });
    expect(await findByText("FW: gin")).toBeTruthy();
    expect(getByText("ターゲット: kubernetes")).toBeTruthy();
    expect(getByText("CSS: tailwind")).toBeTruthy(); // 画面デザインの設定は、そのまま
    expect(saveTechStackMock).not.toHaveBeenCalled();
    fireEvent.click(getByRole("button", { name: /保存/ }));
    await waitFor(() => expect(saveTechStackMock).toHaveBeenCalledTimes(1));
    expect(saveTechStackMock.mock.calls[0][0]).toMatchObject({ designer: { cssFramework: "tailwind" }, backend: { language: "go", framework: "gin" }, deployment: { target: "kubernetes" } });
  });
});

describe("ORM の選択 (#1560)", () => {
  beforeEach(() => { saveTechStackMock.mockReset(); });
  // 制約の判定は上でモックしている。判定そのものが絡む試験だけ、本物に差し替える
  const useRealConstraints = () => vi.mocked(constraints.validateTechStackConstraints).mockImplementation(realConstraints.validateTechStackConstraints);
  afterEach(() => { vi.mocked(constraints.validateTechStackConstraints).mockImplementation(() => []); });
  async function openBackend(techStack: unknown) {
    loadRawProjectMock.mockResolvedValue({ techStack });
    const utils = render(<TechStackView />);
    fireEvent.click(await utils.findByRole("button", { name: /バックエンド/ }));
    return utils;
  }
  const orm = (c: HTMLElement, v: string) => c.querySelector(`input[name="backend-orm"][value="${v}"]`) as HTMLInputElement;

  it("TypeScript のとき、ORM を選べ、未設定は Prisma 扱いで「推奨」が出る。サマリにも出る", async () => {
    const { container, findByTestId, getByText } = await openBackend({ backend: { language: "typescript", framework: "nestjs" } });
    expect(orm(container, "prisma").checked).toBe(true);
    expect(orm(container, "prisma").disabled).toBe(false);
    expect((await findByTestId("radio-badge-prisma")).textContent).toBe("推奨");
    expect(container.querySelector('[data-testid="backend-orm-note"]')).toBeNull();
    expect(getByText("ORM: prisma (既定)")).toBeTruthy();
    fireEvent.click(orm(container, "typeorm"));
    await waitFor(() => expect(getByText("ORM: typeorm")).toBeTruthy());
    expect(orm(container, "typeorm").checked).toBe(true);
  });

  it("TypeScript 以外のときは選べず、注意が出る。言語を TypeScript 以外に変えると ORM の指定は外れる", async () => {
    const { container, findByTestId, queryByText } = await openBackend({ backend: { language: "typescript", framework: "nestjs", orm: "typeorm" } });
    expect(queryByText("ORM: typeorm")).toBeTruthy();
    fireEvent.click(container.querySelector('input[name="backend-language"][value="java"]') as HTMLInputElement);
    expect(await findByTestId("backend-orm-note")).toBeTruthy();
    expect(orm(container, "prisma").disabled).toBe(true);
    expect(orm(container, "typeorm").disabled).toBe(true);
    expect(queryByText("ORM: typeorm")).toBeNull();
  });

  it("言語が未設定 (既定は Java) のときも ORM は選べない", async () => {
    const { container } = await openBackend({});
    expect(orm(container, "prisma").disabled).toBe(true);
  });

  it("選べないあいだ (Java・言語未設定) は、どの ORM も選択済みに見えない。「推奨」の印と、対象外の注意は残る (#1560 レビュー S8)", async () => {
    for (const ts of [{}, { backend: { language: "java", framework: "spring-boot" } }]) {
      const { container, findByTestId, unmount } = await openBackend(ts);
      expect(orm(container, "prisma").checked).toBe(false);
      expect(orm(container, "typeorm").checked).toBe(false);
      expect((await findByTestId("radio-badge-prisma")).textContent).toBe("推奨");
      expect((await findByTestId("backend-orm-note")).textContent).toContain("対象外");
      expect(container.querySelector('[data-testid="backend-orm-leftover"]')).toBeNull();
      unmount();
    }
  });

  it("language: java のまま orm の指定が残っている (制約違反) と、「ORM の指定を外す」で外せて、違反が消える", async () => {
    useRealConstraints();
    const { container, findByTestId, queryByText } = await openBackend({ backend: { language: "java", framework: "spring-boot", orm: "prisma" } });
    expect(orm(container, "prisma").checked).toBe(false);
    expect((await findByTestId("backend-orm-leftover")).textContent).toContain("prisma");
    expect(queryByText(/ORM "prisma" は言語 "java" では使えません/)).toBeTruthy();
    fireEvent.click(await findByTestId("backend-orm-clear"));
    await waitFor(() => expect(container.querySelector('[data-testid="backend-orm-leftover"]')).toBeNull());
    expect(queryByText(/ORM "prisma" は言語 "java" では使えません/)).toBeNull();
  });

  it("language が未指定で orm だけ指定されていても、同じく違反と「外す」操作が出る (制約の判定は未指定を java として扱う)", async () => {
    useRealConstraints();
    const { findByTestId, queryByText } = await openBackend({ backend: { orm: "typeorm" } });
    expect(await findByTestId("backend-orm-clear")).toBeTruthy();
    expect(queryByText(/ORM "typeorm" は言語 "java" \(未指定のときの既定\) では使えません/)).toBeTruthy();
  });

  it("言語を変えて ORM の指定が外れたら、外れたことを知らせる。TypeScript に戻すと知らせは消える", async () => {
    const { container, findByTestId, queryByTestId } = await openBackend({ backend: { language: "typescript", framework: "nestjs", orm: "typeorm" } });
    expect(queryByTestId("backend-orm-dropped")).toBeNull();
    fireEvent.click(container.querySelector('input[name="backend-language"][value="java"]') as HTMLInputElement);
    expect((await findByTestId("backend-orm-dropped")).textContent).toContain("typeorm");
    fireEvent.click(container.querySelector('input[name="backend-language"][value="typescript"]') as HTMLInputElement);
    await waitFor(() => expect(queryByTestId("backend-orm-dropped")).toBeNull());
    expect(orm(container, "prisma").checked).toBe(true); // 外れたので未設定 = Prisma 扱い
  });

  it("説明は「コード生成は NestJS が対象」。Express を選んでいるときだけ、NestJS だけが対象と注意する", async () => {
    const nest = await openBackend({ backend: { language: "typescript", framework: "nestjs" } });
    expect(nest.container.textContent).toContain("コード生成の対象は NestJS");
    expect(nest.queryByTestId("backend-orm-express-note")).toBeNull();
    nest.unmount();
    const ex = await openBackend({ backend: { language: "typescript", framework: "express" } });
    expect((await ex.findByTestId("backend-orm-express-note")).textContent).toContain("NestJS だけ");
  });

  it("TypeScript のプリセットを選ぶと、ORM は prisma で保存される", async () => {
    loadRawProjectMock.mockResolvedValue({ techStack: {} });
    saveTechStackMock.mockResolvedValue(undefined);
    const { findByTestId, getByRole, findByText } = render(<TechStackView />);
    fireEvent.change((await findByTestId("techstack-preset-select")) as HTMLSelectElement, { target: { value: "ts-fullstack" } });
    expect(await findByText("ORM: prisma")).toBeTruthy();
    fireEvent.click(getByRole("button", { name: /保存/ }));
    await waitFor(() => expect(saveTechStackMock).toHaveBeenCalledTimes(1));
    expect(saveTechStackMock.mock.calls[0][0]).toMatchObject({ backend: { language: "typescript", framework: "nestjs", orm: "prisma" } });
  });
});
