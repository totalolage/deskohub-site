import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from "bun:test";
import { cleanup, render, within } from "@testing-library/react";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import { AccountLoading } from "./account-loading";

const sectionKeys = [
  "reservations",
  "profile",
  "assistants",
  "billing",
  "legal",
  "danger",
] as const;

const locales = ["en-US", "cs-CZ"] as const;

/** The element's text outside busy or hidden subtrees. */
const announcedText = (root: Element) => {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let text = "";
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (
      !node.parentElement?.closest('[aria-hidden="true"], [aria-busy="true"]')
    )
      text += node.textContent ?? "";
  }
  return text;
};

class TestResizeObserver implements ResizeObserver {
  readonly callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
  }

  disconnect() {}

  observe(_target: Element) {}

  unobserve(_target: Element) {}
}

const originalResizeObserver = globalThis.ResizeObserver;

describe("AccountLoading", () => {
  beforeAll(() => {
    registerWorkspaceComponentTestEnv();
    globalThis.ResizeObserver = TestResizeObserver;
  });

  afterEach(cleanup);

  afterAll(async () => {
    globalThis.ResizeObserver = originalResizeObserver;
    await unregisterWorkspaceComponentTestEnv();
  });

  test.each(locales)(
    "renders the account frame and disabled navigation without the referral section for %s",
    (locale) => {
      const view = render(<AccountLoading locale={locale} />);
      const status = view.getByRole("status");
      const navigation = view.getByRole("navigation");
      const sectionGroup = within(navigation).getByRole("group");

      expect(status.getAttribute("aria-label")).toBeTruthy();
      // The loading message is announced outside the busy, hidden skeleton.
      expect(announcedText(status).trim()).toBeTruthy();
      const skeleton = status.querySelector('[aria-busy="true"]');
      expect(skeleton?.querySelector('[aria-hidden="true"]')).toBeTruthy();
      expect(view.getByRole("heading", { level: 1 }).textContent).toBeTruthy();
      expect(navigation.getAttribute("aria-label")).toBeTruthy();
      expect(
        document.getElementById(
          sectionGroup.getAttribute("aria-labelledby") ?? ""
        )?.textContent
      ).toBeTruthy();

      const sectionItems = (attribute: string) =>
        Array.from(
          navigation.querySelectorAll<HTMLButtonElement>(`button[${attribute}]`)
        );
      const mobileItems = sectionItems("data-account-section");
      const sidebarItems = sectionItems("data-account-sidebar-section");
      expect(
        mobileItems.map((button) => button.dataset.accountSection)
      ).toEqual([...sectionKeys]);
      expect(
        sidebarItems.map((button) => button.dataset.accountSidebarSection)
      ).toEqual([...sectionKeys]);
      const buttons = Array.from(view.container.querySelectorAll("button"));
      expect(buttons).toHaveLength(sectionKeys.length * 2 + 1);
      expect(buttons.every((button) => button.disabled)).toBe(true);
      expect(
        view.container.querySelector<HTMLButtonElement>("#account-sign-out")
          ?.disabled
      ).toBe(true);
      expect(view.container.querySelector("span.ml-auto")).toBeNull();
      expect(
        view.container.querySelector("input, textarea, select, form")
      ).toBe(null);
      expect(view.container.textContent).not.toContain("@example");
      expect(
        status.querySelectorAll('[data-slot="skeleton"]').length
      ).toBeGreaterThan(0);
    }
  );
});
