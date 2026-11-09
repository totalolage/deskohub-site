import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { m } from "@/features/administration/i18n";
import type { Locale } from "@/features/i18n";
import { RouteLocaleProvider } from "@/features/i18n/route-locale";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import { automationRunFixture } from "./automation-run.test-utils";

registerWorkspaceComponentTestEnv();
// @testing-library/react must load after the happy-dom registration.
const { cleanup, render, within } = await import("@testing-library/react");
const { AutomationRunCustomer, automationRunContactsUnavailable } =
  await import("./automation-run-customer");

afterEach(cleanup);
afterAll(unregisterWorkspaceComponentTestEnv);

const customerId = "synthetic-run-customer";
const customerName = "Taylor Customer";
const customerEmail = testEmailAddress("automation-run-customer");

const renderCustomer = (
  run: ReturnType<typeof automationRunFixture>,
  locale: Locale = "en-US",
  showId = false
) =>
  render(
    <RouteLocaleProvider locale={locale}>
      <AutomationRunCustomer locale={locale} run={run} showId={showId} />
    </RouteLocaleProvider>
  );

describe("AutomationRunCustomer", () => {
  test.each(["en-US", "cs-CZ"] as const)(
    "links a found name and email in %s",
    (locale) => {
      const view = renderCustomer(
        automationRunFixture({
          customerId,
          customerName,
          customerEmail,
        }),
        locale
      );

      expect(within(view.container).getAllByRole("link")).toHaveLength(1);
      const link = within(view.container).getByRole("link");
      expect(link.textContent).toBe(customerName);
      expect(link.getAttribute("href")).toBe(
        `/${locale}/admin/customers/${customerId}`
      );
      expect(view.container.textContent).toContain(customerEmail);
      expect(view.container.textContent).not.toContain(customerId);
    }
  );

  test("uses the email as the link text when the name is absent", () => {
    const email = testEmailAddress("automation-run-email-only");
    const view = renderCustomer(
      automationRunFixture({
        customerId,
        customerName: null,
        customerEmail: email,
      })
    );

    expect(within(view.container).getByRole("link").textContent).toBe(email);
    expect(view.container.textContent).not.toContain(customerId);
  });

  test("uses only the name when the email is absent", () => {
    const view = renderCustomer(
      automationRunFixture({
        customerId,
        customerName,
        customerEmail: null,
      })
    );

    expect(within(view.container).getByRole("link").textContent).toBe(
      customerName
    );
    expect(view.container.textContent).toBe(customerName);
  });

  test("uses the customer ID without a note when both profile fields are absent", () => {
    const view = renderCustomer(
      automationRunFixture({
        customerId,
        customerName: null,
        customerEmail: null,
      })
    );

    expect(within(view.container).getByRole("link").textContent).toBe(
      customerId
    );
    expect(view.container.querySelector("span")).toBeNull();
  });

  test.each(["en-US", "cs-CZ"] as const)(
    "shows the profile note in %s when Dotypos has no profile or is unavailable",
    (locale) => {
      const cases = [
        {
          status: "not-found",
          note: m.emailAutomationRunsCustomerProfileNotFound({}, { locale }),
        },
        {
          status: "unavailable",
          note: m.emailAutomationRunsCustomerProfileUnavailable({}, { locale }),
        },
      ] as const;

      for (const { status, note } of cases) {
        const view = renderCustomer(
          automationRunFixture({
            customerId,
            customerName: null,
            customerEmail: null,
            customerProfileStatus: status,
          }),
          locale
        );

        expect(within(view.container).getByRole("link").textContent).toBe(
          customerId
        );
        expect(within(view.container).getByText(note).textContent).toBe(note);
      }
    }
  );

  test("shows the ID under a found name when requested", () => {
    const view = renderCustomer(
      automationRunFixture({
        customerId,
        customerName,
        customerEmail: null,
      }),
      "en-US",
      true
    );

    expect(within(view.container).getByRole("link").textContent).toBe(
      customerName
    );
    expect(
      within(view.container).getByText(customerId, { exact: true }).tagName
    ).toBe("SPAN");
  });

  test("encodes a customer ID in the localized link", () => {
    const encodedId = "a/b c";
    const view = renderCustomer(
      automationRunFixture({
        customerId: encodedId,
        customerName,
        customerEmail: null,
      }),
      "cs-CZ"
    );

    expect(within(view.container).getByRole("link").getAttribute("href")).toBe(
      "/cs-CZ/admin/customers/a%2Fb%20c"
    );
  });
});

describe("automationRunContactsUnavailable", () => {
  test("returns true only when at least one run is unavailable", () => {
    const found = automationRunFixture({ customerProfileStatus: "found" });
    const notFound = automationRunFixture({
      customerProfileStatus: "not-found",
    });
    const unavailable = automationRunFixture({
      customerProfileStatus: "unavailable",
    });

    expect(automationRunContactsUnavailable([])).toBe(false);
    expect(automationRunContactsUnavailable([found, notFound])).toBe(false);
    expect(automationRunContactsUnavailable([found, unavailable])).toBe(true);
  });
});
