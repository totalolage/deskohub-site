import type { Client } from "@modelcontextprotocol/client";
import { type BrowserContext, expect, type Page } from "@playwright/test";
import { Effect, Schema } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import { customerAgentTestClientMetadata } from "@/features/account/customer-agent-test-client";
import { getAccountSectionPath } from "@/features/account/routes";
import { type Locale, m } from "@/features/i18n";
import { workspaceReservationIdSchema } from "@/features/reservation/persistence-contracts";
import {
  makeWorkspaceE2ECaseIdentities,
  type WorkspaceE2ECaseIdentities,
} from "../account/case-identities";
import type { WorkspaceE2EAccountJournalOwner } from "../account/reconcile";
import { resolveWorkspaceE2ESessionSigningSecret } from "../account/seeded-session";
import type { WorkspaceE2EDateAllocation } from "../allocation";
import { openBrowserPage, waitForBrowserUrl } from "../browser";
import {
  makeCoworkCheckoutData,
  requireCheckoutDate,
  selectCoworkDates,
} from "../checkout/data";
import { waitForReservationPayPage } from "../checkout/payment";
import {
  type DatasourceConfig,
  getConfig,
  getDatasourceConfig,
  type WorkspaceE2EConfig,
} from "../config";
import {
  customerAgentRequestedScopes,
  isCustomerAgentCallbackUrl,
  isCustomerAgentConsentUrl,
  localizeCustomerAgentConsentUrl,
  readCustomerAgentCallback,
} from "../customer-agent/authorization";
import {
  type CustomerAgentAuthorizationServer,
  callCustomerMcpTool,
  connectCustomerMcp,
  discoverCustomerAgentAuthorization,
  exchangeCustomerAgentCode,
  expectCustomerMcpRejection,
  startCustomerAgentAuthorization,
} from "../customer-agent/mcp";
import {
  toWorkspaceE2EError,
  tryWorkspaceE2EPromise,
  tryWorkspaceE2ESync,
  type WorkspaceE2EError,
  workspaceE2EError,
} from "../errors";
import type { E2EDatabase } from "../integrations/database.service";
import type { WorkspaceE2ECaseBinder } from "../playwright-checkout/fixtures";
import { pollUntil } from "../polling";
import { waitForReactClickHandler } from "../react-handlers";
import { bindCheckoutContact } from "../referrals/checkout";
import { addRedaction, assert, parseUrl, type Runner } from "../runtime";
import { workspaceE2EPollIntervalMs } from "../timeouts";
import type {
  CheckoutFlowState,
  WorkspaceE2ECase,
  WorkspaceE2EStepRunner,
} from "../types";
import { executeCheckoutFlow } from "./checkout";

export const agentBookingCaseId = "checkout-agent-booking";

const agentBookerLabel = "agent-booker";

type AgentBookerLabel = typeof agentBookerLabel;

/**
 * The case's own identity journal: the account the agent books for. The
 * agent's consents and tokens belong to that account, so reconciling the
 * journal also removes its grants. The agent's client, registered from its
 * Client ID Metadata Document, is shared by every run and stays.
 */
export const agentBookingJournalOwner: WorkspaceE2EAccountJournalOwner = {
  ownerId: agentBookingCaseId,
  recipientLabels: [agentBookerLabel],
};

/**
 * Plans the agent booking on its own open-space date, after every other case
 * has planned its dates. The case pool binds the seeded account before the
 * case runs.
 */
export const planAgentBookingCase = ({
  allocation,
  availableBasicDates,
  config,
  flowStates,
}: {
  readonly allocation: WorkspaceE2EDateAllocation;
  readonly availableBasicDates: readonly string[];
  readonly config: WorkspaceE2EConfig;
  readonly flowStates: CheckoutFlowState[];
}): Effect.Effect<WorkspaceE2ECase, WorkspaceE2EError> =>
  Effect.gen(function* () {
    const dates = yield* selectCoworkDates(availableBasicDates, 1, {
      allocation,
      excludedDates: new Set(flowStates.map(({ data }) => data.date)),
      selectionLabel: "agent booking",
    });
    const state: CheckoutFlowState = {
      data: makeCoworkCheckoutData(
        config.baseUrl,
        yield* requireCheckoutDate(dates, 0),
        agentBookingCaseId
      ),
    };
    flowStates.push(state);
    return {
      checkoutStates: [state],
      execute: () =>
        Effect.fail(
          workspaceE2EError(
            `${agentBookingCaseId} must be bound to its seeded account by the case pool`,
            { operation: "bind agent booking case" }
          )
        ),
      id: agentBookingCaseId,
      // Checkout plus two consent rounds and the agent's MCP calls.
      timeoutMs: config.timeouts.checkoutCase + config.timeouts.customerMcpCase,
    };
  });

