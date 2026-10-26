import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { RouteLocaleProvider } from "@/features/i18n/route-locale";
import {
  workspaceRouterPush,
  workspaceRouterRefresh,
} from "@/shared/testing/workspace-component-module-mocks";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import { campaignIdSchema } from "../../campaign-identifiers";
import { captureCampaignOperations } from "../campaign-operation-actions.test-utils";

mock.module("next/navigation", () => ({
  useParams: () => ({ locale: "en-US" }),
  useRouter: () => ({
    push: workspaceRouterPush,
    refresh: workspaceRouterRefresh,
  }),
}));

mock.module("../campaign-operations.actions", () => ({
  runCampaignOperation: mock(),
}));

const { SentCampaignActions } = await import("./sent-campaign-actions");

const campaignId = campaignIdSchema.make("synthetic-campaign");
const includeUnconfirmedLabel =
  "Also resend to unconfirmed recipients (they may receive it twice)";
const operations = captureCampaignOperations();
const retryLabels = {
  "en-US": "Retry undelivered",
  "cs-CZ": "Znovu odeslat nedoručeným",
} as const;
const retry = (
  view: ReturnType<typeof render>,
  locale: keyof typeof retryLabels = "en-US"
) => fireEvent.click(view.getByRole("button", { name: retryLabels[locale] }));

describe("SentCampaignActions", () => {
  beforeAll(() => registerWorkspaceComponentTestEnv());
  beforeEach(() => operations.install());
  afterEach(() => cleanup());
  afterAll(() => unregisterWorkspaceComponentTestEnv());

  test("retries without unconfirmed recipients by default", () => {
    const view = render(
      <SentCampaignActions
        campaignId={campaignId}
        retryable
        unconfirmedCount={2}
      />
    );

    expect(
      view
        .getByRole("checkbox", { name: includeUnconfirmedLabel })
        .getAttribute("aria-checked")
    ).toBe("false");
    retry(view);

    expect(operations.requests("retryCampaign")).toEqual([
      {
        operation: "retryCampaign",
        input: { campaignId, includeUnconfirmed: false },
      },
    ]);
  });

  test("includes unconfirmed recipients once the admin opts in", () => {
    const view = render(
      <SentCampaignActions
        campaignId={campaignId}
        retryable
        unconfirmedCount={2}
      />
    );

    fireEvent.click(
      view.getByRole("checkbox", { name: includeUnconfirmedLabel })
    );
    retry(view);

    expect(operations.requests("retryCampaign")).toEqual([
      {
        operation: "retryCampaign",
        input: { campaignId, includeUnconfirmed: true },
      },
    ]);
  });

  test("offers the unconfirmed option only when a retry can reach them", () => {
    const withoutUnconfirmed = render(
      <SentCampaignActions
        campaignId={campaignId}
        retryable
        unconfirmedCount={0}
      />
    );
    expect(withoutUnconfirmed.queryByText(includeUnconfirmedLabel)).toBeNull();
    cleanup();

    const notRetryable = render(
      <SentCampaignActions
        campaignId={campaignId}
        retryable={false}
        unconfirmedCount={2}
      />
    );
    expect(notRetryable.queryByText(includeUnconfirmedLabel)).toBeNull();
    expect(
      notRetryable.queryByRole("button", { name: "Retry undelivered" })
    ).toBeNull();
  });

  test.each([
    ["en-US", "Retrying 1,000 undelivered recipients."],
    [
      "cs-CZ",
      "Znovu odesíláme e-mail 1\u00a0000 příjemcům, kterým se ho nepodařilo doručit.",
    ],
  ] as const)(
    "reports a %s retry with the count grouped",
    (locale, message) => {
      const view = render(
        <RouteLocaleProvider locale={locale}>
          <SentCampaignActions
            campaignId={campaignId}
            retryable
            unconfirmedCount={0}
          />
        </RouteLocaleProvider>
      );

      retry(view, locale);
      operations.respond("retryCampaign", {
        _tag: "Success",
        output: { retriedCount: 1000 },
      });

      expect(view.container.textContent).toContain(message);
    }
  );

  test.each([
    [
      "campaign-not-retryable",
      "Only a failed campaign can retry undelivered recipients.",
    ],
    ["service-unavailable", "Something went wrong. Try again in a moment."],
    ["a-code-without-copy", "Undelivered recipients could not be retried."],
  ] as const)("reports a %s failure in admin copy", (code, message) => {
    const view = render(
      <SentCampaignActions
        campaignId={campaignId}
        retryable
        unconfirmedCount={0}
      />
    );

    retry(view);
    operations.respond("retryCampaign", {
      _tag: "Failure",
      category: "OperationConflict",
      code,
      message: "English port message",
    });

    expect(view.container.textContent).toContain(message);
    expect(view.container.textContent).not.toContain("English port message");
  });

  test("labels the actions in the Czech admin locale", () => {
    const view = render(
      <RouteLocaleProvider locale="cs-CZ">
        <SentCampaignActions
          campaignId={campaignId}
          retryable
          unconfirmedCount={2}
        />
      </RouteLocaleProvider>
    );

    expect(
      view.getByRole("button", { name: "Znovu odeslat nedoručeným" })
    ).toBeTruthy();
    expect(view.getByRole("button", { name: "Duplikovat" })).toBeTruthy();
    expect(
      view.getByRole("checkbox", {
        name: "Poslat znovu i nepotvrzeným příjemcům (mohou ho dostat dvakrát)",
      })
    ).toBeTruthy();
  });
});
