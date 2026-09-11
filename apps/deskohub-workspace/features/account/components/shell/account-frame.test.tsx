import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from "bun:test";
import { cleanup, render } from "@testing-library/react";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import { AccountFrame, type AccountFrameProps } from "./account-frame";

function makeProps(
  overrides: Partial<AccountFrameProps> = {}
): AccountFrameProps {
  return {
    children: <div data-testid="content">Account content</div>,
    navigation: (
      <nav className="caller-owned-navigation" data-testid="navigation">
        Account navigation
      </nav>
    ),
    sidebarFooter: <p data-testid="sidebar-footer">Sidebar footer</p>,
    signOut: (
      <button type="button" data-testid="sign-out">
        Sign out
      </button>
    ),
    title: "Workspace account",
    ...overrides,
  };
}

function renderFrame(overrides: Partial<AccountFrameProps> = {}) {
  return render(<AccountFrame {...makeProps(overrides)} />);
}

describe("AccountFrame", () => {
  beforeAll(registerWorkspaceComponentTestEnv);

  afterEach(cleanup);

  afterAll(unregisterWorkspaceComponentTestEnv);

  test("keeps the title, action, navigation, footer, and content slots ordered", () => {
    const view = renderFrame();
    const main = view.container.querySelector("main");
    if (!main) throw new Error("Account frame main was not rendered");
    const content = main.querySelector(":scope > div");
    if (!content)
      throw new Error("Account frame content wrapper was not rendered");
    const header = content.querySelector(":scope > header");
    if (!header) throw new Error("Account frame header was not rendered");
    const grid = content.querySelector(":scope > div");
    if (!grid) throw new Error("Account frame grid was not rendered");
    const aside = grid.querySelector(":scope > aside");
    if (!aside) throw new Error("Account frame aside was not rendered");
    const contentSlot = grid.children.item(1);
    if (!contentSlot)
      throw new Error("Account frame content slot was not rendered");
    const mobileFooter = grid.children.item(2);
    if (!mobileFooter)
      throw new Error("Account frame mobile footer was not rendered");

    const title = view.getByRole("heading", {
      level: 1,
      name: "Workspace account",
    });
    const navigation = view.getByTestId("navigation");
    const footers = view.getAllByTestId("sidebar-footer");
    expect(footers).toHaveLength(2);
    const [desktopFooter, mobileFooterContent] = footers;
    const signOut = view.getByTestId("sign-out");

    expect(header.children).toHaveLength(2);
    expect(header.firstElementChild).toBe(title);
    expect(header.lastElementChild).toBe(signOut.parentElement);
    expect(aside.children).toHaveLength(2);
    expect(aside.firstElementChild).toBe(navigation);
    expect(aside.lastElementChild).toBe(desktopFooter.parentElement);
    expect(grid.children).toHaveLength(3);
    expect(grid.firstElementChild).toBe(aside);
    expect(grid.children.item(1)).toBe(contentSlot);
    expect(grid.lastElementChild).toBe(mobileFooter);
    expect(contentSlot.contains(view.getByTestId("content"))).toBe(true);
    expect(navigation.parentElement).toBe(aside);
    expect(mobileFooter.contains(mobileFooterContent)).toBe(true);
    expect(mobileFooterContent).not.toBe(desktopFooter);
    expect(navigation.className).toBe("caller-owned-navigation");
  });

  test("omits optional sign-out and sidebar footer slots without wrappers", () => {
    const view = renderFrame({ signOut: undefined, sidebarFooter: undefined });
    const header = view.container.querySelector("header");
    if (!header) throw new Error("Account frame header was not rendered");
    const aside = view.container.querySelector("aside");
    if (!aside) throw new Error("Account frame aside was not rendered");

    expect(header.children).toHaveLength(1);
    expect(aside.children).toHaveLength(1);
    expect(view.queryByTestId("sign-out")).toBeNull();
    expect(view.queryByTestId("sidebar-footer")).toBeNull();
    expect(view.getByRole("heading", { level: 1 })).toBeTruthy();
    expect(view.getByTestId("navigation").parentElement).toBe(aside);
  });

  test("keeps the account shell geometry classes on the frame", () => {
    const view = renderFrame();
    const main = view.container.querySelector("main");
    if (!main) throw new Error("Account frame main was not rendered");
    const content = main.querySelector(":scope > div");
    if (!content)
      throw new Error("Account frame content wrapper was not rendered");
    const header = content.querySelector(":scope > header");
    if (!header) throw new Error("Account frame header was not rendered");
    const heading = header.querySelector("h1");
    if (!heading) throw new Error("Account frame heading was not rendered");
    const grid = content.querySelector(":scope > div");
    if (!grid) throw new Error("Account frame grid was not rendered");
    const aside = grid.querySelector(":scope > aside");
    if (!aside) throw new Error("Account frame aside was not rendered");
    const footer = aside.querySelector(":scope > div");
    if (!footer) throw new Error("Account frame footer was not rendered");
    const contentSlot = grid.children.item(1);
    if (!contentSlot)
      throw new Error("Account frame content slot was not rendered");
    const mobileFooter = grid.children.item(2);
    if (!mobileFooter)
      throw new Error("Account frame mobile footer was not rendered");
    const mobileFooterContent = mobileFooter.querySelector(
      "[data-testid='sidebar-footer']"
    );
    if (!mobileFooterContent)
      throw new Error("Account frame mobile footer content was not rendered");

    expect(main.className).toBe(
      "min-h-screen [--font-heading-weight:700] [--font-subheading-weight:600] [background:radial-gradient(circle_at_0%_0%,rgba(255,242,214,0.9),transparent_34%),radial-gradient(circle_at_100%_0%,rgba(218,244,235,0.82),transparent_38%),#f8f5ef] px-4 pb-28 pt-[calc(var(--site-header-height)+3rem)] sm:px-6 lg:px-8"
    );
    expect(content.className).toBe("mx-auto min-w-0 max-w-[95rem]");
    expect(header.className).toBe(
      "flex min-w-0 flex-row items-start justify-between gap-x-3 gap-y-4 sm:flex-wrap sm:gap-x-8"
    );
    expect(heading.className).toBe(
      "min-w-min flex-1 break-words pr-px text-[24px] min-[375px]:text-[28px] font-bold leading-[1.15] tracking-[-0.025em] text-[#00024f] sm:min-w-0 sm:pr-0 sm:text-[36px]"
    );
    expect(grid.className).toBe(
      "mt-7 grid min-w-0 items-start gap-8 md:grid-cols-[minmax(0,17.5rem)_minmax(0,1fr)]"
    );
    expect(aside.className).toBe(
      "sticky top-(--site-header-height) z-40 min-w-0 md:sticky md:top-[calc(var(--site-header-height)+1rem)] md:max-h-[calc(100dvh-var(--site-header-height)-2rem)] md:overflow-y-auto"
    );
    expect(footer.className).toBe("mt-4 min-w-0 hidden md:block");
    expect(mobileFooter.className).toBe("min-w-0 md:hidden");
    expect(mobileFooterContent).not.toBe(footer);
    expect(contentSlot.className).toBe("min-w-0");
  });
});
