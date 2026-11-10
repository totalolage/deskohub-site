import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { m } from "@/features/administration/i18n";
import { RouteLocaleProvider } from "@/features/i18n/route-locale";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import { campaignLocaleName } from "./campaign-locale-names";
import { SentCampaignEmailPreview } from "./sent-campaign-email-preview";

const locale = "en-US";
const czechEmail = {
  locale: "cs-CZ",
  subject: "Podzimní novinky",
  preheader: "Co je nového v Deskohubu",
  html: "<p>Ahoj</p>",
} as const;
const englishEmail = {
  locale: "en-US",
  subject: "Autumn news",
  preheader: "What's new at Deskohub",
  html: undefined,
} as const;

beforeAll(() => registerWorkspaceComponentTestEnv());
afterEach(() => cleanup());
afterAll(() => unregisterWorkspaceComponentTestEnv());

const renderPreview = (
  emails: Parameters<typeof SentCampaignEmailPreview>[0]["emails"]
) =>
  render(
    <RouteLocaleProvider locale={locale}>
      <SentCampaignEmailPreview emails={emails} />
    </RouteLocaleProvider>
  );

test("shows nothing when no email was rendered for the send", () => {
  const view = renderPreview([]);

  expect(view.container.childElementCount).toBe(0);
});

test("shows the first locale's rendered email without an error", () => {
  const view = renderPreview([czechEmail, englishEmail]);

  expect(view.getByText(czechEmail.subject)).toBeTruthy();
  expect(view.container.querySelector("iframe")?.getAttribute("srcdoc")).toBe(
    czechEmail.html
  );
  expect(view.getByRole("alert").textContent).toBe("");
});

test("switches locales and reports an email that couldn't be rendered", () => {
  const view = renderPreview([czechEmail, englishEmail]);

  fireEvent.click(
    view.getByRole("radio", { name: campaignLocaleName("en-US") })
  );

  expect(view.getByText(englishEmail.subject)).toBeTruthy();
  expect(view.container.querySelector("iframe")).toBeNull();
  expect(view.getByRole("alert").textContent).toBe(
    m.emailCampaignsSentEmailRenderFailed({}, { locale })
  );
  expect(
    view.getByText(m.emailCampaignsSentEmailNoPreview({}, { locale }))
  ).toBeTruthy();
});
