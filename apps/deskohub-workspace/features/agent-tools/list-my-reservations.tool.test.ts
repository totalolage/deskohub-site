import "@/shared/testing/workspace-test-env";

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { Effect, Layer, Option } from "effect";
import type {
  CustomerAgentClientId,
  CustomerAgentGrant,
  CustomerAgentScope,
  CustomerReservationHistory,
} from "@/features/account";
import type { CustomerAccountId } from "@/features/account/customer-account";

const accountId = "account-1" as CustomerAccountId;
let linked: { readonly dotyposCustomerId: string } | null;

const { CustomerAccountContactService, CustomerReservationHistoryService } =
  await import("@/features/account");
const callerModule = await import("./customer-agent-caller");
mock.module("./customer-agent-caller", () => ({
  ...callerModule,
  customerAgentCallServices: ({ grant }: { grant: CustomerAgentGrant }) =>
    Layer.merge(
      Layer.succeed(callerModule.CurrentCustomerAgentGrant, grant),
      Layer.mock(CustomerAccountContactService, {
        currentLinkedAccount: Effect.sync(() =>
          linked
            ? ({
                accountId: grant.accountId,
                email: testEmailAddress("list-my-reservations"),
                ...linked,
              } as never)
            : null
        ),
      })
    ),
}));

const { listMyReservationsTool } = await import("./list-my-reservations.tool");

let history: CustomerReservationHistory;
const load = mock(() => Effect.sync(() => history));

const grant: CustomerAgentGrant = {
  accountId,
  clientId: "https://assistant.example/client.json" as CustomerAgentClientId,
  scopes: new Set<CustomerAgentScope>(["reservations:read"]),
};

const list = () =>
  listMyReservationsTool
    .call({}, Option.some({ grant, accessToken: "token" }))
    .pipe(
      Effect.provide(Layer.mock(CustomerReservationHistoryService, { load })),
      Effect.result,
      Effect.runPromise
    );

describe("list_my_reservations", () => {
  beforeEach(() => {
    load.mockClear();
    linked = { dotyposCustomerId: "60111" };
    history = {
      kind: "available",
      groups: {
        current: [
          {
            id: "order-1",
            workspaceReservationId: "order-1" as never,
            product: { kind: "cowork", tier: "open-space" },
            startsAt: "2099-07-01T06:00:00Z",
            endsAt: "2099-07-01T22:00:00Z",
            seats: 1,
            status: "confirmed",
          },
          {
            id: "dotypos-2",
            party: { kind: "booked-for", customerName: "Grace Hopper" },
            product: { kind: "meeting-room" },
            startsAt: "2099-07-02T08:00:00Z",
            endsAt: "2099-07-02T09:00:00Z",
            seats: null,
            status: "pending",
          },
        ],
        past: [
          {
            id: "dotypos-3",
            party: { kind: "booked-by", authorName: "Ada Lovelace" },
            product: { kind: "office" },
            startsAt: "2099-06-01T00:00:00Z",
            endsAt: "2099-06-02T00:00:00Z",
            seats: 2,
            status: "cancelled",
          },
        ],
        unavailable: [],
      },
    };
  });

  test("lists the account's reservations without anyone's names", async () => {
    const result = await list();

    // The tool never returns names, so it skips their uncached read.
    expect(load).toHaveBeenCalledWith(
      expect.objectContaining({ accountId, dotyposCustomerId: "60111" }),
      { includePartyNames: false }
    );
    expect(result._tag).toBe("Success");
    expect(result._tag === "Success" && result.success).toEqual({
      current: [
        {
          order_id: "order-1",
          family: "cowork",
          tier: "open-space",
          starts_at: "2099-07-01T06:00:00Z",
          ends_at: "2099-07-01T22:00:00Z",
          seats: 1,
          status: "confirmed",
          party: "own",
        },
        {
          family: "meeting-room",
          starts_at: "2099-07-02T08:00:00Z",
          ends_at: "2099-07-02T09:00:00Z",
          seats: null,
          status: "pending",
          party: "booked_for_other",
        },
      ],
      past: [
        {
          family: "office",
          starts_at: "2099-06-01T00:00:00Z",
          ends_at: "2099-06-02T00:00:00Z",
          seats: 2,
          status: "cancelled",
          party: "booked_by_other",
        },
      ],
      unavailable: [],
    });
  });

  test("lists only authored reservations for an account without a linked profile", async () => {
    linked = null;

    await list();

    expect(load).toHaveBeenCalledWith(
      { accountId },
      { includePartyNames: false }
    );
  });

  test("reports reservations Dotypos can't serve as unavailable", async () => {
    history = { kind: "unavailable", reason: "provider-unavailable" };

    expect(await list()).toMatchObject({
      _tag: "Failure",
      failure: { details: { code: "reservations_unavailable" } },
    });
  });
});
