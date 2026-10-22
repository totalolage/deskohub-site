import "@/shared/testing/workspace-test-env";

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { Data, Effect, Layer, Option, type Schema } from "effect";
import type {
  CustomerAgentClientId,
  CustomerAgentGrant,
  CustomerAgentScope,
} from "@/features/account";
import type { CustomerAccountId } from "@/features/account/customer-account";
import type { PreparePayStateInput } from "@/features/reservation/actions/prepare-pay-state.schema";

type Prepared =
  | { readonly status: "ready" | "pricing_changed" }
  | { readonly status: "error" }
  | { readonly fail: { readonly _tag: string } };

/** What the booking operation saw: its input and the agent it ran for. */
const submissions: {
  readonly input: PreparePayStateInput;
  readonly agentClientId: string | undefined;
  readonly selectionKey: string | undefined;
}[] = [];
let prepared: Prepared = { status: "ready" };

const { AgentBookingPaymentInProgressError, BookingAgent } = await import(
  "@/features/reservation/backend/booking-agent"
);
const preparePayStateModule = await import(
  "@/features/reservation/actions/prepare-pay-state"
);
mock.module("@/features/reservation/actions/prepare-pay-state", () => ({
  ...preparePayStateModule,
  prepareWorkspacePayState: (input: PreparePayStateInput) =>
    Effect.serviceOption(BookingAgent).pipe(
      Effect.tap((agent) =>
        Effect.sync(() =>
          submissions.push({
            input,
            agentClientId: Option.getOrUndefined(agent)?.clientId,
            selectionKey: Option.getOrUndefined(agent)?.selectionKey,
          })
        )
      ),
      Effect.flatMap(() =>
        "fail" in prepared
          ? Effect.fail(prepared.fail)
          : Effect.succeed(
              prepared.status === "error"
                ? { status: "error" as const, message: "Conflict" }
                : {
                    status: prepared.status,
                    orderId: "order-1",
                    redirectUrl: `/${input.locale}/checkout/pay?payState=sealed&orderId=order-1`,
                    expiresAt: "2099-01-01T10:10:00.000Z",
                    affectedProductKeys: [],
                  }
            )
      )
    ),
}));

type Contact = {
  readonly name: string;
  readonly email: string;
  readonly phone: string | null;
} | null;
let contact: Contact;

const { CustomerAccountContactService } = await import("@/features/account");
const callerModule = await import("./customer-agent-caller");
mock.module("./customer-agent-caller", () => ({
  ...callerModule,
  customerAgentCallServices: ({ grant }: { grant: CustomerAgentGrant }) =>
    Layer.merge(
      Layer.succeed(callerModule.CurrentCustomerAgentGrant, grant),
      Layer.mock(CustomerAccountContactService, {
        current: Effect.sync(() =>
          contact
            ? ({
                accountId: grant.accountId,
                dotyposCustomerId: "customer-1",
                ...contact,
              } as never)
            : null
        ),
      })
    ),
}));

const {
  atInstant,
  makeAgentToolTestServices,
  workspaceDateFromToday,
  workspaceInstantToday,
} = await import("./agent-tools.test-utils");
const { startReservationTool } = await import("./start-reservation.tool");

const grantFor = (clientId: string): CustomerAgentGrant => ({
  accountId: "account-1" as CustomerAccountId,
  clientId: clientId as CustomerAgentClientId,
  scopes: new Set<CustomerAgentScope>(["reservations:create"]),
});

const assistant = "https://assistant.example/client.json";

const start = (
  args: Schema.Json,
  {
    clientId = assistant,
    now = Temporal.Now.instant(),
  }: { readonly clientId?: string; readonly now?: Temporal.Instant } = {}
) =>
  startReservationTool
    .call(args, Option.some({ grant: grantFor(clientId), accessToken: "t" }))
    .pipe(
      Effect.provide(makeAgentToolTestServices().layer),
      atInstant(now),
      Effect.result,
      Effect.runPromise
    );

const cowork = (days = 2) => ({
  family: "cowork",
  date: workspaceDateFromToday(days),
  tier: "open-space",
});