/**
 * Binds the planned case to its seeded account: an AI agent the account
 * connects through OAuth books the reservation for the account over MCP, and
 * the customer pays it in the browser.
 */
export const bindAgentBookingCase: WorkspaceE2ECaseBinder = async ({
  browser,
  environment,
  run,
  runId,
  testCase,
}) => {
  if (testCase.id !== agentBookingCaseId) return testCase;
  const [state] = testCase.checkoutStates;
  if (!state || testCase.checkoutStates.length !== 1) {
    throw new Error("planned agent booking checkout is incomplete");
  }
  const config = getConfig(environment);
  const datasourceConfig = getDatasourceConfig(environment);
  const identities = makeWorkspaceE2ECaseIdentities<AgentBookerLabel>({
    baseUrl: config.baseUrl,
    datasourceConfig,
    displayName: () => "Workspace E2E Agent Booker",
    journalOwnerId: agentBookingCaseId,
    run,
    runId,
    secret: resolveWorkspaceE2ESessionSigningSecret(environment),
  });
  // The agent books as the account, so the order carries its contact.
  const boundState: CheckoutFlowState = {
    data: bindCheckoutContact(
      state.data,
      identities.describe(agentBookerLabel)
    ),
  };
  const context = () => {
    const [only] = browser.contexts();
    if (!only || browser.contexts().length !== 1) {
      throw new Error("agent booking case has no single owned context");
    }
    return only;
  };
  return {
    ...testCase,
    checkoutStates: [boundState],
    execute: ({ runStep, session }) =>
      executeAgentBooking({
        config,
        context,
        datasourceConfig,
        identities,
        run,
        runStep,
        session,
        state: boundState,
      }).pipe(
        Effect.scoped,
        Effect.provide(FetchHttpClient.layer),
        Effect.mapError((cause) =>
          toWorkspaceE2EError("run agent booking e2e case", cause)
        )
      ),
  };
};

type AgentBookingContext = {
  readonly config: WorkspaceE2EConfig;
  /** The case session's browser context, for routing and native locators. */
  readonly context: () => BrowserContext;
  readonly datasourceConfig: DatasourceConfig;
  readonly identities: WorkspaceE2ECaseIdentities<AgentBookerLabel>;
  readonly run: Runner;
  readonly runStep: WorkspaceE2EStepRunner;
  readonly session: string;
  readonly state: CheckoutFlowState;
};

const executeAgentBooking = Effect.fn("AgentBooking.execute")(function* (
  booking: AgentBookingContext
) {
  const { config, identities, runStep, session } = booking;
  const booker = yield* runStep({
    execute: identities.seedLinkedAccount(agentBookerLabel),
    id: "seed-agent-booker",
    timeoutMs: config.timeouts.datasource,
  });
  yield* runStep({
    execute: identities.signIn(booker, session),
    id: "sign-in-agent-booker",
    timeoutMs: config.timeouts.datasource,
  });
  yield* runStep({
    execute: answerAgentRedirectInBrowser(booking.context),
    id: "answer-agent-redirect-in-browser",
    timeoutMs: config.timeouts.browserAction,
  });
  // The challenge comes first, as for a real agent. The agent's client ID
  // is the URL of its metadata document on the production host, which the
  // deployment's OAuth server fetches when it first looks the agent up.
  const server = yield* runStep({
    execute: discoverCustomerAgentAuthorization(config),
    id: "discover-agent-authorization",
    timeoutMs: config.timeouts.customerMcpRequest,
  });

  const denied = yield* runStep({
    execute: answerAgentConsent({
      answer: "deny",
      booking,
      locale: "cs-CZ",
      server,
    }),
    id: "deny-agent-consent-cs-CZ",
    timeoutMs: config.timeouts.customerAgentConsent,
  });
  yield* tryWorkspaceE2ESync("read denied agent authorization", () =>
    assert(
      denied.callback.kind === "error" &&
        denied.callback.error === "access_denied",
      "Denying the agent did not answer access_denied"
    )
  );

  const allowed = yield* runStep({
    execute: answerAgentConsent({
      answer: "allow",
      booking,
      locale: booking.state.data.locale,
      server,
    }),
    id: `allow-agent-consent-${booking.state.data.locale}`,
    timeoutMs: config.timeouts.customerAgentConsent,
  });
  const accessToken = yield* runStep({
    execute: Effect.gen(function* () {
      const { callback, request } = allowed;
      if (callback.kind !== "code") {
        return yield* workspaceE2EError(
          `Allowing the agent answered ${callback.error} instead of a code`,
          { operation: "read allowed agent authorization" }
        );
      }
      return yield* exchangeCustomerAgentCode({
        clientId: customerAgentTestClientMetadata.client_id,
        code: callback.code,
        config,
        iss: callback.iss,
        request,
        server,
      });
    }),
    id: "exchange-agent-code",
    timeoutMs: config.timeouts.customerMcpRequest,
  });
  const mcp = yield* runStep({
    execute: connectCustomerMcp({ accessToken, config }),
    id: "connect-agent-mcp-client",
    timeoutMs: config.timeouts.customerMcpRequest,
  });
  yield* runStep({
    execute: verifyAgentBookingView({
      config,
      locale: booking.state.data.locale,
      mcp,
    }),
    id: "open-agent-booking-view",
    timeoutMs: config.timeouts.customerMcpRequest,
  });

  yield* executeCheckoutFlow({
    afterFulfillment: (orderId) =>
      verifyAgentReservationReads({ booking, mcp, orderId }),
    config,
    data: booking.state.data,
    datasourceConfig: booking.datasourceConfig,
    flow: {
      id: "agent-booking",
      startReservation: startAgentReservation({ booking, mcp }),
    },
    run: booking.run,
    runStep,
    session,
    state: booking.state,
  });

  // Disconnecting the agent from the account revokes its token at once.
  yield* runStep({
    execute: disconnectAgentInAccount(booking),
    id: "disconnect-agent-in-account",
    timeoutMs: config.timeouts.customerAgentConsent,
  });
  yield* runStep({
    execute: expectCustomerMcpRejection({ accessToken, config }),
    id: "reject-disconnected-agent",
    timeoutMs: config.timeouts.customerMcpRequest,
  });
});

