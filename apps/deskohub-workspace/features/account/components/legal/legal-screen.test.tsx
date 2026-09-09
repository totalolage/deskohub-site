import { afterAll, afterEach, beforeAll, expect, mock, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import type { ComponentPropsWithoutRef, Ref } from "react";
import { m } from "@/features/i18n";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import { legalScreenCopy } from "./legal-screen.copy";

type MockNextLinkProps = ComponentPropsWithoutRef<"a"> & {
  readonly href: string;
  readonly onNavigate?: (event: { preventDefault: () => void }) => void;
  readonly prefetch?: boolean | "auto" | null;
  readonly ref?: Ref<HTMLAnchorElement>;
};

function MockNextLink({
  children,
  href,
  onNavigate: _onNavigate,
  prefetch: _prefetch,
  ref,
  ...props
}: MockNextLinkProps) {
  return (
    <a href={href} ref={ref} {...props}>
      {children}
    </a>
  );
}

mock.module("next/link", () => ({ default: MockNextLink }));

const { LegalScreen } = await import("./legal-screen");

beforeAll(registerWorkspaceComponentTestEnv);
afterEach(cleanup);
afterAll(unregisterWorkspaceComponentTestEnv);

for (const locale of ["en-US", "cs-CZ"] as const) {
  test(`${locale} renders the supplied copy and localized policy destinations`, () => {
    const strings = legalScreenCopy[locale];
    const view = render(<LegalScreen locale={locale} strings={strings} />);

    for (const string of Object.values(strings)) {
      expect(view.container.textContent).toContain(string);
    }

    expect(
      view.getByRole("heading", { level: 2, name: strings.title })
    ).toBeTruthy();
    expect(
      view.getByRole("navigation", {
        name: m.footerLegalLabel({}, { locale }),
      })
    ).toBeTruthy();

    const policyLinks = [
      [m.footerPrivacyLink({}, { locale }), `/${locale}/privacy-policy`],
      [
        m.footerMarketingCommunicationsLink({}, { locale }),
        `/${locale}/marketing-communications`,
      ],
      [m.footerTermsLink({}, { locale }), `/${locale}/terms-and-conditions`],
      [
        m.footerCookieSettingsLink({}, { locale }),
        `/${locale}/cookie-settings`,
      ],
    ] as const;

    for (const [name, href] of policyLinks) {
      expect(view.getByRole("link", { name }).getAttribute("href")).toBe(href);
    }
  });
}

test("keeps account legal controls visibly unavailable and inert", () => {
  const strings = legalScreenCopy["en-US"];
  const view = render(<LegalScreen locale="en-US" strings={strings} />);
  const buttons = view.getAllByRole("button");

  expect(buttons).toHaveLength(4);
  for (const button of buttons) {
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(button.getAttribute("type")).toBe("button");
  }

  const unavailableButtons = view.getAllByRole("button", {
    name: strings.unavailable,
  });
  expect(unavailableButtons).toHaveLength(2);

  const descriptionId = unavailableButtons[0]?.getAttribute("aria-describedby");
  expect(descriptionId).toBeTruthy();
  expect(descriptionId).toBe(
    unavailableButtons[1]?.getAttribute("aria-describedby")
  );
  expect(
    descriptionId && document.getElementById(descriptionId)?.textContent
  ).toBe(strings.preferencesUnavailable);

  for (const description of [
    strings.analyticsDescription,
    strings.marketingDescription,
    strings.preferencesUnavailable,
    strings.archiveDescription,
  ]) {
    expect(view.getByText(description).className).toContain("text-[#586c88]");
  }

  expect(view.container.querySelector("form")).toBeNull();
  expect(
    view.container.querySelectorAll(
      "input, [role='checkbox'], [role='switch'], [aria-checked], [aria-pressed], [data-state]"
    )
  ).toHaveLength(0);

  const archiveButton = view.getByRole("button", {
    name: strings.archiveAction,
  });
  const archiveRow = view.getByRole("heading", {
    name: strings.archiveTitle,
  }).parentElement?.parentElement;
  if (!archiveRow) throw new Error("Archive row was not rendered");
  expect(archiveRow.className).toContain("lg:flex-row");
  expect(archiveRow.className).not.toContain("sm:flex-row");
  expect(archiveButton.className).toContain("lg:text-center");
  expect(archiveButton.className).not.toContain("sm:text-center");
  expect(archiveButton.getAttribute("href")).toBeNull();
  expect(archiveButton.getAttribute("download")).toBeNull();
  expect(view.container.querySelectorAll("button[type='submit']")).toHaveLength(
    0
  );
  expect(
    view
      .getByRole("button", { name: strings.savePreferences })
      .getAttribute("aria-describedby")
  ).toBe(descriptionId);
  expect(archiveButton.querySelector("svg")?.getAttribute("aria-hidden")).toBe(
    "true"
  );
});
