import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { useForm, useWatch } from "react-hook-form";
import type { Locale } from "@/features/i18n";
import csCzCatalog from "@/features/i18n/messages/cs-CZ.json" with {
  type: "json",
};
import enUsCatalog from "@/features/i18n/messages/en-US.json" with {
  type: "json",
};
import { Form } from "@/shared/components/ui/form";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import { ReservationMarketingConsentField } from "./reservation-marketing-consent-field";
import { ReservationPrivacyNotice } from "./reservation-privacy-notice";

const catalogs = {
  "en-US": enUsCatalog as Record<string, string>,
  "cs-CZ": csCzCatalog as Record<string, string>,
};

const copyWithoutInterpolationTags = (copy: string, tag: string) =>
  copy.replaceAll(`<${tag}>`, "").replaceAll(`</${tag}>`, "");

const interpolatedLinkLabel = (copy: string, tag: string) => {
  const match = new RegExp(`<${tag}>(.*?)</${tag}>`).exec(copy);
  expect(match).not.toBeNull();
  return match?.[1] ?? "";
};

const focusableSelector =
  'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])';

const legalCards = (view: ReturnType<typeof render>, locale: Locale) => {
  const catalog = catalogs[locale];
  return [
    interpolatedLinkLabel(catalog.reservationPrivacyNote, "privacyPolicy"),
    interpolatedLinkLabel(
      catalog.reservationMarketingConsent,
      "marketingConsent"
    ),
  ].map((name) => view.getByRole("link", { name }).closest("label, div"));
};

const LegalCardsHarness = ({ locale }: { readonly locale: Locale }) => {
  const form = useForm<{ readonly marketingConsent: boolean }>({
    defaultValues: { marketingConsent: false },
  });
  const marketingConsent = useWatch({
    control: form.control,
    name: "marketingConsent",
  });

  return (
    <Form {...form}>
      <ReservationPrivacyNotice locale={locale} />
      <ReservationMarketingConsentField locale={locale} />
      <output data-testid="marketing-consent-value">
        {String(marketingConsent)}
      </output>
    </Form>
  );
};

describe("reservation form legal cards", () => {
  beforeAll(() => {
    registerWorkspaceComponentTestEnv();
  });

  afterEach(() => {
    cleanup();
  });

  afterAll(async () => {
    await unregisterWorkspaceComponentTestEnv();
  });

  test("privacy exposes no form control and only marketing is a checkbox", () => {
    for (const locale of ["en-US", "cs-CZ"] as const) {
      const view = render(<LegalCardsHarness locale={locale} />);

      const checkboxes = view.getAllByRole("checkbox");
      expect(checkboxes).toHaveLength(1);

      const cards = legalCards(view, locale);
      expect(cards[0]?.querySelector('[role="checkbox"]')).toBeNull();
      expect(cards[1]?.querySelector('[role="checkbox"]')).toBe(checkboxes[0]);

      const privacyIcon = view.container.querySelector(
        "svg[aria-hidden='true']"
      ) as SVGElement;
      expect(privacyIcon).not.toBeNull();
      expect(privacyIcon.getAttribute("role")).not.toBe("checkbox");
      expect(privacyIcon.getAttribute("aria-hidden")).toBe("true");
      expect(privacyIcon.getAttribute("focusable")).toBe("false");
      expect(privacyIcon.matches(focusableSelector)).toBe(false);
      expect(privacyIcon.tabIndex).toBeLessThan(0);

      const focusable = [...view.container.querySelectorAll(focusableSelector)];
      expect(focusable.some((element) => element === privacyIcon)).toBe(false);
      expect(focusable.some((element) => element.contains(privacyIcon))).toBe(
        false
      );
      expect(focusable).toContain(checkboxes[0]);
      cleanup();
    }
  });

  test("marketing is a labeled real checkbox, initially unchecked and togglable", () => {
    for (const locale of ["en-US", "cs-CZ"] as const) {
      const view = render(<LegalCardsHarness locale={locale} />);
      const catalog = catalogs[locale];

      const marketing = view.getByRole("checkbox", {
        name: (_accessibleName, element) =>
          element.id === "reservation-marketing-consent" &&
          (element.closest("label")?.textContent ?? "") ===
            copyWithoutInterpolationTags(
              catalog.reservationMarketingConsent,
              "marketingConsent"
            ),
      });
      expect(marketing.getAttribute("aria-checked")).toBe("false");
      expect(marketing.getAttribute("data-state")).toBe("unchecked");
      expect(view.getByTestId("marketing-consent-value").textContent).toBe(
        "false"
      );

      fireEvent.click(marketing);
      expect(marketing.getAttribute("aria-checked")).toBe("true");
      expect(marketing.getAttribute("data-state")).toBe("checked");
      expect(view.getByTestId("marketing-consent-value").textContent).toBe(
        "true"
      );
      cleanup();
    }
  });

  test("renders each locale's complete copy around its linked text", () => {
    for (const locale of ["en-US", "cs-CZ"] as const) {
      const catalog = catalogs[locale];
      const view = render(<LegalCardsHarness locale={locale} />);
      const cards = legalCards(view, locale);
      const privacyCopy = catalog.reservationPrivacyNote;
      const marketingCopy = catalog.reservationMarketingConsent;
      const privacyLinkLabel = interpolatedLinkLabel(
        privacyCopy,
        "privacyPolicy"
      );
      const marketingLinkLabel = interpolatedLinkLabel(
        marketingCopy,
        "marketingConsent"
      );

      expect(cards[0]?.textContent).toBe(
        copyWithoutInterpolationTags(privacyCopy, "privacyPolicy")
      );
      expect(cards[1]?.textContent).toBe(
        copyWithoutInterpolationTags(marketingCopy, "marketingConsent")
      );

      expect(
        view
          .getByRole("link", {
            name: privacyLinkLabel,
          })
          .getAttribute("href")
      ).toBe(`/${locale}/privacy-policy`);
      expect(
        view
          .getByRole("link", {
            name: marketingLinkLabel,
          })
          .getAttribute("href")
      ).toBe(`/${locale}/marketing-communications`);
      cleanup();
    }
  });
});