/**
 * The customer disconnects the agent under Connected assistants in their
 * account and confirms it.
 */
const disconnectAgentInAccount = Effect.fn("AgentBooking.disconnect")(
  function* ({ config, context, run, session, state }: AgentBookingContext) {
    const { locale } = state.data;
    yield* openBrowserPage(
      config,
      run,
      session,
      new URL(
        getAccountSectionPath(locale, "assistants"),
        config.baseUrl
      ).toString(),
      { timeoutMs: config.timeouts.browserNavigation }
    );
    yield* tryWorkspaceE2EPromise("disconnect agent in account", async () => {
      const page = singlePage(context());
      const disconnect = page.getByRole("button", {
        exact: true,
        name: m.accountAssistantDisconnectLabel(
          { name: customerAgentTestClientMetadata.client_name },
          { locale }
        ),
      });
      await waitForReactClickHandler(page, disconnect);
      await disconnect.click({ timeout: config.timeouts.browserAction });
      await page
        .getByRole("dialog")
        .getByRole("button", {
          exact: true,
          name: m.accountAssistantDisconnectConfirm({}, { locale }),
        })
        .click({ timeout: config.timeouts.browserAction });
      await expect(page.locator("#account-assistants-status")).not.toBeEmpty({
        timeout: config.timeouts.uiTransition,
      });
      await expect(disconnect).toHaveCount(0, {
        timeout: config.timeouts.uiTransition,
      });
    });
  }
);

/**
 * The agent's redirect URI never resolves; the case's browser context
 * answers it with an empty page, so the authorization response stays
 * readable in the address bar without leaving the runner.
 */
const answerAgentRedirectInBrowser = (context: () => BrowserContext) =>
  tryWorkspaceE2EPromise("answer agent redirect in browser", () =>
    context().route(
      (url) => isCustomerAgentCallbackUrl(url.toString()),
      (route) =>
        route.fulfill({
          body: "<!doctype html><title>Agent callback</title>",
          contentType: "text/html",
          status: 200,
        })
    )
  );

const consentScopeLabels = {
  offline_access: m.customerAgentScopeOfflineAccess,
  "reservations:create": m.customerAgentScopeReservationsCreate,
  "reservations:read": m.customerAgentScopeReservationsRead,
} as const satisfies Record<
  (typeof customerAgentRequestedScopes)[number],
  (inputs: Record<string, never>, options: { locale: Locale }) => string
>;

/**
 * One authorization round: the agent sends the signed-in customer to the
 * authorize endpoint, the consent page names the agent and what it asks
 * for in the customer's locale, and the customer allows or denies it.
 */
