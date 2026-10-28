import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import {
  AdministrationActionRecord,
  type AdministrationAssistantConnectionIdType,
  AdministrationAuthentication,
  type AdministrationChannel,
  CliMutationRejected,
  CliSessionId,
  CurrentAdministrationCaller,
  WorkspaceAdminApi,
} from "@deskohub/workspace-admin-api";
import { NodeHttpServer } from "@effect/platform-node";
import { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Effect, Exit, Layer, Option, type Schema } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/unstable/http";
import { StandaloneAccessCodeAdministration } from "@/features/access-codes";
import { InvoiceAdministrationService } from "@/features/accounting/admin/invoice-administration.service";
import { AdministrationService } from "@/features/administration/administration.service";
import { ReservationAccessAdministration } from "@/features/administration/reservation-access-administration.service";
import { ReservationAdministrationService } from "@/features/administration/reservation-administration.service";
import {
  AdministratorRoster,
  LegacyAdministratorBackfill,
} from "@/features/administrators";
import { DiscountAdministration } from "@/features/discounts/admin/discount-administration.service";
import { CampaignOperations } from "@/features/email-campaigns/backend/campaign-operations.service";
import { ReservationProductDetailsBackfill } from "@/features/reservation/backend/reservation-product-details-backfill.service";
import { withInstantSleeps } from "@/shared/testing/workspace-test-clock.test-utils";
import { CurrentAdministrationAction } from "./administration-action";
import {
  type AdministrationActionEnd,
  AdministrationActionLog,
} from "./administration-action-log.service";
import { AdministrationActionRecordLive } from "./administration-action-record.server";
import { AdministrationRequestLedger } from "./administration-request-ledger.service";
import {
  cliSessionAdministrator,
  UnusedCliSessionAuthentication,
} from "./cli-api.test-utils";
import { CliAuthentication } from "./cli-authentication.service";
import { CliAuthenticationAdmission } from "./cli-authentication-admission.service";
import { CliClientCompatibilityLive } from "./cli-client-version";
import { makeWorkspaceAdminApiLayer } from "./workspace-admin-api.server";

const sessionChannel: AdministrationChannel = {
  _tag: "CliSession",
  sessionId: CliSessionId.make("01980000-0000-7000-8000-0000000000d1"),
};
const assistantChannel: AdministrationChannel = {
  _tag: "AssistantConnection",
  connectionId:
    "01980000-0000-7000-8000-0000000000d2" as AdministrationAssistantConnectionIdType,
  oauthClientId: "https://assistant.example/client.json",
};
const sessionPath = `/sessions/${sessionChannel.sessionId}`;

type ActionLogEvent =
  | {
      readonly event: "start";
      readonly operation: string;
      readonly channel: AdministrationChannel;
    }
  | { readonly event: "operation" }
  | { readonly event: "finish"; readonly end: AdministrationActionEnd };

const makeActionLog = (
  options: {
    readonly startFails?: boolean;
    readonly finishDies?: boolean;
    readonly finishHangs?: boolean;
  } = {}
) => {
  const events: ActionLogEvent[] = [];
  const layer = Layer.succeed(AdministrationActionLog, {
    start: ({ operation, caller }) =>
      options.startFails
        ? Effect.fail(
            new EffectDrizzleQueryError({
              query: "insert into administration actions",
              params: [],
              cause: new Error("write unavailable"),
            })
          )
        : Effect.sync(() => {
            events.push({ event: "start", operation, channel: caller.channel });
            return "01980000-0000-7000-8000-0000000000e1";
          }),
    finish: (_id, end) => {
      if (options.finishDies) {
        return Effect.die(new Error("The action log is unreachable."));
      }
      if (options.finishHangs) {
        return Effect.never;
      }
      return Effect.sync(() => {
        events.push({ event: "finish", end });
      });
    },
  });
  return { events, layer };
};

const callerAuthentication = (channel: AdministrationChannel) =>
  Layer.succeed(AdministrationAuthentication, {
    bearer: (httpEffect) =>
      Effect.provideService(httpEffect, CurrentAdministrationCaller, {
        actor: cliSessionAdministrator,
        channel,
      }),
  });

