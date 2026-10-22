import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from "bun:test";
import { cleanup, render, within } from "@testing-library/react";
import { customerMcpServerPath } from "@/features/account/customer-agent-routes";
import { locales } from "@/features/i18n";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import { getAiAssistantsGuide } from "../ai-assistants-guide";
import { AiAssistantsPage } from "./ai-assistants-page";

beforeAll(() => {
  registerWorkspaceComponentTestEnv();
});

afterEach(() => {
  cleanup();
});

afterAll(async () => {
  await unregisterWorkspaceComponentTestEnv();
});

describe.each(locales)("AiAssistantsPage in %s", (locale) => {
  const guide = getAiAssistantsGuide(locale);

  test("renders the title and one linkable section per guide section", () => {
    const view = render(<AiAssistantsPage locale={locale} />);

    expect(
      view.getByRole("heading", { level: 1, name: guide.title })
    ).toBeTruthy();
    const sections = view.container.querySelectorAll("section[id]");
    expect([...sections].map((section) => section.id)).toEqual(
      guide.sections.map((section) => section.id)
    );
    for (const section of guide.sections) {
      const region = view.getByRole("region", { name: section.heading });
      expect(region.id).toBe(section.id);
    }
  });

  test("fills every link tag and leaves no template syntax in the text", () => {
    const view = render(<AiAssistantsPage locale={locale} />);
    const text = view.container.textContent ?? "";

    expect(text).not.toMatch(/<\/?\w+>|\{\w+\}/);
    const hrefs = within(view.container)
      .getAllByRole("link")
      .map((link) => link.getAttribute("href"));
    expect(hrefs.toSorted()).toEqual(Object.values(guide.links).toSorted());
    for (const href of hrefs) {
      expect(
        href?.startsWith(`/${locale}/`) || href?.startsWith("mailto:")
      ).toBe(true);
    }
  });

  test("shows the MCP server URL for custom connectors", () => {
    const view = render(<AiAssistantsPage locale={locale} />);
    const [url] = [...view.container.querySelectorAll("code")].map(
      (code) => new URL(code.textContent ?? "")
    );

    expect(url?.protocol).toBe("https:");
    expect(url?.pathname).toBe(customerMcpServerPath);
  });
});