const answerAgentConsent = ({
  answer,
  booking: { config, context, run, session },
  locale,
  server,
}: {
  readonly answer: "allow" | "deny";
  readonly booking: AgentBookingContext;
  readonly locale: Locale;
  readonly server: CustomerAgentAuthorizationServer;
}) =>
  Effect.gen(function* () {
    const request = yield* startCustomerAgentAuthorization({
      clientId: customerAgentTestClientMetadata.client_id,
      config,
      server,
    });
    yield* openBrowserPage(config, run, session, request.authorizationUrl, {
      timeoutMs: config.timeouts.browserNavigation,
    });
    const consentUrl = yield* waitForBrowserUrl({
      description: "customer agent consent page",
      matches: (url) => isCustomerAgentConsentUrl(url, config.baseUrl),
      run,
      session,
      timeoutMs: config.timeouts.uiTransition,
    });
    const localizedConsentUrl = localizeCustomerAgentConsentUrl(
      consentUrl,
      locale
    );
    if (localizedConsentUrl !== consentUrl) {
      yield* openBrowserPage(config, run, session, localizedConsentUrl, {
        timeoutMs: config.timeouts.browserNavigation,
      });
    }
    yield* tryWorkspaceE2EPromise(`${answer} agent consent`, async () => {
      const page = singlePage(context());
      expect(new URL(page.url()).pathname).toBe(
        new URL(localizedConsentUrl).pathname
      );
      await expect(
        page.getByRole("heading", {
          exact: true,
          level: 1,
          name: m.customerAgentConsentTitle(
            { client: customerAgentTestClientMetadata.client_name },
            { locale }
          ),
        })
      ).toBeVisible({ timeout: config.timeouts.uiTransition });
      for (const scope of customerAgentRequestedScopes) {
        await expect(
          page.getByRole("listitem").filter({
            hasText: consentScopeLabels[scope]({}, { locale }),
          })
        ).toBeVisible({ timeout: config.timeouts.browserAction });
      }
      const button = page.getByRole("button", {
        exact: true,
        name:
          answer === "allow"
            ? m.customerAgentConsentAllow({}, { locale })
            : m.customerAgentConsentDeny({}, { locale }),
      });
      await waitForReactClickHandler(page, button);
      await button.click({ timeout: config.timeouts.browserAction });
    });
    const callbackUrl = yield* waitForBrowserUrl({
      description: `agent redirect after ${answer}`,
      matches: (url) => {
        if (!isCustomerAgentCallbackUrl(url)) return false;
        // Registered before any log line can carry the URL.
        addRedaction(parseUrl(url)?.searchParams.get("code") ?? "", true);
        return true;
      },
      run,
      session,
      timeoutMs: config.timeouts.uiTransition,
    });
    const callback = yield* tryWorkspaceE2ESync(
      "read agent authorization response",
      () => readCustomerAgentCallback(callbackUrl, request.state)
    );
    return { callback, request };
  });

const singlePage = (context: BrowserContext): Page => {
  const [only] = context.pages();
  if (!only || context.pages().length !== 1) {
    throw new Error("agent booking session has no single page");
  }
  return only;
};

const reserveBookingViewSchema = Schema.Struct({
  booking_mode: Schema.Literal("reserve"),
});

/** The tool `_meta` that links a tool to its MCP Apps view. */
const viewLinkSchema = Schema.Struct({
  ui: Schema.Struct({ resourceUri: Schema.String }),
});

/**
 * The signed-in agent's booking view starts bookings itself, and the view
 * it links reads back as an MCP Apps document.
 */
const verifyAgentBookingView = ({
  config,
  locale,
  mcp,
}: {
  readonly config: AgentBookingContext["config"];
  readonly locale: Locale;
  readonly mcp: Client;
}) =>
  Effect.gen(function* () {
    yield* callCustomerMcpTool({
      arguments: { family: "cowork", locale },
      client: mcp,
      config,
      name: "show_booking",
      schema: reserveBookingViewSchema,
    });
    const view = yield* tryWorkspaceE2EPromise(
      "read agent booking view",
      async () => {
        const { tools } = await mcp.listTools(undefined, {
          timeout: config.timeouts.customerMcpRequest,
        });
        const { ui } = Schema.decodeUnknownSync(viewLinkSchema)(
          tools.find(({ name }) => name === "show_booking")?._meta
        );
        return mcp.readResource(
          { uri: ui.resourceUri },
          { timeout: config.timeouts.customerMcpRequest }
        );
      }
    );
    yield* tryWorkspaceE2ESync("check agent booking view", () =>
      assert(
        view.contents[0]?.mimeType === "text/html;profile=mcp-app",
        "The booking view isn't an MCP Apps document"
      )
    );
  });

