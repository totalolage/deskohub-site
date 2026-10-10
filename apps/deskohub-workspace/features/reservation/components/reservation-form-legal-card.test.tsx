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
import { ReservationFormLegalCard } from "./reservation-form-legal-card";
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

const chromeNeedle = "rounded-[1.35rem]";
const focusableSelector =
  'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])';

const legalCards = (view: { container: HTMLElement }) =>
  [...view.container.querySelectorAll("div")].filter((element) =>
    element.className.includes(chromeNeedle)
  );

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

      const cards = legalCards(view);
      expect(cards).toHaveLength(2);
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

  test("both rows share legal-card chrome and matched indicator alignment", () => {
    const view = render(<LegalCardsHarness locale="en-US" />);

    const cards = legalCards(view);
    expect(cards).toHaveLength(2);
    for (const card of cards) {
      expect(card.className).toContain(chromeNeedle);
      expect(card.className).toContain("border-navy-blue/10");
      expect(card.className).toContain("bg-navy-blue/2.5");
      expect(card.className).toContain("p-4");
      expect(card.className).toContain("flex");
      expect(card.className).toContain("items-start");
      expect(card.className).toContain("gap-3");

      const indicatorSlot = card.firstElementChild as HTMLElement;
      expect(indicatorSlot.className).toContain("mt-1");
      expect(indicatorSlot.className).toContain("shrink-0");

      const contentSlot = card.lastElementChild as HTMLElement;
      expect(contentSlot.className).toContain("text-sm");
      expect(contentSlot.className).toContain("leading-6");
      expect(contentSlot.className).toContain("text-navy-blue/66");
    }

    const sharedCardView = render(
      <ReservationFormLegalCard indicator={<span data-indicator="" />}>
        <span data-content="">Content</span>
      </ReservationFormLegalCard>
    );
    const sharedCard = legalCards(sharedCardView)[0];
    expect(sharedCard.className).toBe(cards[0]?.className);
    expect(sharedCard.firstElementChild?.className).toBe(
      cards[0]?.firstElementChild?.className
    );
    expect(sharedCard.lastElementChild?.className).toBe(
      cards[0]?.lastElementChild?.className
    );
  });

  test("renders each locale's complete copy around its linked text", () => {
    for (const locale of ["en-US", "cs-CZ"] as const) {
      const catalog = catalogs[locale];
      const view = render(<LegalCardsHarness locale={locale} />);
      const cards = legalCards(view);
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
