import "@/shared/testing/workspace-test-env";

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { Effect, Layer, Option } from "effect";
import type {
  CustomerAgentClientId,
  CustomerAgentGrant,
  CustomerAgentScope,
} from "@/features/account";
import type { CustomerAccountId } from "@/features/account/customer-account";
import type { CheckoutStatusViewModel } from "@/features/checkout/backend/checkout/checkout-status.service";
import type { WorkspaceReservation } from "@/features/reservation/backend/workspace-reservation.repository";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import { ReviewSandboxMock } from "@/features/review-accounts/backend/review-sandbox.service.mock";

const accountId = "account-1" as CustomerAccountId;
const linkedCustomerId = "60111";

const { CustomerAccountReservationOwnership } = await import(
  "@/features/account"
);
const callerModule = await import("./customer-agent-caller");
mock.module("./customer-agent-caller", () => ({
  ...callerModule,
  customerAgentCallServices: ({ grant }: { grant: CustomerAgentGrant }) =>
    Layer.merge(
      Layer.succeed(callerModule.CurrentCustomerAgentGrant, grant),
      Layer.succeed(CustomerAccountReservationOwnership, {
        activeAccountId: Effect.succeed(grant.accountId),
        resolve: Effect.succeed({
          accountId: grant.accountId,
          dotyposCustomerId: linkedCustomerId as never,
        }),
      })
    ),
}));

const { WorkspaceReservationRepository } = await import(
  "@/features/reservation/backend/workspace-reservation.repository"
);
const { CheckoutStatusService } = await import(
  "@/features/checkout/backend/checkout/checkout-status.service"
);
const { getReservationStatusTool } = await import(
  "./get-reservation-status.tool"
);

let stored: Partial<WorkspaceReservation> | null;
const getStatus = mock(
  ({
    orderId,
  }: {
    readonly orderId: WorkspaceReservationId;
    readonly includeSupportContact?: boolean;
  }): Effect.Effect<CheckoutStatusViewModel> =>
    Effect.succeed({
      kind: "cowork",
      orderId,
      returnOutcome: "unknown",
      status: "fulfilled",
      paymentStatus: "paid",
      fulfillmentStatus: "fulfilled",
      summary: {
        kind: "cowork",
        entryTier: "open-space",
        coffee: false,
        price: { value: 29_000, exponent: 2, currency: "CZK" },
        reservedFrom: Temporal.Instant.from("2099-07-01T06:00:00Z"),
        reservedUntil: Temporal.Instant.from("2099-07-01T22:00:00Z"),
      },
      table: { mode: "shared", name: "Desk 1" },
      supportContactPrefill: {
        name: "Someone",
        email: testEmailAddress("someone"),
      },
    })
);

const services = Layer.mergeAll(
  Layer.mock(WorkspaceReservationRepository, {
    findById: () => Effect.succeed(stored as WorkspaceReservation | null),
  }),
  ReviewSandboxMock({ isOrderOf: () => Effect.succeed(false) }),
  Layer.mock(CheckoutStatusService, { getStatus })
);

const grant: CustomerAgentGrant = {
  accountId,
  clientId: "https://assistant.example/client.json" as CustomerAgentClientId,
  scopes: new Set<CustomerAgentScope>(["reservations:read"]),
};

const status = (orderId = "order-1") =>
  getReservationStatusTool
    .call(
      { order_id: orderId, locale: "cs-CZ" },
      Option.some({ grant, accessToken: "token" })
    )
    .pipe(Effect.provide(services), Effect.result, Effect.runPromise);

describe("get_reservation_status", () => {
  beforeEach(() => {
    getStatus.mockClear();
    stored = { authorAccountId: accountId, dotyposCustomerId: "90000" };
  });

  test("reports the status of an order the customer authored, without contact or table details", async () => {
    const result = await status();

    expect(result).toMatchObject({
      _tag: "Success",
      success: {
        order_id: "order-1",
        family: "cowork",
        status: "fulfilled",
        payment_status: "paid",
        fulfillment_status: "fulfilled",
        starts_at: "2099-07-01T06:00:00Z",
        ends_at: "2099-07-01T22:00:00Z",
        total: { amount: 290, currency: "CZK" },
        // Locale-agnostic: the proxy opens it in the customer's language.
        status_url: expect.stringMatching(
          /:\/\/[^/]+\/reservation\/status\/order-1$/
        ),
      },
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(testEmailAddress("someone"));
    expect(serialized).not.toContain("Desk 1");
    expect(serialized).not.toContain("x-vercel-protection-bypass");
    // The tool never returns contact details, so it skips their uncached read.
    expect(getStatus).toHaveBeenCalledWith(
      expect.objectContaining({ includeSupportContact: false })
    );
  });

  test("reports an order booked for the customer's linked profile", async () => {
    stored = { authorAccountId: null, dotyposCustomerId: linkedCustomerId };

    expect((await status())._tag).toBe("Success");
  });

  test("refuses another customer's order exactly like a missing one", async () => {
    stored = {
      authorAccountId: "another-account" as CustomerAccountId,
      dotyposCustomerId: "90001",
    };
    const foreign = await status();
    stored = null;
    const missing = await status("missing-order");

    for (const result of [foreign, missing]) {
      expect(result).toMatchObject({
        _tag: "Failure",
        failure: { details: { code: "reservation_not_found" } },
      });
    }
    expect(getStatus).not.toHaveBeenCalled();
  });
});