const startedReservationSchema = Schema.Struct({
  order_id: workspaceReservationIdSchema,
  pay_url: Schema.String,
  pay_url_expires_at: Schema.String,
});

/**
 * The agent starts the planned reservation over MCP, and the customer opens
 * the Pay link it returns in the signed-in browser.
 */
const startAgentReservation = ({
  booking: { config, run, runStep, session, state },
  mcp,
}: {
  readonly booking: AgentBookingContext;
  readonly mcp: Client;
}) =>
  Effect.gen(function* () {
    const started = yield* runStep({
      execute: callCustomerMcpTool({
        arguments: {
          coffee: false,
          date: state.data.date,
          family: "cowork",
          locale: state.data.locale,
          tier: "open-space",
        },
        client: mcp,
        config,
        name: "start_reservation",
        schema: startedReservationSchema,
      }).pipe(
        Effect.tap(({ order_id, pay_url }) =>
          Effect.sync(() => {
            state.orderId = order_id;
            addRedaction(
              parseUrl(pay_url)?.searchParams.get("payState") ?? "",
              true
            );
          })
        )
      ),
      id: "start-agent-reservation",
      timeoutMs: config.timeouts.customerMcpRequest,
    });
    return yield* runStep({
      execute: Effect.gen(function* () {
        yield* tryWorkspaceE2ESync("read agent Pay link", () => {
          const payUrl = parseUrl(started.pay_url);
          assert(
            payUrl?.origin === new URL(config.baseUrl).origin &&
              payUrl.pathname === `/${state.data.locale}/checkout/pay` &&
              payUrl.searchParams.get("orderId") === started.order_id,
            "The agent's Pay link is not this order's pay page"
          );
          assert(
            Date.parse(started.pay_url_expires_at) > Date.now(),
            "The agent's Pay link has already expired"
          );
        });
        yield* openBrowserPage(config, run, session, started.pay_url, {
          timeoutMs: config.timeouts.browserNavigation,
        });
        const orderId = yield* waitForReservationPayPage({
          run,
          session,
          timeouts: config.timeouts,
        });
        yield* tryWorkspaceE2ESync("match agent pay page order", () =>
          assert(
            orderId === started.order_id,
            "The Pay link opened another order"
          )
        );
        return orderId;
      }),
      id: "open-agent-pay-page",
      timeoutMs: config.timeouts.checkoutStart,
    });
  });

const reservationStatusSchema = Schema.Struct({
  order_id: Schema.String,
  payment_status: Schema.String,
  status: Schema.String,
});

const reservationListSchema = Schema.Struct({
  current: Schema.Array(
    Schema.Struct({ order_id: Schema.optional(Schema.String) })
  ),
});

/**
 * After the customer paid, the agent sees the order paid and finds it among
 * the account's current reservations.
 */
const verifyAgentReservationReads = ({
  booking: { config, runStep, state },
  mcp,
  orderId,
}: {
  readonly booking: AgentBookingContext;
  readonly mcp: Client;
  readonly orderId: string;
}): Effect.Effect<void, WorkspaceE2EError, E2EDatabase> =>
  Effect.gen(function* () {
    yield* runStep({
      execute: pollUntil(
        callCustomerMcpTool({
          arguments: { locale: state.data.locale, order_id: orderId },
          client: mcp,
          config,
          name: "get_reservation_status",
          schema: reservationStatusSchema,
        }).pipe(
          Effect.map((status) =>
            status.order_id === orderId && status.payment_status === "paid"
              ? status
              : undefined
          )
        ),
        {
          describePending: () => "the agent does not see the order paid yet",
          intervalMs: workspaceE2EPollIntervalMs.datasource,
          label: "agent reservation status paid",
          timeoutMs: config.timeouts.providerTransition,
        }
      ),
      id: "read-agent-reservation-status",
      timeoutMs: config.timeouts.providerTransition,
    });
    const reservations = yield* runStep({
      execute: callCustomerMcpTool({
        arguments: { locale: state.data.locale },
        client: mcp,
        config,
        name: "list_my_reservations",
        schema: reservationListSchema,
      }),
      id: "list-agent-reservations",
      timeoutMs: config.timeouts.customerMcpRequest,
    });
    yield* tryWorkspaceE2ESync("find agent reservation in list", () =>
      assert(
        reservations.current.some(
          (reservation) => reservation.order_id === orderId
        ),
        "The agent's reservation list does not include the paid order"
      )
    );
  });
