import { Effect, Layer, type Schema } from "effect";
import { connection, NextResponse } from "next/server";
import { AccountDataExportService } from "@/features/account/backend/account-data-export.service";
import { AccountFeatureFlagService } from "@/features/account/backend/account-feature-flag.service";
import { resolveCurrentCustomerAccount } from "@/features/account/backend/customer-account-resolver.service";
import { CustomerAuthentication } from "@/features/account/backend/customer-authentication.service";
import type {
  CustomerAccountAccessError,
  LinkedCustomerAccount,
} from "@/features/account/customer-account";
import {
  defineWorkspaceRoute,
  WorkspaceRouteFailure,
} from "@/shared/backend/workspace-route";

/**
 * The single fixed public failure body. It never contains error details,
 * provider data, or any part of a partially assembled snapshot.
 */
const exportUnavailableBody = JSON.stringify({
  error: "Account data export is unavailable.",
});

const exportFailureResponse = (statusCode: 404 | 500) =>
  new NextResponse(exportUnavailableBody, {
    status: statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });

const exportResponseHeaders = (generatedOn: string) => ({
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
  "Content-Disposition": `attachment; filename="deskohub-account-data-${generatedOn}.json"`,
});

export type AccountDataExportRouteLayers = Layer.Layer<
  AccountFeatureFlagService | CustomerAuthentication | AccountDataExportService,
  Schema.SchemaError
>;

const exportRouteLayers: AccountDataExportRouteLayers = Layer.mergeAll(
  AccountFeatureFlagService.Live,
  CustomerAuthentication.Default,
  AccountDataExportService.Live
);

/**
 * Produces the export response against an injectable account resolver and
 * capability layers. Production uses the defaults; provider-independent
 * tests supply fakes to prove the fail-closed controls.
 */
const buildExportSnapshot = Effect.fn("buildAccountDataExportSnapshot")(
  function* (
    resolveAccount: Effect.Effect<
      LinkedCustomerAccount,
      CustomerAccountAccessError
    >
  ) {
    // 1. Fail closed on the accounts feature flag before touching identity data.
    const enabled = yield* Effect.flatMap(
      AccountFeatureFlagService,
      (flags) => flags.isEnabled
    );
    if (!enabled) return exportFailureResponse(404);

    // 2. Authoritative database session with a verified email. Client-supplied
    //    identity is never consulted.
    const session = yield* Effect.flatMap(
      CustomerAuthentication,
      (authentication) => authentication.currentUser
    );
    if (!session) return exportFailureResponse(404);

    // 3. Verified one-to-one account link; the resolver fails closed on a
    //    deletion marker, an ambiguous match, or an unverified email.
    const account = yield* resolveAccount;

    // 4. The allowlisted snapshot. Any section failure fails the whole export.
    const snapshot = yield* Effect.flatMap(
      AccountDataExportService,
      (service) => service.build({ account, session })
    );

    return new NextResponse(JSON.stringify(snapshot, null, 2), {
      status: 200,
      headers: exportResponseHeaders(new Date().toISOString().slice(0, 10)),
    });
  }
);

export const buildAccountDataExportResponse = Effect.fn(
  "buildAccountDataExportResponse"
)(function* (
  resolveAccount: Effect.Effect<
    LinkedCustomerAccount,
    CustomerAccountAccessError
  > = resolveCurrentCustomerAccount,
  layers: AccountDataExportRouteLayers = exportRouteLayers
) {
  return yield* Effect.provide(
    buildExportSnapshot(resolveAccount),
    layers
  ).pipe(
    // Never log, trace, or serialize the snapshot body on failure; the fixed
    // diagnostic tag is the only fact that reaches telemetry.
    Effect.mapError(
      WorkspaceRouteFailure.internal("Account data export is unavailable.")
    ),
    Effect.catch(() =>
      Effect.logWarning("Account data export failed closed.", {
        diagnostic: "account-data-export.unavailable",
      }).pipe(Effect.as(exportFailureResponse(500)))
    )
  );
});

const buildExportResponse = buildAccountDataExportResponse();

export const GET = defineWorkspaceRoute(
  {
    operation: "accountDataExport",
    cancellation: "interrupt-on-disconnect",
  },
  () =>
    // Defensive fresh-render guard, not a demonstrated failure repair:
    // the session read resolves the headers captured at the route boundary,
    // and Next's route proxy tracks that plain `request.headers` access, so
    // framework caching of this handler was unlikely. Consuming the dynamic
    // connection here makes the per-request rendering explicit anyway — this
    // document is a fresh-snapshot, cross-account security boundary, so it
    // must never be served from any cache even if request tracking changes.
    Effect.promise(() => connection()).pipe(
      Effect.andThen(() => buildExportResponse)
    )
);