class WorkspaceTableUnavailableError extends Data.TaggedError(
  "WorkspaceTableUnavailableError"
)<Record<string, never>> {}
describe("start_reservation", () => {
  beforeEach(() => {
    submissions.length = 0;
    prepared = { status: "ready" };
    contact = {
      name: "Ada Agent",
      email: testEmailAddress("start-reservation"),
      phone: "+420 777 123 456",
    };
  });

  test("holds the selection as the account's own booking and returns the Pay link", async () => {
    const result = await start(cowork());

    expect(result).toMatchObject({
      _tag: "Success",
      success: {
        order_id: "order-1",
        pay_url: expect.stringMatching(
          /^https?:\/\/[^/]+\/en-US\/checkout\/pay\?payState=sealed&orderId=order-1$/
        ),
        pay_url_expires_at: "2099-01-01T10:10:00.000Z",
        family: "cowork",
        total: { amount: 290, currency: "CZK" },
        price_changed: false,
      },
    });
    expect(submissions).toHaveLength(1);
    const [{ input, agentClientId }] = submissions as [
      (typeof submissions)[number],
    ];
    expect(agentClientId).toBe(assistant);
    expect(input).toMatchObject({
      locale: "en-US",
      customer: "account",
      advertisedPriceToken: expect.any(String),
      reservation: {
        kind: "cowork",
        entryTier: "open-space",
        date: workspaceDateFromToday(2),
        coffee: false,
        name: "Ada Agent",
        email: testEmailAddress("start-reservation"),
        billing: { purpose: "personal", invoice: "none" },
      },
    });
  });

  test("reuses the checkout attempt for an identical repeat and keeps one session per client", async () => {
    const now = Temporal.Now.instant();

    await start(cowork(), { now });
    await start(cowork(), { now: now.add({ seconds: 30 }) });
    await start(cowork(3), { now });
    await start(cowork(), { now, clientId: "https://other.example/c.json" });

    const [first, repeat, otherSelection, otherClient] = submissions.map(
      ({ input }) => input
    );
    expect(repeat?.checkoutSessionId).toBe(first?.checkoutSessionId);
    expect(repeat?.checkoutAttemptId).toBe(first?.checkoutAttemptId);
    // A different selection supersedes the client's hold in its session.
    expect(otherSelection?.checkoutSessionId).toBe(first?.checkoutSessionId);
    expect(otherSelection?.checkoutAttemptId).not.toBe(
      first?.checkoutAttemptId
    );
    expect(otherClient?.checkoutSessionId).not.toBe(first?.checkoutSessionId);
  });

  test("keeps the same session and attempt across the old 10-minute boundary", async () => {
    const selection = cowork(2);
    // Today, as the booking window follows the real date; Prague's whole-hour
    // offset keeps these on either side of a UTC 10-minute boundary.
    const beforeBoundary = workspaceInstantToday("14:09:59");
    const afterBoundary = workspaceInstantToday("14:10:01");

    await start(selection, { now: beforeBoundary });
    await start(selection, { now: afterBoundary });

    expect(submissions).toHaveLength(2);
    const [first, later] = submissions.map(({ input }) => input);
    expect(later?.checkoutSessionId).toBe(first?.checkoutSessionId);
    expect(later?.checkoutAttemptId).toBe(first?.checkoutAttemptId);
  });

  test("derives one selection key for identical calls and another for a different selection", async () => {
    const now = workspaceInstantToday("14:09:59");
    const selection = cowork(2);

    await start(selection, { now });
    await start(selection, { now: now.add({ seconds: 2 }) });
    await start(cowork(3), { now });

    expect(submissions).toHaveLength(3);
    const [first, repeat, otherSelection] = submissions.map(
      ({ selectionKey }) => selectionKey
    );
    expect(repeat).toBe(first);
    expect(otherSelection).not.toBe(first);
  });

  test("records marketing consent only when the customer asked for it", async () => {
    await start(cowork());
    await start({ ...cowork(), marketing_consent: false });
    await start({ ...cowork(), marketing_consent: true });

    const [absent, declined, granted] = submissions.map(({ input }) => input);
    expect(absent).not.toHaveProperty("marketingConsent");
    expect(declined).not.toHaveProperty("marketingConsent");
    expect(granted?.marketingConsent).toBe(true);
    expect(granted).not.toHaveProperty("marketingConsentSource");
  });

  test.each([
    ["no bookable profile", null],
    [
      "no phone number",
      { name: "Ada Agent", email: testEmailAddress("no-phone"), phone: null },
    ],
  ] as const)(
    "asks the customer to finish a profile with %s on the site",
    async (_, profile) => {
      contact = profile;

      const result = await start(cowork());

      expect(result).toMatchObject({
        _tag: "Failure",
        failure: { details: { code: "profile_incomplete" } },
      });
      expect(submissions).toEqual([]);
    }
  );

  test("reports a changed price with the Pay link", async () => {
    prepared = { status: "pricing_changed" };

    expect(await start(cowork())).toMatchObject({
      _tag: "Success",
      success: { price_changed: true, order_id: "order-1" },
    });
  });

  test("maps unavailable selection to a refusal", async () => {
    const error = new WorkspaceTableUnavailableError({});
    prepared = { fail: error };

    expect(await start(cowork())).toMatchObject({
      _tag: "Failure",
      failure: { details: { code: "selection_unavailable" } },
    });
  });

  test("maps a pending payment to payment_in_progress", async () => {
    prepared = {
      fail: new AgentBookingPaymentInProgressError({
        reservationId: "reservation-1" as never,
      }),
    };

    expect(await start(cowork())).toMatchObject({
      _tag: "Failure",
      failure: { details: { code: "payment_in_progress" } },
    });
  });

  test("maps a lost hold claim to a conflict", async () => {
    prepared = { status: "error" };

    expect(await start(cowork())).toMatchObject({
      _tag: "Failure",
      failure: { details: { code: "reservation_conflict" } },
    });
  });

  test("refuses a call without a signed-in caller", async () => {
    const result = await startReservationTool
      .call(cowork())
      .pipe(
        Effect.provide(makeAgentToolTestServices().layer),
        Effect.result,
        Effect.runPromise
      );

    expect(result).toMatchObject({
      _tag: "Failure",
      failure: { details: { code: "service_unavailable" } },
    });
    expect(submissions).toEqual([]);
  });
});
