import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { DotyposRejected, DotyposService } from "@deskohub/dotypos";
import { testEmailAddress } from "@deskohub/test-email";
import {
  AdministrationActorEmail,
  AdministrationAuthentication,
  AdministrationDiscountCodeUpdateInput,
  AdministrationDotyposCustomerId,
  AdministrationInstant,
  AdministrationProviderCredentialId,
  AdministrationStandaloneAccessCodeAttemptId,
  type AdministrationStandaloneAccessCodeAttemptIdType,
  type AdministrationStandaloneAccessCodeCleanupTargetType,
  AdministrationStandaloneAccessCodeCreateInput,
  type AdministrationStandaloneAccessCodeCreationOutcomeType,
  AdministrationStandaloneAccessCodeName,
  AdministrationStandaloneAccessCodePin,
  AdministrationStoredDiscountId,
  AdministrationWorkspaceReservationId,
  AdministrationWorkspaceSiteLocalWholeHourDateTime,
  CliAuthenticationChallenge,
  CliAuthenticationCode,
  CliBearerAuthentication,
  CliMutationInProgress,
  CliMutationRejected,
  CliMutationRequestId,
  CliMutationUncertain,
  CliResourceNotFound,
  CliServiceUnavailable,
  CliSessionId,
  CliSessionUnauthorized,
  CliStandaloneAccessCodeCleanupRequired,
  CliStandaloneAccessCodeReconciled,
  CurrentAdministrationCaller,
  CurrentCliSession,
  toAdministrationActorName,
  WorkspaceAdminApi,
} from "@deskohub/workspace-admin-api";
import { NodeHttpServer } from "@effect/platform-node";
import { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import {
  Effect,
  Layer,
  Logger,
  Option,
  Redacted,
  Result,
  Schema,
} from "effect";
import { HttpRouter } from "effect/unstable/http";
import { HttpApiTest } from "effect/unstable/httpapi";
import {
  StandaloneAccessCodeAdministration,
  StandaloneAccessCodeCreationError,
} from "@/features/access-codes";
import { customerAccountIdSchema } from "@/features/account/customer-account";
import {
  InvoiceAdministrationInProgressError,
  InvoiceAdministrationService,
} from "@/features/accounting/admin/invoice-administration.service";
import { ManualInvoiceValidationError } from "@/features/accounting/manual-invoice";
import { AdministrationService } from "@/features/administration/administration.service";
import {
  ReservationAccessAdministration,
  ReservationAccessAdministrationError,
} from "@/features/administration/reservation-access-administration.service";
import {
  ReservationAdministrationError,
  ReservationAdministrationService,
} from "@/features/administration/reservation-administration.service";
import {
  AdministratorRoster,
  LegacyAdministratorBackfill,
} from "@/features/administrators";
import type { AdministratorAccountActor } from "@/features/administrators/account-role";
import { WorkspaceReservationEmailService } from "@/features/checkout/backend/fulfillment/workspace-reservation-email.service";
import {
  adminCodeClaim,
  adminCustomerCode,
  adminCustomerProfile,
  adminCustomerVoucher,
  adminVoucherClaim,
} from "@/features/discounts/admin/customer-admin-fixtures.test-utils";
import {
  DiscountAdminConflictError,
  DiscountAdministration,
  DiscountAdminServiceDatesError,
} from "@/features/discounts/admin/discount-administration.service";
import { CampaignOperations } from "@/features/email-campaigns/backend/campaign-operations.service";
import { featureFlagsByCohort } from "@/features/feature-flags/backend/release-cohorts.test-utils";
import {
  ReservationProductDetailsBackfill,
  type ReservationProductDetailsBackfillBatch,
} from "@/features/reservation/backend/reservation-product-details-backfill.service";
import { WorkspaceReservationRepository } from "@/features/reservation/backend/workspace-reservation.repository";
import { workspaceReservationIdSchema } from "@/features/reservation/persistence-contracts";
import { toWorkspaceWebHandler } from "@/shared/backend/workspace-effect";
import { makeMeetingPoint } from "@/shared/testing/overlapping-requests.test-utils";
import { plainDateStringSchema } from "@/shared/utils/temporal";
import {
  discountMutationRecovery,
  reservationAccessRecovery,
  standaloneAccessCodeRecovery,
  standaloneAccessCodeStoredResult,
} from "./administration-mutation-recovery";
import { AdministrationRequestLedger } from "./administration-request-ledger.service";
import {
  ClaimEveryCliMutation,
  DiscardedAdministrationActionLog,
  recordingRequestLedger,
  UnrecordedAdministrationActions,
  UnusedCliSessionAuthentication,
} from "./cli-api.test-utils";
import { CliAuthentication } from "./cli-authentication.service";
import { CliAuthenticationAdmission } from "./cli-authentication-admission.service";
import { CliClientCompatibilityLive } from "./cli-client-version";
import {
  AdminCliAdministrationApiHandlers,
  AdminCliApiHandlers,
  CliBearerAuthenticationLive,
  CliSessionAdministrationAuthenticationLive,
  handleWorkspaceAdminApiRequest,
  makeWorkspaceAdminApiLayer,
} from "./workspace-admin-api.server";

const cliAdministrator: AdministratorAccountActor = {
  accountId: customerAccountIdSchema.make("cli-administrator-account"),
  email: testEmailAddress("cli-administrator"),
};
// Every session in these tests acts as `cliAdministrator`.
const SessionAdministratorAuthentication = Layer.succeed(CliAuthentication, {
  ...({} as CliAuthentication["Service"]),
  sessionAdministrator: () => Effect.succeed(cliAdministrator),
});
// The bearer authenticates, but its session has no approving administrator.
const UnresolvableSessionAuthentication = Layer.succeed(CliAuthentication, {
  ...({} as CliAuthentication["Service"]),
  authenticateSession: () =>
    Effect.succeed({ ...session, id: CliSessionId.make(session.id) }),
  sessionAdministrator: () =>
    Effect.fail(
      new CliSessionUnauthorized({ message: "No approving administrator." })
    ),
});
const UnusedAdministrationService = Layer.succeed(
  AdministrationService,
  {} as AdministrationService["Service"]
);
const UnusedReservationAdministration = Layer.succeed(
  ReservationAdministrationService,
  {} as ReservationAdministrationService["Service"]
);
const UnusedReservationProductDetailsBackfill = Layer.succeed(
  ReservationProductDetailsBackfill,
  { runBatch: () => Effect.die("not expected") }
);
const UnusedReservationAccessAdministration = Layer.succeed(
  ReservationAccessAdministration,
  {} as ReservationAccessAdministration["Service"]
);
const UnusedDiscountAdministration = Layer.succeed(
  DiscountAdministration,
  {} as DiscountAdministration["Service"]
);
const UnusedInvoiceAdministration = Layer.succeed(
  InvoiceAdministrationService,
  {} as InvoiceAdministrationService["Service"]
);
const UnusedStandaloneAccessCodeAdministration = Layer.succeed(
  StandaloneAccessCodeAdministration,
  {
    create: () => Effect.die("not expected"),
  } satisfies StandaloneAccessCodeAdministration["Service"]
);
const session = {
  id: "01980000-0000-7000-8000-000000000000",
  approvedBy: null,
  approvedByEmail: null,
  clientName: "test client",
  cliVersion: "1.0.0",
  buildTarget: "development",
  createdAt: "2026-08-10T10:00:00.000Z",
  lastUsedAt: "2026-08-10T10:00:00.000Z",
  expiresAt: null,
} as const;
const cliAdministratorEmail = AdministrationActorEmail.make(
  cliAdministrator.email
);
const cliAdministratorApprover = {
  approvedBy: toAdministrationActorName(cliAdministratorEmail),
  approvedByEmail: cliAdministratorEmail,
};
// Every request acts as `cliAdministrator` on the session's channel.
const CliCallerAuthentication = Layer.succeed(AdministrationAuthentication, {
  bearer: (httpEffect) =>
    Effect.provideService(httpEffect, CurrentAdministrationCaller, {
      actor: cliAdministrator,
      channel: { _tag: "CliSession", sessionId: CliSessionId.make(session.id) },
    }),
});
const AuthorizedCliRequest = Layer.mergeAll(
  CliCallerAuthentication,
  Layer.succeed(CliBearerAuthentication, {
    bearer: (httpEffect) =>
      Effect.provideService(httpEffect, CurrentCliSession, session),
  })
);
const ActorAuthorizedCliRequest = Layer.mergeAll(
  CliCallerAuthentication,
  Layer.succeed(CliBearerAuthentication, {
    bearer: (httpEffect) =>
      Effect.provideService(httpEffect, CurrentCliSession, {
        ...session,
        ...cliAdministratorApprover,
      }),
  })
);
const administrationClient = HttpApiTest.groups(WorkspaceAdminApi, [
  "administration",
]).pipe(Effect.map((client) => client.administration));
type AdministrationClient = Effect.Success<typeof administrationClient>;

type AdministrationApiServiceLayers = {
  readonly administration?: Layer.Layer<AdministrationService>;
  readonly discounts?: Layer.Layer<DiscountAdministration>;
  readonly invoices?: Layer.Layer<InvoiceAdministrationService>;
  readonly reservations?: Layer.Layer<ReservationAdministrationService>;
};

const callAdministrationApi = <A, E>(
  call: (client: AdministrationClient) => Effect.Effect<A, E>,
  services: AdministrationApiServiceLayers = {}
) =>
  administrationClient.pipe(
    Effect.flatMap(call),
    Effect.provide(AdminCliAdministrationApiHandlers),
    Effect.provide(ActorAuthorizedCliRequest),
    Effect.provide(UnusedStandaloneAccessCodeAdministration),
    Effect.provide(ClaimEveryCliMutation),
    Effect.provide(services.invoices ?? UnusedInvoiceAdministration),
    Effect.provide(services.reservations ?? UnusedReservationAdministration),
    Effect.provide(UnusedReservationProductDetailsBackfill),
    Effect.provide(services.discounts ?? UnusedDiscountAdministration),
    Effect.provide(SessionAdministratorAuthentication),
    Effect.provide(services.administration ?? UnusedAdministrationService),
    Effect.provide(UnusedReservationAccessAdministration),
    Effect.provide(CliClientCompatibilityLive),
    Effect.provide(UnrecordedAdministrationActions),
    Effect.provide(NodeHttpServer.layerHttpServices),
    Effect.scoped,
    Effect.runPromise
  );

const invoicePreviewPayload = {
  invoiceId: "01980000-0000-7000-8000-000000000009",
  customer: {
    kind: "new" as const,
    details: {
      kind: "person" as const,
      email: testEmailAddress("invoice-preview"),
      firstName: "Synthetic",
      lastName: "Customer",
      address: {
        line1: "Test street 1",
        city: "Prague",
        postalCode: "100 00",
        country: "CZ",
      },
    },
  },
  locale: "cs-CZ" as const,
  serviceDate: "2026-08-10",
  payment: { status: "due" as const, date: "2026-08-24" },
  currency: "CZK",
  lines: [{ description: "Space rental", price: "1000" }],
};

describe("Workspace Admin API", () => {
  test("disables caching for API responses", async () => {
    const response = await handleWorkspaceAdminApiRequest(
      new Request("https://workspace.deskohub.test/api/v1/cli/info")
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  test("returns refund attention and customer metrics in the overview", async () => {
    const source = {};
    const sourceInputs: unknown[] = [];
    const customerId = AdministrationDotyposCustomerId.make("1001");
    const overview = {
      today: { completed: 1, unavailable: false, value: 2 },
      upcoming: { completed: 0, unavailable: false, value: 3 },
      lastSevenDays: { completed: 4, unavailable: false, value: 5 },
      uniqueCustomers: {
        customers: [{ customerId, customer: null }],
        unavailable: false,
        value: 1,
      },
      newCustomers: {
        customers: [
          {
            customerId,
            customer: {
              id: customerId,
              displayName: "Synthetic Customer",
              email: testEmailAddress("overview-customer"),
              phone: null,
            },
          },
        ],
        unavailable: false,
        value: 1,
      },
    };
    const administration = Layer.succeed(AdministrationService, {
      ...({} as AdministrationService["Service"]),
      loadOverviewSource: () => Effect.succeed(source as never),
      loadOverview: (input) => {
        sourceInputs.push(input);
        return Effect.succeed(overview as never);
      },
      countReservationsNeedingRefund: () => Effect.succeed(4),
    });

    const result = await callAdministrationApi(
      (client) => client.getOverview({}),
      { administration }
    );

    expect(sourceInputs).toEqual([source]);
    expect(result).toMatchObject({
      ...overview,
      refundAttention: { unavailable: false, value: 4 },
    });
  });

  test("passes the customer id and returns reservation activity with dates or unavailable dates", async () => {
    const requests: unknown[] = [];
    const withDates = {
      from: "2025-10-23",
      to: "2026-10-22",
      dates: [{ date: "2026-10-20", count: 2, category: "meeting-room" }],
    };
    const unavailable = {
      from: "2025-10-23",
      to: "2026-10-22",
      dates: null,
    };
    const administration = Layer.succeed(AdministrationService, {
      ...({} as AdministrationService["Service"]),
      loadCustomerReservationActivity: (customerId) => {
        requests.push(customerId);
        return Effect.succeed(requests.length === 1 ? withDates : unavailable);
      },
    });
    const customerId = AdministrationDotyposCustomerId.make("1001");
    const unavailableCustomerId = AdministrationDotyposCustomerId.make("1002");

    const result = await callAdministrationApi(
      (client) =>
        Effect.gen(function* () {
          const withActivity = yield* client.getCustomerReservationActivity({
            params: { customerId },
          });
          const withoutActivity = yield* client.getCustomerReservationActivity({
            params: { customerId: unavailableCustomerId },
          });
          return { withActivity, withoutActivity };
        }),
      { administration }
    );

    expect(requests).toEqual([customerId, unavailableCustomerId]);
    expect(result).toEqual({
      withActivity: withDates,
      withoutActivity: unavailable,
    });
  });

  test("returns reservation activity with dates or unavailable dates", async () => {
    const withDates = {
      from: "2025-10-23",
      to: "2026-10-22",
      dates: [{ date: "2026-10-20", count: 2 }],
    };
    const unavailable = {
      from: "2025-10-23",
      to: "2026-10-22",
      dates: null,
    };
    let calls = 0;
    const administration = Layer.succeed(AdministrationService, {
      ...({} as AdministrationService["Service"]),
      loadReservationActivity: () => {
        calls += 1;
        return Effect.succeed(calls === 1 ? withDates : unavailable);
      },
    });

    const result = await callAdministrationApi(
      (client) =>
        Effect.gen(function* () {
          const withActivity = yield* client.getReservationActivity({});
          const withoutActivity = yield* client.getReservationActivity({});
          return { withActivity, withoutActivity };
        }),
      { administration }
    );

    expect(calls).toBe(2);
    expect(result).toEqual({
      withActivity: withDates,
      withoutActivity: unavailable,
    });
  });

  test("serves each instance's own caller when instances share a memo map", async () => {
    const instances = ["first", "second"] as const;
    type Instance = (typeof instances)[number];
    const callerOf = (instance: Instance) => ({
      actor: {
        accountId: customerAccountIdSchema.make(`account-${instance}`),
        email: testEmailAddress(instance),
      },
      channel: {
        _tag: "CliSession" as const,
        sessionId: CliSessionId.make(
          instance === "first"
            ? "01980000-0000-7000-8000-0000000000a1"
            : "01980000-0000-7000-8000-0000000000a2"
        ),
      },
    });
    // Each instance accepts only the bearer named after it.
    const authenticationOf = (instance: Instance) =>
      Layer.succeed(AdministrationAuthentication, {
        bearer: (httpEffect, { credential }) =>
          Redacted.value(credential) === instance
            ? Effect.provideService(
                httpEffect,
                CurrentAdministrationCaller,
                callerOf(instance)
              )
            : Effect.fail(
                new CliSessionUnauthorized({ message: "Not this instance." })
              ),
      });
    const sessionOwners: Array<string> = [];
    const ledger = recordingRequestLedger(
      new CliMutationInProgress({
        message: "Mutation is already running.",
        requestId: Schema.decodeUnknownSync(CliMutationRequestId)(
          "01980000-0000-7000-8000-0000000000b1"
        ),
      })
    );
    const services = Layer.mergeAll(
      Layer.succeed(CliAuthentication, {
        ...({} as CliAuthentication["Service"]),
        listSessions: (owner) =>
          Effect.sync(() => {
            sessionOwners.push(owner);
            return [];
          }),
      }),
      ledger.layer,
      Layer.succeed(CliAuthenticationAdmission, {} as never),
      Layer.succeed(AdministrationService, {} as never),
      Layer.succeed(AdministratorRoster, {} as never),
      Layer.succeed(LegacyAdministratorBackfill, {} as never),
      Layer.succeed(CampaignOperations, {} as never),
      UnusedReservationAdministration,
      UnusedReservationProductDetailsBackfill,
      UnusedReservationAccessAdministration,
      UnusedDiscountAdministration,
      UnusedInvoiceAdministration,
      UnusedStandaloneAccessCodeAdministration,
      DiscardedAdministrationActionLog,
      NodeHttpServer.layerHttpServices
    );
    const request = (
      handler: (request: Request) => Promise<Response>,
      bearer: Instance,
      init: RequestInit & { readonly path: string }
    ) =>
      handler(
        new Request(`https://workspace.deskohub.test/api/v1/cli${init.path}`, {
          ...init,
          headers: {
            authorization: `Bearer ${bearer}`,
            "content-type": "application/json",
          },
        })
      );
    const listSessions = { path: "/sessions" };
    const deleteCode = {
      path: "/discounts/mutations",
      method: "POST",
      body: JSON.stringify({
        requestId: "01980000-0000-7000-8000-0000000000b1",
        mutation: {
          kind: "delete-code",
          id: "01980000-0000-7000-8000-0000000000c1",
        },
      }),
    };

    for (const order of [instances, [...instances].reverse()]) {
      sessionOwners.length = 0;
      ledger.requests.length = 0;
      const memoMap = Layer.makeMemoMapUnsafe();
      const handlers = Object.fromEntries(
        instances.map((instance) => [
          instance,
          HttpRouter.toWebHandler(
            makeWorkspaceAdminApiLayer({
              authentication: authenticationOf(instance),
              sessionAuthentication: CliBearerAuthenticationLive,
              clientCompatibility: CliClientCompatibilityLive,
            }).pipe(Layer.provide(services)),
            { disableLogger: true, memoMap }
          ),
        ])
      ) as Record<
        Instance,
        ReturnType<typeof HttpRouter.toWebHandler<never, never, never, never>>
      >;

      const statuses: Array<[string, number, string | null]> = [];
      for (const instance of [...order, order[0]]) {
        const other = instance === "first" ? "second" : "first";
        const { handler } = handlers[instance];
        for (const [name, response] of [
          ["own sessions", await request(handler, instance, listSessions)],
          ["other's sessions", await request(handler, other, listSessions)],
          ["own mutation", await request(handler, instance, deleteCode)],
        ] as const) {
          statuses.push([
            `${instance} ${name}`,
            response.status,
            response.headers.get("cache-control"),
          ]);
        }
      }
      await Promise.all(
        Object.values(handlers).map((handler) => handler.dispose())
      );

      expect(statuses).toEqual(
        [...order, order[0]].flatMap((instance) => [
          [`${instance} own sessions`, 200, "private, no-store"],
          [`${instance} other's sessions`, 401, "private, no-store"],
          [`${instance} own mutation`, 409, "private, no-store"],
        ])
      );
      expect(sessionOwners).toEqual(
        [...order, order[0]].map(
          (instance) => callerOf(instance).actor.accountId
        )
      );
      expect(ledger.requests.map((request) => request.channel)).toEqual(
        [...order, order[0]].map((instance) => callerOf(instance).channel)
      );
    }
  });

  test("runs one product-details backfill batch with the requested options", async () => {
    const requests: unknown[] = [];
    const batch: ReservationProductDetailsBackfillBatch = {
      updated: 2,
      alreadyComplete: 1,
      unresolved: [
        {
          reservationId: workspaceReservationIdSchema.make("reservation-b"),
          family: "office",
          reason: "dotypos_seats_invalid",
        },
      ],
      nextCursor: workspaceReservationIdSchema.make("reservation-c"),
    };
    const backfill = Layer.succeed(ReservationProductDetailsBackfill, {
      runBatch: (input) => {
        requests.push(input);
        return Effect.succeed(batch);
      },
    });

    const result = await Effect.gen(function* () {
      const client = yield* HttpApiTest.groups(WorkspaceAdminApi, [
        "administration",
      ]);
      return yield* client.administration.backfillReservationProductDetails({
        payload: {
          dryRun: true,
          after: AdministrationWorkspaceReservationId.make("reservation-a"),
        },
      });
    }).pipe(
      Effect.provide(AdminCliAdministrationApiHandlers),
      Effect.provide(AuthorizedCliRequest),
      Effect.provide(UnusedStandaloneAccessCodeAdministration),
      Effect.provide(ClaimEveryCliMutation),
      Effect.provide(UnusedInvoiceAdministration),
      Effect.provide(UnusedReservationAdministration),
      Effect.provide(backfill),
      Effect.provide(UnusedDiscountAdministration),
      Effect.provide(SessionAdministratorAuthentication),
      Effect.provide(Layer.succeed(AdministrationService, {} as never)),
      Effect.provide(UnusedReservationAccessAdministration),
      Effect.provide(CliClientCompatibilityLive),
      Effect.provide(UnrecordedAdministrationActions),
      Effect.provide(NodeHttpServer.layerHttpServices),
      Effect.scoped,
      Effect.runPromise
    );

    expect(requests).toEqual([{ dryRun: true, after: "reservation-a" }]);
    expect(result).toEqual(batch);
  });

  test("lists discount groups and maps a failed service to unavailable", async () => {
    const calls: string[] = [];
    const discounts = Layer.succeed(DiscountAdministration, {
      ...({} as DiscountAdministration["Service"]),
      listDiscountGroups: () => {
        calls.push("list");
        return calls.length === 1
          ? Effect.succeed([
              { id: "10", name: "  Group Ten  " },
              { id: "11", name: null },
            ])
          : Effect.fail(
              new DotyposRejected({
                operation: "getDiscountGroups",
                reason: "invalid-response",
                message: "Synthetic provider failure",
              })
            );
      },
    });

    const result = await callAdministrationApi(
      (client) =>
        Effect.gen(function* () {
          const groups = yield* client.listDiscountGroups({});
          const unavailable = yield* client
            .listDiscountGroups({})
            .pipe(Effect.flip);
          return { groups, unavailable };
        }),
      { discounts }
    );

    expect(result.groups).toEqual({
      discountGroups: [
        { id: "10", name: "  Group Ten  " },
        { id: "11", name: null },
      ],
    });
    expect(result.unavailable).toBeInstanceOf(CliServiceUnavailable);
    expect(calls).toEqual(["list", "list"]);
  });

  test("logs the original failure before reporting the service as unavailable", async () => {
    const logRecords: { readonly level: string; readonly text: string }[] = [];
    const capturingLogger = Logger.make<unknown, void>(
      ({ logLevel, message }) => {
        logRecords.push({ level: logLevel, text: JSON.stringify(message) });
      }
    );
    const failingAdministration = Layer.succeed(AdministrationService, {
      ...({} as AdministrationService["Service"]),
      listReservations: () =>
        Effect.fail(
          new EffectDrizzleQueryError({
            query: "select from workspace reservations",
            params: [],
            cause: new Error("database unavailable"),
          })
        ),
    });

    const error = await Effect.gen(function* () {
      const client = yield* HttpApiTest.groups(WorkspaceAdminApi, [
        "administration",
      ]);
      return yield* client.administration
        .listReservations({ query: {} })
        .pipe(Effect.flip);
    }).pipe(
      Effect.provide(AdminCliAdministrationApiHandlers),
      Effect.provide(ActorAuthorizedCliRequest),
      Effect.provide(UnusedStandaloneAccessCodeAdministration),
      Effect.provide(ClaimEveryCliMutation),
      Effect.provide(UnusedInvoiceAdministration),
      Effect.provide(UnusedReservationAdministration),
      Effect.provide(UnusedReservationProductDetailsBackfill),
      Effect.provide(UnusedDiscountAdministration),
      Effect.provide(SessionAdministratorAuthentication),
      Effect.provide(failingAdministration),
      Effect.provide(UnusedReservationAccessAdministration),
      Effect.provide(CliClientCompatibilityLive),
      Effect.provide(UnrecordedAdministrationActions),
      Effect.provide(NodeHttpServer.layerHttpServices),
      Effect.scoped,
      Effect.withLogger(capturingLogger),
      Effect.runPromise
    );

    expect(error).toBeInstanceOf(CliServiceUnavailable);
    expect(
      logRecords.some(
        ({ level, text }) =>
          level === "Error" &&
          text.includes("select from workspace reservations")
      )
    ).toBe(true);
  });

  test("returns invoice creation defaults", async () => {
    const defaults = {
      currencies: [{ code: "CZK", exponent: 2, name: "Czech koruna" }],
      defaultCurrency: "CZK",
      defaultServiceDate: "2026-10-22",
      defaultDueDate: "2026-11-05",
      suggestedVariableSymbol: "26000001",
    };
    const invoices = Layer.succeed(InvoiceAdministrationService, {
      ...({} as InvoiceAdministrationService["Service"]),
      getCreationDefaults: () => Effect.succeed(defaults),
    });

    const result = await callAdministrationApi(
      (client) => client.getInvoiceCreationDefaults({}),
      { invoices }
    );

    expect(result).toEqual(defaults);
  });

  test("previews an invoice with CLI administrator provenance", async () => {
    const pdf = new Uint8Array([37, 80, 68, 70]);
    const previews: unknown[] = [];
    const invoices = Layer.succeed(InvoiceAdministrationService, {
      ...({} as InvoiceAdministrationService["Service"]),
      preview: (input, provenance) => {
        previews.push({ input, provenance });
        return Effect.succeed(pdf);
      },
    });

    const result = await callAdministrationApi(
      (client) => client.previewInvoice({ payload: invoicePreviewPayload }),
      { invoices }
    );

    expect(result).toEqual(pdf);
    expect(previews).toEqual([
      {
        input: invoicePreviewPayload,
        provenance: { source: "dhw-cli", administrator: cliAdministrator },
      },
    ]);
  });

  test("maps invoice preview validation failures to a rejected mutation", async () => {
    const invoices = Layer.succeed(InvoiceAdministrationService, {
      ...({} as InvoiceAdministrationService["Service"]),
      preview: () =>
        Effect.fail(
          new ManualInvoiceValidationError({
            message: "Synthetic invoice validation failure.",
          })
        ),
    });

    const error = await callAdministrationApi(
      (client) =>
        client
          .previewInvoice({ payload: invoicePreviewPayload })
          .pipe(Effect.flip),
      { invoices }
    );

    expect(error).toBeInstanceOf(CliMutationRejected);
  });

  test("maps an in-progress invoice claim for retry without changing provenance", async () => {
    const creations: unknown[] = [];
    const invoiceAdministration = Layer.succeed(InvoiceAdministrationService, {
      ...({} as InvoiceAdministrationService["Service"]),
      create: (input, provenance) => {
        creations.push({ input, provenance });
        return creations.length === 1
          ? Effect.fail(
              new InvoiceAdministrationInProgressError({
                invoiceId: input.invoiceId,
                message: "The invoice is still being created.",
              })
            )
          : Effect.succeed({
              invoiceId: input.invoiceId,
              invoiceNumber: "WS-FV-2026-000001",
              changed: true,
              needsAttention: false,
            });
      },
    });
    const payload = {
      invoiceId: "01980000-0000-7000-8000-000000000009",
      customer: {
        kind: "new" as const,
        details: {
          kind: "person" as const,
          email: testEmailAddress("synthetic"),
          firstName: "Synthetic",
          lastName: "Customer",
          address: {
            line1: "Test street 1",
            city: "Prague",
            postalCode: "100 00",
            country: "CZ",
          },
        },
      },
      locale: "cs-CZ" as const,
      serviceDate: "2026-08-10",
      payment: { status: "due" as const, date: "2026-08-24" },
      currency: "CZK",
      lines: [{ description: "Space rental", price: "1000" }],
    };

    const result = await Effect.gen(function* () {
      const client = yield* HttpApiTest.groups(WorkspaceAdminApi, [
        "administration",
      ]);
      const pending = yield* client.administration
        .createInvoice({ payload })
        .pipe(Effect.flip);
      const created = yield* client.administration.createInvoice({ payload });
      return { created, pending };
    }).pipe(
      Effect.provide(AdminCliAdministrationApiHandlers),
      Effect.provide(ActorAuthorizedCliRequest),
      Effect.provide(invoiceAdministration),
      Effect.provide(ClaimEveryCliMutation),
      Effect.provide(UnusedAdministrationService),
      Effect.provide(UnusedReservationAdministration),
      Effect.provide(UnusedReservationProductDetailsBackfill),
      Effect.provide(UnusedReservationAccessAdministration),
      Effect.provide(UnusedDiscountAdministration),
      Effect.provide(UnusedStandaloneAccessCodeAdministration),
      Effect.provide(SessionAdministratorAuthentication),
      Effect.provide(CliClientCompatibilityLive),
      Effect.provide(UnrecordedAdministrationActions),
      Effect.provide(NodeHttpServer.layerHttpServices),
      Effect.scoped,
      Effect.runPromise
    );

    expect(result.pending).toBeInstanceOf(CliMutationInProgress);
    expect(result.pending.requestId).toBe(payload.invoiceId);
    expect(result.created.invoiceId).toBe(payload.invoiceId);
    expect(creations).toEqual([
      {
        input: payload,
        provenance: { source: "dhw-cli", administrator: cliAdministrator },
      },
      {
        input: payload,
        provenance: { source: "dhw-cli", administrator: cliAdministrator },
      },
    ]);
  });

  test("bounds unauthenticated authentication starts before database writes", async () => {
    const challenge = Schema.decodeUnknownSync(CliAuthenticationChallenge)(
      "h".repeat(43)
    );
    const code = Schema.decodeUnknownSync(CliAuthenticationCode)(
      "c".repeat(43)
    );
    let starts = 0;
    let admissionChecks = 0;
    const authentication = Layer.succeed(CliAuthentication, {
      ...({} as CliAuthentication["Service"]),
      start: () =>
        Effect.sync(() => {
          starts += 1;
          return {
            code,
            approvalPath: `/admin/cli/authenticate?code=${code}`,
            expiresAt: "2026-08-10T10:00:00.000Z",
          };
        }),
    });
    const admission = Layer.succeed(CliAuthenticationAdmission, {
      isStartAllowed: Effect.sync(() => {
        admissionChecks += 1;
        return admissionChecks <= 10;
      }),
    });

    const results = await Effect.gen(function* () {
      const client = yield* HttpApiTest.groups(WorkspaceAdminApi, ["cli"]);
      return yield* Effect.forEach(
        Array.from({ length: 11 }),
        () =>
          client.cli
            .startAuthentication({
              payload: {
                challenge,
                clientName: "rate limit test",
                cliVersion: "1.0.0",
                buildTarget: "development",
              },
            })
            .pipe(Effect.result),
        { concurrency: 1 }
      );
    }).pipe(
      Effect.provide(AdminCliApiHandlers),
      Effect.provide(AuthorizedCliRequest),
      Effect.provide(admission),
      Effect.provide(authentication),
      Effect.provide(CliClientCompatibilityLive),
      Effect.provide(UnrecordedAdministrationActions),
      Effect.provide(NodeHttpServer.layerHttpServices),
      Effect.scoped,
      Effect.runPromise
    );

    expect(results.filter(Result.isFailure)).toHaveLength(1);
    expect(starts).toBe(10);
  });

  test("returns safe access metadata and maps invalid recovery", async () => {
    const instant = Temporal.Instant.from("2026-08-10T10:00:00Z");
    const requestId = Schema.decodeUnknownSync(CliMutationRequestId)(
      "01980000-0000-7000-8000-000000000020"
    );
    const rejectedRequestId = Schema.decodeUnknownSync(CliMutationRequestId)(
      "01980000-0000-7000-8000-000000000021"
    );
    const grant = {
      id: "access-1" as ReservationAccessGrant["id"],
      reservationId: "reservation-1",
      provider: "igloohome",
      credentialType: "algopin-hourly",
      deviceId: "EK1X16f8898a",
      state: "issued" as const,
      providerCredentialId: "pin-1",
      accessName: "Deskohub reservation-1",
      scheduledAccessStartsAt: instant,
      accessStartsAt: instant,
      accessEndsAt: instant,
      provisioningStartedAt: instant,
      issuedAt: instant,
      failedAt: null,
      failureCode: null,
      createdAt: instant,
      updatedAt: instant,
    } satisfies ReservationAccessGrant;
    const domainInputs: Array<
      Parameters<ReservationAccessAdministration["Service"]["mutate"]>[0]
    > = [];
    const reservationAccess = Layer.succeed(ReservationAccessAdministration, {
      mutate: (input) => {
        domainInputs.push(input);
        return input.kind === "retry-failed"
          ? Effect.succeed(grant)
          : Effect.fail(
              new ReservationAccessAdministrationError({
                reason: "invalid_state",
                message: "Only uncertain access can be reconciled.",
              })
            );
      },
      resumeInterruptedMutation: () => Effect.succeed(grant),
    });
    const ledger = recordingRequestLedger();
    const result = await Effect.gen(function* () {
      const client = yield* HttpApiTest.groups(WorkspaceAdminApi, [
        "administration",
      ]);
      const recovered = yield* client.administration.mutateReservationAccess({
        params: { reservationId: grant.reservationId },
        payload: { requestId, mutation: { kind: "retry-failed" } },
      });
      const rejected = yield* client.administration
        .mutateReservationAccess({
          params: { reservationId: grant.reservationId },
          payload: {
            requestId: rejectedRequestId,
            mutation: {
              kind: "confirm-provider-credential-removed",
              providerCredentialRemoved: true,
            },
          },
        })
        .pipe(Effect.flip);
      return { recovered, rejected };
    }).pipe(
      Effect.provide(AdminCliAdministrationApiHandlers),
      Effect.provide(AuthorizedCliRequest),
      Effect.provide(ledger.layer),
      Effect.provide(UnusedInvoiceAdministration),
      Effect.provide(UnusedStandaloneAccessCodeAdministration),
      Effect.provide(UnusedReservationAdministration),
      Effect.provide(UnusedReservationProductDetailsBackfill),
      Effect.provide(UnusedDiscountAdministration),
      Effect.provide(SessionAdministratorAuthentication),
      Effect.provide(
        Layer.succeed(
          AdministrationService,
          {} as AdministrationService["Service"]
        )
      ),
      Effect.provide(reservationAccess),
      Effect.provide(CliClientCompatibilityLive),
      Effect.provide(UnrecordedAdministrationActions),
      Effect.provide(NodeHttpServer.layerHttpServices),
      Effect.scoped,
      Effect.runPromise
    );

    expect(result.recovered.state).toBe("issued");
    expect(result.recovered.accessName).toBe("Deskohub reservation-1");
    expect("accessCode" in result.recovered).toBe(false);
    expect(result.rejected).toBeInstanceOf(CliMutationRejected);
    expect(domainInputs).toEqual([
      { reservationId: grant.reservationId, kind: "retry-failed" },
      {
        reservationId: grant.reservationId,
        kind: "confirm-provider-credential-removed",
        providerCredentialRemoved: true,
      },
    ]);
    expect(ledger.requests).toHaveLength(2);
    expect(ledger.requests[0]).toMatchObject({
      requestId,
      mutation: {
        kind: "reservation-access",
        reservationId: grant.reservationId,
        mutation: { kind: "retry-failed" },
      },
      inProgressMessage:
        "This reservation access mutation is still being applied. Retrying with the same request identifier is safe.",
    });
    expect(ledger.requests[0]?.recovery).toBe(reservationAccessRecovery);
    expect(ledger.requests[0]?.resume).toBeDefined();
    expect(ledger.requests[1]?.recovery).toBe(reservationAccessRecovery);
    expect(ledger.requests[1]?.resume).toBeDefined();
  });

  test("scopes every session control operation to the authenticated session owner", async () => {
    const ownedSessionId = Schema.decodeUnknownSync(CliSessionId)(
      "01980000-0000-7000-8000-000000000001"
    );
    const foreignSessionId = Schema.decodeUnknownSync(CliSessionId)(
      "01980000-0000-7000-8000-000000000002"
    );
    const unknownSessionId = Schema.decodeUnknownSync(CliSessionId)(
      "01980000-0000-7000-8000-000000000003"
    );
    const calls: Array<readonly [string, unknown]> = [];
    const record = <A>(name: string, input: A) =>
      Effect.sync(() => {
        calls.push([name, input]);
      });
    const authentication = Layer.succeed(CliAuthentication, {
      ...({} as CliAuthentication["Service"]),
      sessionAdministrator: () => Effect.succeed(cliAdministrator),
      listSessions: (owner) =>
        record("listSessions", owner).pipe(
          Effect.as([
            {
              ...session,
              ...cliAdministratorApprover,
              revokedAt: null,
              status: "active" as const,
            },
          ])
        ),
      renameSession: (input) =>
        record("renameSession", input).pipe(
          Effect.as(input.sessionId === ownedSessionId)
        ),
      revoke: (input) =>
        record("revokeSession", input).pipe(
          Effect.as(input.sessionId === ownedSessionId)
        ),
    });

    const result = await Effect.gen(function* () {
      const client = yield* HttpApiTest.groups(WorkspaceAdminApi, [
        "administration",
      ]);
      const sessions = yield* client.administration.listSessions({});
      const renamed = yield* client.administration.renameSession({
        params: { sessionId: ownedSessionId },
        payload: { clientName: "Alice laptop" },
      });
      const foreignRename = yield* client.administration
        .renameSession({
          params: { sessionId: foreignSessionId },
          payload: { clientName: "Stolen label" },
        })
        .pipe(Effect.flip);
      const unknownRename = yield* client.administration
        .renameSession({
          params: { sessionId: unknownSessionId },
          payload: { clientName: "Nobody" },
        })
        .pipe(Effect.flip);
      const revoked = yield* client.administration.revokeSession({
        params: { sessionId: ownedSessionId },
      });
      const foreignRevoke = yield* client.administration.revokeSession({
        params: { sessionId: foreignSessionId },
      });
      const unknownRevoke = yield* client.administration.revokeSession({
        params: { sessionId: unknownSessionId },
      });
      return {
        foreignRename,
        foreignRevoke,
        renamed,
        revoked,
        sessions,
        unknownRename,
        unknownRevoke,
      };
    }).pipe(
      Effect.provide(AdminCliAdministrationApiHandlers),
      Effect.provide(ActorAuthorizedCliRequest),
      Effect.provide(authentication),
      Effect.provide(
        Layer.succeed(
          AdministrationService,
          {} as AdministrationService["Service"]
        )
      ),
      Effect.provide(UnusedReservationAdministration),
      Effect.provide(UnusedReservationProductDetailsBackfill),
      Effect.provide(UnusedReservationAccessAdministration),
      Effect.provide(UnusedDiscountAdministration),
      Effect.provide(UnusedInvoiceAdministration),
      Effect.provide(UnusedStandaloneAccessCodeAdministration),
      Effect.provide(ClaimEveryCliMutation),
      Effect.provide(CliClientCompatibilityLive),
      Effect.provide(UnrecordedAdministrationActions),
      Effect.provide(NodeHttpServer.layerHttpServices),
      Effect.scoped,
      Effect.runPromise
    );

    expect(result.sessions).toEqual([
      { ...session, ...cliAdministratorApprover, revokedAt: null },
    ]);
    expect(result.renamed).toEqual({ changed: true });
    expect(result.revoked).toEqual({ changed: true });
    expect(result.foreignRename).toBeInstanceOf(CliResourceNotFound);
    expect(result.unknownRename).toBeInstanceOf(CliResourceNotFound);
    expect(result.foreignRevoke).toEqual({ changed: false });
    expect(result.unknownRevoke).toEqual({ changed: false });
    expect(calls).toEqual([
      ["listSessions", cliAdministrator.accountId],
      [
        "renameSession",
        {
          owner: cliAdministrator.accountId,
          sessionId: ownedSessionId,
          clientName: "Alice laptop",
        },
      ],
      [
        "renameSession",
        {
          owner: cliAdministrator.accountId,
          sessionId: foreignSessionId,
          clientName: "Stolen label",
        },
      ],
      [
        "renameSession",
        {
          owner: cliAdministrator.accountId,
          sessionId: unknownSessionId,
          clientName: "Nobody",
        },
      ],
      [
        "revokeSession",
        { owner: cliAdministrator.accountId, sessionId: ownedSessionId },
      ],
      [
        "revokeSession",
        { owner: cliAdministrator.accountId, sessionId: foreignSessionId },
      ],
      [
        "revokeSession",
        { owner: cliAdministrator.accountId, sessionId: unknownSessionId },
      ],
    ]);
  });

  test("fails session control closed without touching the service when the session's administrator can't be resolved", async () => {
    let serviceCalls = 0;
    const authentication = Layer.succeed(CliAuthentication, {
      ...({} as CliAuthentication["Service"]),
      authenticateSession: () =>
        Effect.succeed({ ...session, id: CliSessionId.make(session.id) }),
      sessionAdministrator: () =>
        Effect.fail(
          new CliSessionUnauthorized({ message: "No approving administrator." })
        ),
      listSessions: () =>
        Effect.sync(() => {
          serviceCalls += 1;
          return [];
        }),
      renameSession: () =>
        Effect.sync(() => {
          serviceCalls += 1;
          return true;
        }),
      revoke: () =>
        Effect.sync(() => {
          serviceCalls += 1;
          return true;
        }),
    });
    const sessionId = Schema.decodeUnknownSync(CliSessionId)(
      "01980000-0000-7000-8000-000000000004"
    );

    const result = await Effect.gen(function* () {
      const client = yield* HttpApiTest.groups(WorkspaceAdminApi, [
        "administration",
      ]);
      const sessions = yield* client.administration
        .listSessions({})
        .pipe(Effect.flip);
      const renamed = yield* client.administration
        .renameSession({
          params: { sessionId },
          payload: { clientName: "Legacy" },
        })
        .pipe(Effect.flip);
      const revoked = yield* client.administration
        .revokeSession({ params: { sessionId } })
        .pipe(Effect.flip);
      return { renamed, revoked, sessions };
    }).pipe(
      Effect.provide(AdminCliAdministrationApiHandlers),
      Effect.provide(
        Layer.mergeAll(
          CliSessionAdministrationAuthenticationLive,
          UnusedCliSessionAuthentication
        )
      ),
      Effect.provide(authentication),
      Effect.provide(
        Layer.succeed(
          AdministrationService,
          {} as AdministrationService["Service"]
        )
      ),
      Effect.provide(UnusedReservationAdministration),
      Effect.provide(UnusedReservationProductDetailsBackfill),
      Effect.provide(UnusedReservationAccessAdministration),
      Effect.provide(UnusedDiscountAdministration),
      Effect.provide(UnusedInvoiceAdministration),
      Effect.provide(UnusedStandaloneAccessCodeAdministration),
      Effect.provide(ClaimEveryCliMutation),
      Effect.provide(CliClientCompatibilityLive),
      Effect.provide(UnrecordedAdministrationActions),
      Effect.provide(NodeHttpServer.layerHttpServices),
      Effect.scoped,
      Effect.runPromise
    );

    expect(result.sessions).toBeInstanceOf(CliSessionUnauthorized);
    expect(result.renamed).toBeInstanceOf(CliSessionUnauthorized);
    expect(result.revoked).toBeInstanceOf(CliSessionUnauthorized);
    expect(serviceCalls).toBe(0);
  });

  test("records the discount mutation request and maps domain conflicts", async () => {
    const discountId = Schema.decodeUnknownSync(AdministrationStoredDiscountId)(
      "01980000-0000-7000-8000-000000000001"
    );
    const requestId = Schema.decodeUnknownSync(CliMutationRequestId)(
      "01980000-0000-7000-8000-000000000010"
    );
    const mutation = { kind: "delete-discount" as const, id: discountId };
    const ledger = recordingRequestLedger();
    const domainInputs: Array<{ readonly id: AdministrationStoredDiscountId }> =
      [];
    const discounts = Layer.succeed(DiscountAdministration, {
      ...({} as DiscountAdministration["Service"]),
      deleteDiscount: (input) =>
        Effect.sync(() => domainInputs.push(input)).pipe(
          Effect.andThen(
            new DiscountAdminConflictError({
              reason: "discount-referenced",
              message: "This discount is still referenced.",
            })
          )
        ),
    });

    const error = await Effect.gen(function* () {
      const client = yield* HttpApiTest.groups(WorkspaceAdminApi, [
        "administration",
      ]);
      return yield* client.administration
        .mutateDiscounts({ payload: { requestId, mutation } })
        .pipe(Effect.flip);
    }).pipe(
      Effect.provide(AdminCliAdministrationApiHandlers),
      Effect.provide(AuthorizedCliRequest),
      Effect.provide(ledger.layer),
      Effect.provide(UnusedInvoiceAdministration),
      Effect.provide(UnusedStandaloneAccessCodeAdministration),
      Effect.provide(UnusedReservationAdministration),
      Effect.provide(UnusedReservationProductDetailsBackfill),
      Effect.provide(discounts),
      Effect.provide(SessionAdministratorAuthentication),
      Effect.provide(
        Layer.succeed(
          AdministrationService,
          {} as AdministrationService["Service"]
        )
      ),
      Effect.provide(UnusedReservationAccessAdministration),
      Effect.provide(CliClientCompatibilityLive),
      Effect.provide(UnrecordedAdministrationActions),
      Effect.provide(NodeHttpServer.layerHttpServices),
      Effect.scoped,
      Effect.runPromise
    );

    expect(error).toBeInstanceOf(CliMutationRejected);
    expect(domainInputs).toEqual([{ id: discountId }]);
    expect(ledger.requests).toHaveLength(1);
    expect(ledger.requests[0]).toMatchObject({
      requestId,
      mutation,
      recovery: discountMutationRecovery,
    });
  });

  test("passes a code update's service dates through and rejects ones the service refuses", async () => {
    const requestId = Schema.decodeUnknownSync(CliMutationRequestId)(
      "01980000-0000-7000-8000-000000000011"
    );
    const updates: unknown[] = [];
    const discounts = Layer.succeed(DiscountAdministration, {
      ...({} as DiscountAdministration["Service"]),
      updateCode: (input) =>
        Effect.sync(() => updates.push(input)).pipe(
          Effect.andThen(
            new DiscountAdminServiceDatesError({
              message: "serviceDateUntil must not be before serviceDateFrom",
            })
          )
        ),
    });
    const serviceDates = {
      serviceDateFrom: "2026-07-01",
      serviceDateUntil: "2026-07-31",
    };

    const error = await callAdministrationApi(
      (client) =>
        client
          .mutateDiscounts({
            payload: {
              requestId,
              mutation: {
                kind: "update-code",
                code: Schema.decodeUnknownSync(
                  AdministrationDiscountCodeUpdateInput
                )({
                  id: "01980000-0000-7000-8000-000000000002",
                  discountId: "01980000-0000-7000-8000-000000000001",
                  code: "SUMMER10",
                  enabled: true,
                  validFrom: null,
                  validUntil: null,
                  maxUses: null,
                  ...serviceDates,
                }),
              },
            },
          })
          .pipe(Effect.flip),
      { discounts }
    );

    expect(error).toBeInstanceOf(CliMutationRejected);
    expect(updates).toEqual([expect.objectContaining(serviceDates)]);
  });
});

describe("customer and reservation administration endpoints", () => {
  const instant = (value: string) => Temporal.Instant.from(value);

  test("returns the customer's discount profile with API timestamps", async () => {
    const customerId = AdministrationDotyposCustomerId.make("dotypos-customer");
    const activity = {
      reservations: [],
      reservationHistoryTruncated: false,
      transactions: [],
      transactionHistoryTruncated: false,
      stats: {
        reservationCount: 0,
        favoriteProduct: null,
        revenue: [],
        discountSavings: [],
      },
      marketingConsent: null,
    };
    const profileRequests: unknown[] = [];
    const profile = adminCustomerProfile({
      codes: [
        adminCustomerCode(),
        adminCustomerCode({
          validFrom: null,
          validUntil: null,
          serviceDateFrom: plainDateStringSchema.make("2026-08-03"),
          serviceDateUntil: plainDateStringSchema.make("2026-08-28"),
        }),
      ],
      claims: [
        adminCodeClaim(),
        adminCodeClaim({
          state: "released",
          redeemedAt: instant("2026-08-10T08:10:00Z"),
          releasedAt: instant("2026-08-10T08:20:00Z"),
        }),
      ],
      vouchers: [
        adminCustomerVoucher(),
        adminCustomerVoucher({
          validFrom: instant("2026-08-01T08:00:00Z"),
          validUntil: instant("2026-09-01T08:00:00Z"),
        }),
      ],
      voucherClaims: [
        adminVoucherClaim(),
        adminVoucherClaim({
          state: "released",
          redeemedAt: instant("2026-08-10T08:10:00Z"),
          releasedAt: instant("2026-08-10T08:20:00Z"),
        }),
      ],
    });
    const administration = Layer.succeed(AdministrationService, {
      ...({} as AdministrationService["Service"]),
      loadCustomerActivity: () => Effect.succeed(activity as never),
    });
    const discounts = Layer.succeed(DiscountAdministration, {
      ...({} as DiscountAdministration["Service"]),
      loadCustomerProfile: (input) => {
        profileRequests.push(input);
        return Effect.succeed(profile);
      },
    });

    const result = await callAdministrationApi(
      (client) => client.getCustomer({ params: { customerId } }),
      { administration, discounts }
    );

    expect(profileRequests).toEqual([{ customerId }]);
    expect(result.activity).toEqual(activity);
    const datedRange = {
      validFrom: "2026-08-01T08:00:00Z",
      validUntil: "2026-09-01T08:00:00Z",
    };
    const openRange = { validFrom: null, validUntil: null };
    const audit = {
      createdAt: "2026-07-01T08:00:00Z",
      updatedAt: "2026-07-02T08:00:00Z",
    };
    const reservedClaim = {
      reservationExpiresAt: "2026-08-10T09:00:00Z",
      reservedAt: "2026-08-10T08:00:00Z",
      redeemedAt: null,
      releasedAt: null,
    };
    const settledClaim = {
      ...reservedClaim,
      redeemedAt: "2026-08-10T08:10:00Z",
      releasedAt: "2026-08-10T08:20:00Z",
    };
    expect(result.profile).toMatchObject({
      codes: [
        {
          code: "SUMMER10",
          ...datedRange,
          ...audit,
          serviceDateFrom: null,
          serviceDateUntil: null,
        },
        {
          code: "SUMMER10",
          ...openRange,
          ...audit,
          serviceDateFrom: "2026-08-03",
          serviceDateUntil: "2026-08-28",
        },
      ],
      claims: [reservedClaim, settledClaim],
      vouchers: [
        { code: "GIFT100", ...openRange, ...audit },
        { code: "GIFT100", ...datedRange, ...audit },
      ],
      voucherClaims: [reservedClaim, settledClaim],
    });
  });

  test("maps each reservation cancellation failure to its API error", async () => {
    const reservationId = AdministrationWorkspaceReservationId.make(
      "01980000-0000-7000-8000-000000000001"
    );
    const failures = [
      { code: "not_found", reason: "not_found" },
      { code: "not_cancellable", reason: "invalid_state" },
      { code: "cancellation_failed", reason: "reservation_unavailable" },
    ] as const;
    const cancellations: unknown[] = [];
    const reservations = Layer.succeed(ReservationAdministrationService, {
      ...({} as ReservationAdministrationService["Service"]),
      cancel: (input) => {
        const failure = failures[cancellations.length];
        cancellations.push(input);
        return Effect.fail(
          new ReservationAdministrationError({
            code: failure?.code ?? "cancellation_failed",
            reason: failure?.reason ?? "reservation_unavailable",
            message: `Synthetic ${failure?.code} failure`,
          })
        );
      },
    });

    const errors = await callAdministrationApi(
      (client) =>
        Effect.forEach(failures, () =>
          client
            .cancelReservation({
              params: { reservationId },
              payload: {
                accessGrantUpdatedAt: null,
                providerCredentialRemoved: false,
                sendCancellationEmail: true,
              },
            })
            .pipe(Effect.flip)
        ),
      { reservations }
    );

    expect(cancellations).toHaveLength(3);
    expect(cancellations[0]).toEqual({
      accessGrantUpdatedAt: null,
      force: false,
      providerCredentialRemoved: false,
      reservationId,
      sendCancellationEmail: true,
    });
    expect(errors[0]).toBeInstanceOf(CliResourceNotFound);
    expect(errors[0]).toMatchObject({ message: "Synthetic not_found failure" });
    expect(errors[1]).toBeInstanceOf(CliMutationRejected);
    expect(errors[1]).toMatchObject({
      message: "Synthetic not_cancellable failure",
    });
    expect(errors[2]).toBeInstanceOf(CliServiceUnavailable);
  });

  /**
   * One administration API handler whose cancellations run through
   * `ReservationAdministrationService.perOperationOver`, as `Live`'s do, over
   * fakes of what it shares that count their builds. Each bearer acts as its
   * cohort's administrator, every flag is on for the open cohort's, and the
   * stored reservation sits on a table the seating map shows.
   */
  const cancellationHandler = (overlapping: number) => {
    const builds = { dotypos: 0, emails: 0, featureFlags: 0, reservations: 0 };
    const counted = <I>(name: keyof typeof builds, layer: Layer.Layer<I>) =>
      Layer.unwrap(
        Effect.sync(() => {
          builds[name] += 1;
          return layer;
        })
      );
    const administratorOf = (cohort: string) =>
      customerAccountIdSchema.make(`administrator-${cohort}`);
    const authentication = Layer.succeed(AdministrationAuthentication, {
      bearer: (httpEffect, { credential }) => {
        const cohort = Redacted.value(credential);
        return Effect.provideService(httpEffect, CurrentAdministrationCaller, {
          actor: {
            accountId: administratorOf(cohort),
            email: testEmailAddress(`administrator-${cohort}`),
          },
          channel: {
            _tag: "CliSession",
            sessionId: CliSessionId.make(session.id),
          },
        });
      },
    });
    const meetingPoint = makeMeetingPoint(overlapping);
    const featureFlags = featureFlagsByCohort(
      meetingPoint,
      Effect.map(Effect.serviceOption(CurrentAdministrationCaller), (caller) =>
        Option.isSome(caller) &&
        caller.value.actor.accountId === administratorOf("open")
          ? "open"
          : "closed"
      )
    );
    const emails: Array<{ readonly id: string; readonly tableMap: boolean }> =
      [];
    const stored = (id: string) =>
      ({
        id,
        activePaymentAttemptId: null,
        dotyposCustomerId: "customer-id",
        dotyposReservationId: `dotypos-${id}`,
        failureCode: null,
        fulfillmentState: "fulfilled",
        locale: "cs-CZ",
        paymentState: "paid",
        reservationDetails: {
          kind: "cowork",
          entryTier: "profi",
          coffee: false,
          monitorOption: "none",
        },
        reservationState: "confirmed",
        updatedAt: Temporal.Now.instant(),
      }) as never;
    const shared = Layer.mergeAll(
      counted(
        "dotypos",
        Layer.mock(DotyposService, {
          cancelReservation: () => Effect.void,
          getReservation: (id) =>
            Effect.succeed(
              Option.some({
                reservation: {
                  id,
                  _branchId: "branch",
                  _cloudId: "cloud",
                  _customerId: "customer-id",
                  _tableId: "table-id",
                  startDate: "2026-06-15T22:00:00.000Z",
                  endDate: "2026-06-16T22:00:00.000Z",
                  seats: "1",
                  status: "CONFIRMED",
                },
                customer: {
                  _cloudId: "cloud",
                  email: testEmailAddress("customer"),
                  firstName: "Synthetic",
                  lastName: "Customer",
                },
              }) as never
            ),
          getTables: () =>
            Effect.succeed([
              {
                _cloudId: "cloud",
                id: "table-id",
                name: "12",
                display: true,
                enabled: true,
                locationName: "Main room",
                seats: "1",
                tags: ["tier:profi"],
              },
            ] as never),
        })
      ),
      counted(
        "emails",
        Layer.mock(WorkspaceReservationEmailService, {
          sendCancellationEmail: ({ reservation }) =>
            Effect.sync(() => {
              emails.push({
                id: reservation.id,
                tableMap: reservation.placement.tableMap !== undefined,
              });
            }),
        })
      ),
      counted("featureFlags", featureFlags),
      counted(
        "reservations",
        Layer.mock(WorkspaceReservationRepository, {
          findById: (id) => Effect.succeed(stored(id)),
          claimAdministrationCancellation: ({ id }) =>
            Effect.succeed(stored(id)),
          markAdministrationCancelled: () => Effect.void,
          markAdministrationCancellationFailed: () => Effect.void,
        })
      )
    );
    const handle = toWorkspaceWebHandler(
      makeWorkspaceAdminApiLayer({
        authentication,
        sessionAuthentication: UnusedCliSessionAuthentication,
        clientCompatibility: CliClientCompatibilityLive,
      }).pipe(
        Layer.provide(
          Layer.mergeAll(
            ReservationAdministrationService.perOperationOver(shared),
            ClaimEveryCliMutation,
            DiscardedAdministrationActionLog,
            Layer.succeed(CliAuthentication, {} as never),
            Layer.succeed(CliAuthenticationAdmission, {} as never),
            UnusedAdministrationService,
            Layer.succeed(AdministratorRoster, {} as never),
            Layer.succeed(LegacyAdministratorBackfill, {} as never),
            Layer.succeed(CampaignOperations, {} as never),
            UnusedReservationProductDetailsBackfill,
            UnusedReservationAccessAdministration,
            UnusedDiscountAdministration,
            UnusedInvoiceAdministration,
            UnusedStandaloneAccessCodeAdministration
          )
        )
      )
    );
    /** Cancels `reservationId` as the administrator of `cohort`. */
    const cancel = (cohort: string, reservationId: string) =>
      handle(
        new Request(
          `https://workspace.deskohub.test/api/v1/cli/reservations/${reservationId}/cancellation`,
          {
            method: "POST",
            headers: {
              authorization: `Bearer ${cohort}`,
              "content-type": "application/json",
            },
            body: JSON.stringify({
              accessGrantUpdatedAt: null,
              providerCredentialRemoved: false,
              sendCancellationEmail: true,
            }),
          }
        )
      ).then(({ status }) => status);
    const sentEmails = () =>
      emails.toSorted((a, b) => a.id.localeCompare(b.id));
    return { builds, cancel, meetingPoint, sentEmails };
  };
  const cancelledReservationId = (suffix: string) =>
    AdministrationWorkspaceReservationId.make(
      `01980000-0000-7000-8000-0000000000${suffix}`
    );

  test("cancels overlapping requests' reservations under each request's own seating-map release", async () => {
    const cohorts = ["open", "closed"];
    const reservationIds = [
      cancelledReservationId("d1"),
      cancelledReservationId("d2"),
    ];
    const { cancel, meetingPoint, sentEmails } = cancellationHandler(
      cohorts.length
    );

    const statuses = await Promise.all(
      cohorts.map((cohort, index) =>
        cancel(cohort, reservationIds[index] ?? "")
      )
    );

    expect(statuses).toEqual([200, 200]);
    expect(sentEmails()).toEqual([
      { id: reservationIds[0], tableMap: true },
      { id: reservationIds[1], tableMap: false },
    ]);
    expect(Object.values(meetingPoint.arrivals())).toEqual([cohorts.length]);
  });

  test("builds what cancellations share once for overlapping and later requests", async () => {
    const overlapping = [
      { cohort: "open", reservationId: cancelledReservationId("e1") },
      { cohort: "closed", reservationId: cancelledReservationId("e2") },
    ];
    const later = [
      { cohort: "closed", reservationId: cancelledReservationId("e3") },
      { cohort: "open", reservationId: cancelledReservationId("e4") },
    ];
    const { builds, cancel, meetingPoint, sentEmails } = cancellationHandler(
      overlapping.length
    );

    const statuses = await Promise.all(
      overlapping.map(({ cohort, reservationId }) =>
        cancel(cohort, reservationId)
      )
    );
    for (const { cohort, reservationId } of later) {
      statuses.push(await cancel(cohort, reservationId));
    }

    expect(statuses).toEqual([200, 200, 200, 200]);
    expect(builds).toEqual({
      dotypos: 1,
      emails: 1,
      featureFlags: 1,
      reservations: 1,
    });
    expect(sentEmails()).toEqual(
      [...overlapping, ...later].map(({ cohort, reservationId }) => ({
        id: reservationId,
        tableMap: cohort === "open",
      }))
    );
    expect(Object.values(meetingPoint.arrivals())).toEqual([
      overlapping.length + later.length,
    ]);
  });
});

describe("standalone access-code CLI endpoint", () => {
  const attemptId = Schema.decodeUnknownSync(
    AdministrationStandaloneAccessCodeAttemptId
  )("01980000-0000-7000-8000-000000000042");
  const priorAttemptId = Schema.decodeUnknownSync(
    AdministrationStandaloneAccessCodeAttemptId
  )("01980000-0000-7000-8000-000000000041");
  const priorCleanupTarget = {
    attemptId: priorAttemptId,
    name: Schema.decodeUnknownSync(AdministrationStandaloneAccessCodeName)(
      "Old Booth"
    ),
  } satisfies AdministrationStandaloneAccessCodeCleanupTargetType;
  const payload = {
    attemptId,
    input: Schema.decodeUnknownSync(
      AdministrationStandaloneAccessCodeCreateInput
    )({
      name: "Booth A",
      startsAt: "2026-09-10T10:00",
      endsAt: "2026-09-10T12:00",
    }),
  };
  const createdOutcome = {
    outcome: "created",
    attemptId,
    providerCredentialId: Schema.decodeUnknownSync(
      AdministrationProviderCredentialId
    )("pin-1"),
    name: Schema.decodeUnknownSync(AdministrationStandaloneAccessCodeName)(
      "Booth A"
    ),
    startsAt: Schema.decodeUnknownSync(
      AdministrationWorkspaceSiteLocalWholeHourDateTime
    )("2026-09-10T10:00"),
    endsAt: Schema.decodeUnknownSync(
      AdministrationWorkspaceSiteLocalWholeHourDateTime
    )("2026-09-10T12:00"),
    issuedAt: Schema.decodeUnknownSync(AdministrationInstant)(
      "2026-09-10T08:00:00Z"
    ),
    pin: Schema.decodeUnknownSync(AdministrationStandaloneAccessCodePin)(
      "7654321"
    ),
  } satisfies AdministrationStandaloneAccessCodeCreationOutcomeType;
  const creationFailure = (
    outcome: StandaloneAccessCodeCreationError["outcome"],
    message: string,
    details: {
      readonly cleanupTarget?: AdministrationStandaloneAccessCodeCleanupTargetType;
    } = {}
  ) =>
    new StandaloneAccessCodeCreationError({
      attemptId,
      outcome,
      message,
      ...details,
    });

  const runAdministration = <A, E, R>(
    bearer: Layer.Layer<AdministrationAuthentication, never, CliAuthentication>,
    standalone: Layer.Layer<StandaloneAccessCodeAdministration>,
    idempotency: Layer.Layer<AdministrationRequestLedger>,
    operation: Effect.Effect<A, E, R>,
    authentication: Layer.Layer<CliAuthentication> = SessionAdministratorAuthentication
  ) =>
    operation.pipe(
      Effect.provide(AdminCliAdministrationApiHandlers),
      Effect.provide(bearer),
      Effect.provide(UnusedCliSessionAuthentication),
      Effect.provide(standalone),
      Effect.provide(idempotency),
      Effect.provide(UnusedInvoiceAdministration),
      Effect.provide(UnusedReservationAdministration),
      Effect.provide(UnusedReservationProductDetailsBackfill),
      Effect.provide(UnusedDiscountAdministration),
      Effect.provide(authentication),
      Effect.provide(
        Layer.succeed(
          AdministrationService,
          {} as AdministrationService["Service"]
        )
      ),
      Effect.provide(UnusedReservationAccessAdministration),
      Effect.provide(CliClientCompatibilityLive),
      Effect.provide(UnrecordedAdministrationActions),
      Effect.provide(NodeHttpServer.layerHttpServices),
      Effect.scoped
    );

  const createAccessCode = (
    requestPayload: typeof payload & {
      readonly providerCredentialRemovedAttemptId?: AdministrationStandaloneAccessCodeAttemptIdType;
    } = payload
  ) =>
    Effect.gen(function* () {
      const client = yield* HttpApiTest.groups(WorkspaceAdminApi, [
        "administration",
      ]);
      return yield* client.administration.createStandaloneAccessCode({
        payload: requestPayload,
      });
    });
  const createAccessCodeError = (
    requestPayload?: Parameters<typeof createAccessCode>[0]
  ) => createAccessCode(requestPayload).pipe(Effect.flip);

  test("returns the PIN once and wires the standalone mutation", async () => {
    const creations: unknown[] = [];
    const standalone = Layer.succeed(StandaloneAccessCodeAdministration, {
      create: (input) =>
        Effect.sync(() => creations.push(input)).pipe(
          Effect.as(createdOutcome)
        ),
    });
    const ledger = recordingRequestLedger();
    const created = await runAdministration(
      ActorAuthorizedCliRequest,
      standalone,
      ledger.layer,
      createAccessCode()
    ).pipe(Effect.runPromise);

    expect(created).toMatchObject({ outcome: "created", pin: "7654321" });
    expect(creations).toHaveLength(1);
    expect(creations[0]).toMatchObject({
      attemptId,
      source: "dhw-cli",
      actor: cliAdministrator,
      request: payload.input,
    });
    expect(ledger.requests).toHaveLength(1);
    expect(ledger.requests[0]).toMatchObject({
      requestId: attemptId,
      mutation: { kind: "standalone-access-code", request: payload.input },
      inProgressMessage:
        "This standalone access-code creation is still being applied. Retrying with the same attempt identifier is safe.",
    });
    expect(ledger.requests[0]?.stored).toBe(standaloneAccessCodeStoredResult);
    expect(ledger.requests[0]?.recovery).toBe(standaloneAccessCodeRecovery);
  });

  test("replays stored metadata without a PIN or another provider call", async () => {
    let providerCalls = 0;
    const storedResult = standaloneAccessCodeStoredResult.from(createdOutcome);
    const standalone = Layer.succeed(StandaloneAccessCodeAdministration, {
      create: () =>
        Effect.sync(() => {
          providerCalls += 1;
          return createdOutcome;
        }),
    });
    const idempotency = Layer.succeed(AdministrationRequestLedger, {
      applyOnce: ({ apply }) => apply,
      applyOnceWithEffects: ({ stored }) =>
        Effect.succeed(stored.replay(storedResult as never)),
    } as AdministrationRequestLedger["Service"]);

    const replayed = await runAdministration(
      ActorAuthorizedCliRequest,
      standalone,
      idempotency,
      createAccessCode()
    ).pipe(Effect.runPromise);

    expect(replayed.outcome).toBe("already-created");
    expect("pin" in replayed).toBe(false);
    expect(providerCalls).toBe(0);
  });

  test("maps provider rejection and unavailability", async () => {
    const runFailure = (
      outcome: StandaloneAccessCodeCreationError["outcome"],
      message: string
    ) => {
      const standalone = Layer.succeed(StandaloneAccessCodeAdministration, {
        create: () => Effect.fail(creationFailure(outcome, message)),
      });
      return runAdministration(
        ActorAuthorizedCliRequest,
        standalone,
        recordingRequestLedger().layer,
        createAccessCodeError()
      ).pipe(Effect.runPromise);
    };

    const rejected = await runFailure(
      "rejected",
      "The standalone access-code request was rejected."
    );
    const unavailable = await runFailure(
      "unavailable",
      "Standalone access-code creation is temporarily unavailable."
    );

    expect(rejected).toBeInstanceOf(CliMutationRejected);
    expect(rejected.message).toContain("rejected");
    expect(unavailable).toBeInstanceOf(CliServiceUnavailable);
  });

  test("maps ambiguity to reconciliation instructions without disclosing a PIN", async () => {
    const standalone = Layer.succeed(StandaloneAccessCodeAdministration, {
      create: () =>
        Effect.fail(
          creationFailure(
            "ambiguous",
            "The standalone access-code creation outcome is ambiguous.",
            { cleanupTarget: { attemptId, name: payload.input.name } }
          )
        ),
    });
    const error = await runAdministration(
      ActorAuthorizedCliRequest,
      standalone,
      recordingRequestLedger().layer,
      createAccessCodeError()
    ).pipe(Effect.runPromise);

    expect(error).toBeInstanceOf(CliMutationUncertain);
    if (error instanceof CliMutationUncertain) {
      expect(error.message).toContain("Booth A");
      expect(error.message).toContain(attemptId);
      expect(error.message).toContain(
        `--provider-credential-removed ${attemptId}`
      );
    }
    expect(JSON.stringify(error)).not.toContain("7654321");
  });

  test("requires cleanup of the stored prior target", async () => {
    const standalone = Layer.succeed(StandaloneAccessCodeAdministration, {
      create: () =>
        Effect.fail(
          creationFailure("cleanup-required", "Cleanup is required.", {
            cleanupTarget: priorCleanupTarget,
          })
        ),
    });
    const error = await runAdministration(
      ActorAuthorizedCliRequest,
      standalone,
      recordingRequestLedger().layer,
      createAccessCodeError()
    ).pipe(Effect.runPromise);

    expect(error).toBeInstanceOf(CliStandaloneAccessCodeCleanupRequired);
    if (error instanceof CliStandaloneAccessCodeCleanupRequired) {
      expect(error.cleanupTarget).toEqual(priorCleanupTarget);
      expect(error.message).toContain("Old Booth");
      expect(error.message).toContain(priorAttemptId);
      expect(error.message).toContain(
        `--provider-credential-removed ${priorAttemptId}`
      );
      expect(error.message).toContain("Igloohome");
      expect(error.message).not.toContain("Booth A");
      expect(error.message).not.toContain(attemptId);
    }
    expect(JSON.stringify(error)).not.toContain("7654321");
  });

  test("maps cleanup and reconciliation outcomes without targets", async () => {
    const runFailure = (
      outcome: StandaloneAccessCodeCreationError["outcome"]
    ) => {
      const standalone = Layer.succeed(StandaloneAccessCodeAdministration, {
        create: () => Effect.fail(creationFailure(outcome, "Cleanup needed.")),
      });
      return runAdministration(
        ActorAuthorizedCliRequest,
        standalone,
        recordingRequestLedger().layer,
        createAccessCodeError()
      ).pipe(Effect.runPromise);
    };

    const ambiguous = await runFailure("ambiguous");
    const cleanupRequired = await runFailure("cleanup-required");
    const reconciled = await runFailure("reconciled");

    expect(ambiguous).toBeInstanceOf(CliServiceUnavailable);
    expect(cleanupRequired).toBeInstanceOf(CliServiceUnavailable);
    expect(JSON.stringify(cleanupRequired)).not.toContain("Booth A");
    expect(reconciled).toBeInstanceOf(CliStandaloneAccessCodeReconciled);
    expect(reconciled.message).toContain("Run the same command again");
  });

  test("does not call the provider when the ledger refuses and records explicit cleanup confirmation", async () => {
    const requestId = Schema.decodeUnknownSync(CliMutationRequestId)(attemptId);
    const ledger = recordingRequestLedger(
      new CliMutationInProgress({
        message:
          "This standalone access-code creation is still being applied. Retrying with the same attempt identifier is safe.",
        requestId,
      })
    );
    let creations = 0;
    const standalone = Layer.succeed(StandaloneAccessCodeAdministration, {
      create: () =>
        Effect.sync(() => {
          creations += 1;
          return createdOutcome;
        }),
    });
    const confirmedPayload = {
      ...payload,
      providerCredentialRemovedAttemptId: priorAttemptId,
    };
    const error = await runAdministration(
      ActorAuthorizedCliRequest,
      standalone,
      ledger.layer,
      createAccessCodeError(confirmedPayload)
    ).pipe(Effect.runPromise);

    expect(error).toBeInstanceOf(CliMutationInProgress);
    expect(creations).toBe(0);
    expect(ledger.requests[0]?.mutation).toEqual({
      kind: "standalone-access-code",
      request: payload.input,
      providerCredentialRemovedAttemptId: priorAttemptId,
    });
  });

  test("fails closed before the ledger when the session's administrator can't be resolved", async () => {
    let calls = 0;
    const idempotency = Layer.succeed(AdministrationRequestLedger, {
      applyOnce: () => Effect.die("Unused database-only mutation ledger"),
      applyOnceWithEffects: () =>
        Effect.sync(() => {
          calls += 1;
          return createdOutcome;
        }),
    } as AdministrationRequestLedger["Service"]);

    const error = await runAdministration(
      CliSessionAdministrationAuthenticationLive,
      UnusedStandaloneAccessCodeAdministration,
      idempotency,
      createAccessCodeError(),
      UnresolvableSessionAuthentication
    ).pipe(Effect.runPromise);

    expect(error).toBeInstanceOf(CliSessionUnauthorized);
    expect(calls).toBe(0);
  });
});