const serve = ({
  channel = sessionChannel,
  actionLog,
  authentication = {},
  idempotency = {},
  invoices = {},
  standalone = {},
  backfill = {},
}: {
  readonly channel?: AdministrationChannel;
  readonly actionLog: Layer.Layer<AdministrationActionLog>;
  readonly authentication?: Partial<CliAuthentication["Service"]>;
  readonly idempotency?: Partial<AdministrationRequestLedger["Service"]>;
  readonly invoices?: Partial<InvoiceAdministrationService["Service"]>;
  readonly standalone?: Partial<StandaloneAccessCodeAdministration["Service"]>;
  readonly backfill?: Partial<ReservationProductDetailsBackfill["Service"]>;
}) =>
  HttpRouter.toWebHandler(
    makeWorkspaceAdminApiLayer({
      authentication: callerAuthentication(channel),
      sessionAuthentication: UnusedCliSessionAuthentication,
      clientCompatibility: CliClientCompatibilityLive,
    }).pipe(
      Layer.provide(
        Layer.mergeAll(
          actionLog,
          Layer.succeed(CliAuthentication, {
            ...({} as CliAuthentication["Service"]),
            ...authentication,
          }),
          Layer.succeed(AdministrationRequestLedger, {
            ...({} as AdministrationRequestLedger["Service"]),
            ...idempotency,
          }),
          Layer.succeed(InvoiceAdministrationService, {
            ...({} as InvoiceAdministrationService["Service"]),
            ...invoices,
          }),
          Layer.succeed(StandaloneAccessCodeAdministration, {
            ...({} as StandaloneAccessCodeAdministration["Service"]),
            ...standalone,
          }),
          Layer.succeed(CliAuthenticationAdmission, {} as never),
          Layer.succeed(AdministrationService, {} as never),
          Layer.succeed(ReservationAdministrationService, {} as never),
          Layer.succeed(ReservationProductDetailsBackfill, {
            ...({} as ReservationProductDetailsBackfill["Service"]),
            ...backfill,
          }),
          Layer.succeed(AdministratorRoster, {} as never),
          Layer.succeed(LegacyAdministratorBackfill, {} as never),
          Layer.succeed(ReservationAccessAdministration, {} as never),
          Layer.succeed(DiscountAdministration, {} as never),
          Layer.succeed(CampaignOperations, {} as never),
          NodeHttpServer.layerHttpServices
        )
      )
    ),
    { disableLogger: true }
  ).handler;

const call = (
  handler: (request: Request) => Promise<Response>,
  init: RequestInit & { readonly path: string }
) =>
  handler(
    new Request(`https://workspace.deskohub.test/api/v1/cli${init.path}`, {
      ...init,
      headers: {
        authorization: "Bearer synthetic",
        "content-type": "application/json",
      },
    })
  );

const renameSession = {
  path: sessionPath,
  method: "PATCH",
  body: JSON.stringify({ clientName: "Renamed" }),
};

