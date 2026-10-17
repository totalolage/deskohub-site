import { afterAll, afterEach, beforeAll, expect, mock, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import "@/shared/testing/workspace-component-module-mocks";
import { RouteLocaleProvider } from "@/features/i18n/route-locale";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

mock.module("next/navigation", () => ({
  useParams: () => ({ locale: "en-US" }),
}));

const { SentRecipientTable } = await import("./sent-recipient-table");

const skippedRecipient = {
  dotyposCustomerId: "synthetic-skipped",
  locale: "en-US",
  status: "skipped",
  skipReason: "consent-withdrawn",
  statusUpdatedAt: "2026-10-14T08:00:00Z",
  statusSince: "14. 10. 2026 10:00",
} as const;

beforeAll(() => registerWorkspaceComponentTestEnv());
afterEach(() => cleanup());
afterAll(() => unregisterWorkspaceComponentTestEnv());

test("shows unconfirmed recipients and why skipped recipients weren't mailed", () => {
  const view = render(
    <SentRecipientTable
      recipients={[
        {
          dotyposCustomerId: "synthetic-unconfirmed",
          locale: "cs-CZ",
          status: "unconfirmed",
          skipReason: null,
          statusUpdatedAt: "2026-10-14T08:00:00Z",
          statusSince: "Oct 14, 2026, 10:00 AM",
        },
        {
          dotyposCustomerId: "synthetic-skipped",
          locale: "en-US",
          status: "skipped",
          skipReason: "consent-withdrawn",
          statusUpdatedAt: "2026-10-14T08:00:00Z",
          statusSince: "Oct 14, 2026, 10:00 AM",
        },
      ]}
    />
  );

  expect(view.getAllByText("Unconfirmed").length).toBeGreaterThan(0);
  expect(view.getAllByText("Skipped").length).toBeGreaterThan(0);
  expect(
    view.getAllByText(/Marketing consent withdrawn/).length
  ).toBeGreaterThan(0);
});

test("labels recipients in the Czech admin locale", () => {
  const view = render(
    <RouteLocaleProvider locale="cs-CZ">
      <SentRecipientTable recipients={[skippedRecipient]} />
    </RouteLocaleProvider>
  );

  expect(
    view.getAllByText("Odvolaný marketingový souhlas").length
  ).toBeGreaterThan(0);
  expect(view.getByText("Angličtina · od 14. 10. 2026 10:00")).toBeTruthy();
  expect(
    view.getByText("Přeskočeno: Odvolaný marketingový souhlas")
  ).toBeTruthy();
});