describe("administration action record", () => {
  test("records a state-changing operation's caller before it runs and its outcome after", async () => {
    const { events, layer } = makeActionLog();
    const handler = serve({
      actionLog: layer,
      authentication: {
        renameSession: () =>
          Effect.sync(() => {
            events.push({ event: "operation" });
            return true;
          }),
      },
    });

    const response = await call(handler, renameSession);

    expect(response.status).toBe(200);
    expect(events).toEqual([
      {
        event: "start",
        operation: "administration.renameSession",
        channel: sessionChannel,
      },
      { event: "operation" },
      { event: "finish", end: { outcome: "succeeded" } },
    ]);
  });

  test("leaves reads unrecorded", async () => {
    const { events, layer } = makeActionLog();
    const handler = serve({
      actionLog: layer,
      authentication: { listSessions: () => Effect.succeed([]) },
    });

    const response = await call(handler, { path: "/sessions" });

    expect(response.status).toBe(200);
    expect(events).toEqual([]);
  });

  describe("for an operation whose preview is its dry run", () => {
    const serveBackfill = () => {
      const { events, layer } = makeActionLog();
      const handler = serve({
        actionLog: layer,
        backfill: {
          runBatch: () =>
            Effect.sync(() => {
              events.push({ event: "operation" });
              return {
                updated: 0,
                alreadyComplete: 0,
                unresolved: [],
                nextCursor: null,
              };
            }),
        },
      });
      const runBatch = (payload: Schema.Json) =>
        call(handler, {
          path: "/reservations/product-details-backfill",
          method: "POST",
          body: JSON.stringify(payload),
        });
      return { events, runBatch };
    };
    const startOf = {
      event: "start",
      operation: "administration.backfillReservationProductDetails",
      channel: sessionChannel,
    } as const;

    test("leaves a dry run unrecorded, as it changes nothing", async () => {
      const { events, runBatch } = serveBackfill();

      const response = await runBatch({ dryRun: true, after: null });

      expect(response.status).toBe(200);
      expect(events).toEqual([{ event: "operation" }]);
    });

    test("records the run that writes", async () => {
      const { events, runBatch } = serveBackfill();

      const response = await runBatch({ dryRun: false, after: null });

      expect(response.status).toBe(200);
      expect(events).toEqual([
        startOf,
        { event: "operation" },
        { event: "finish", end: { outcome: "succeeded" } },
      ]);
    });

    test("records a request whose payload doesn't decode, whatever its dryRun", async () => {
      const { events, runBatch } = serveBackfill();

      const response = await runBatch({
        dryRun: true,
        after: null,
        limit: 10,
      });

      expect(response.status).toBe(400);
      expect(events[0]).toEqual(startOf);
      expect(events).not.toContainEqual({ event: "operation" });
    });
  });

  test("records a dryRun key an operation without a dry run doesn't declare", async () => {
    const { events, layer } = makeActionLog();
    const handler = serve({ actionLog: layer });

    await call(handler, {
      ...renameSession,
      body: JSON.stringify({ clientName: "Renamed", dryRun: true }),
    });

    expect(events[0]).toEqual({
      event: "start",
      operation: "administration.renameSession",
      channel: sessionChannel,
    });
  });

  test("records a declared failure by its tag", async () => {
    const { events, layer } = makeActionLog();
    const handler = serve({
      actionLog: layer,
      authentication: { renameSession: () => Effect.succeed(false) },
    });

    const response = await call(handler, renameSession);

    expect(response.status).toBe(404);
    expect(events.at(-1)).toEqual({
      event: "finish",
      end: { outcome: "failed", failure: "CliResourceNotFound" },
    });
  });

  test("records a request that replayed a stored result as replayed", async () => {
    const { events, layer } = makeActionLog();
    const handler = serve({
      actionLog: layer,
      authentication: {
        renameSession: () =>
          Effect.serviceOption(CurrentAdministrationAction).pipe(
            Effect.flatMap(
              Option.match({
                onNone: () => Effect.die("No action is being recorded."),
                onSome: (action) => action.markReplayed,
              })
            ),
            Effect.as(true)
          ),
      },
    });

    const response = await call(handler, renameSession);

    expect(response.status).toBe(200);
    expect(events.at(-1)).toEqual({
      event: "finish",
      end: { outcome: "replayed" },
    });
  });

  test("records a defect", async () => {
    const { events, layer } = makeActionLog();
    const handler = serve({
      actionLog: layer,
      authentication: {
        renameSession: () => Effect.die(new Error("Synthetic defect")),
      },
    });

    const response = await call(handler, renameSession);

    expect(response.status).toBe(500);
    expect(events.at(-1)).toEqual({
      event: "finish",
      end: { outcome: "defect" },
    });
  });

  test("records the variant of a generic mutation", async () => {
    const { events, layer } = makeActionLog();
    const handler = serve({
      actionLog: layer,
      idempotency: {
        applyOnceWithEffects: () =>
          Effect.fail(
            new CliMutationRejected({ message: "This mutation was rejected." })
          ),
      },
    });
    const body = {
      requestId: "01980000-0000-7000-8000-0000000000b1",
      mutation: {
        kind: "delete-code",
        id: "01980000-0000-7000-8000-0000000000c1",
      },
    };

    const response = await call(handler, {
      path: "/discounts/mutations",
      method: "POST",
      body: JSON.stringify(body),
    });
    const undecodable = await call(handler, {
      path: "/discounts/mutations",
      method: "POST",
      body: JSON.stringify({ ...body, mutation: { kind: "unknown" } }),
    });

    expect(response.status).toBe(409);
    expect(undecodable.status).toBeGreaterThanOrEqual(400);
    expect(
      events.flatMap((event) =>
        event.event === "start" ? [event.operation] : []
      )
    ).toEqual([
      "administration.mutateDiscounts.delete-code",
      "administration.mutateDiscounts",
    ]);
    expect(events[1]).toEqual({
      event: "finish",
      end: { outcome: "failed", failure: "CliMutationRejected" },
    });
  });

  test("refuses to run an operation it can't record", async () => {
    const { layer } = makeActionLog({ startFails: true });
    let renamed = false;
    const handler = serve({
      actionLog: layer,
      authentication: {
        renameSession: () =>
          Effect.sync(() => {
            renamed = true;
            return true;
          }),
      },
    });

    const response = await call(handler, renameSession);

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      _tag: "CliServiceUnavailable",
    });
    expect(renamed).toBe(false);
  });

  test("keeps the operation's response when its outcome can't be recorded", async () => {
    const { layer } = makeActionLog({ finishDies: true });
    const handler = serve({
      actionLog: layer,
      authentication: { renameSession: () => Effect.succeed(true) },
    });

    const response = await call(handler, renameSession);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ changed: true });
  });

  test("records an assistant's channel and issues its records under the assistant source", async () => {
    const { events, layer } = makeActionLog();
    const issuers: unknown[] = [];
    const accessCodeSources: unknown[] = [];
    const handler = serve({
      channel: assistantChannel,
      actionLog: layer,
      idempotency: {
        applyOnceWithEffects: ({ apply }) => apply,
      },
      invoices: {
        create: (_input, issuer) =>
          Effect.sync(() => issuers.push(issuer)).pipe(
            Effect.andThen(Effect.die("Issuing is out of scope."))
          ),
      },
      standalone: {
        create: (input) =>
          Effect.sync(() => accessCodeSources.push(input.source)).pipe(
            Effect.andThen(Effect.die("Creating is out of scope."))
          ),
      },
    });

    await call(handler, {
      path: "/invoices",
      method: "POST",
      body: JSON.stringify({
        invoiceId: "01980000-0000-7000-8000-000000000009",
        customer: {
          kind: "new",
          details: {
            kind: "person",
            email: testEmailAddress("assistant-invoice"),
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
        locale: "cs-CZ",
        serviceDate: "2026-08-10",
        payment: { status: "due", date: "2026-08-24" },
        currency: "CZK",
        lines: [{ description: "Space rental", price: "1000" }],
      }),
    });
    await call(handler, {
      path: "/access-codes",
      method: "POST",
      body: JSON.stringify({
        attemptId: "01980000-0000-7000-8000-000000000042",
        input: {
          name: "Booth A",
          startsAt: "2026-09-10T10:00",
          endsAt: "2026-09-10T12:00",
        },
      }),
    });

    expect(issuers).toEqual([
      { source: "assistant", administrator: cliSessionAdministrator },
    ]);
    expect(accessCodeSources).toEqual(["assistant"]);
    expect(
      events.flatMap((event) => (event.event === "start" ? [event] : []))
    ).toEqual([
      {
        event: "start",
        operation: "administration.createInvoice",
        channel: assistantChannel,
      },
      {
        event: "start",
        operation: "administration.createStandaloneAccessCode",
        channel: assistantChannel,
      },
    ]);
  });

  describe("around the operation itself", () => {
    const renameSessionEndpoint = {
      group: WorkspaceAdminApi.groups.administration,
      endpoint: WorkspaceAdminApi.groups.administration.endpoints.renameSession,
    };
    const runRecorded = (
      actionLog: Layer.Layer<AdministrationActionLog>,
      operation: Effect.Effect<HttpServerResponse.HttpServerResponse>
    ) =>
      AdministrationActionRecord.pipe(
        Effect.flatMap((record) =>
          record(operation, renameSessionEndpoint as never)
        ),
        Effect.provideService(CurrentAdministrationCaller, {
          actor: cliSessionAdministrator,
          channel: sessionChannel,
        }),
        Effect.provide(
          AdministrationActionRecordLive.pipe(Layer.provide(actionLog))
        ),
        Effect.exit
      );

    test("records an interrupted operation", async () => {
      const { events, layer } = makeActionLog();

      const exit = await Effect.runPromise(
        runRecorded(layer, Effect.interrupt)
      );

      expect(Exit.hasInterrupts(exit)).toBe(true);
      expect(events.at(-1)).toEqual({
        event: "finish",
        end: { outcome: "interrupted" },
      });
    });

    test("returns the response when recording the outcome stalls", async () => {
      const { layer } = makeActionLog({ finishHangs: true });

      const exit = await Effect.runPromise(
        withInstantSleeps(
          runRecorded(layer, Effect.succeed(HttpServerResponse.empty()))
        )
      );

      expect(Exit.isSuccess(exit)).toBe(true);
    });
  });
});
