import { Effect, Layer } from "effect";
import { NextResponse } from "next/server";
import { readCurrentAccountCustomerLink } from "@/features/account/backend/account-customer-link";
import { CustomerAccountLinkRepository } from "@/features/account/backend/customer-account-link.repository";
import { CustomerAuthentication } from "@/features/account/backend/customer-authentication.service";
import {
  defineWorkspaceRoute,
  WorkspaceRouteFailure,
} from "@/shared/backend/workspace-route";

/**
 * GET /api/account/customer-link
 *
 * Returns the signed-in account's opaque Dotypos customer ID so the browser
 * can attach it to the consented PostHog person. Only identifiers leave this
 * route.
 */
export const GET = defineWorkspaceRoute(
  {
    operation: "accountCustomerLink",
    cancellation: "interrupt-on-disconnect",
    caller: "client",
  },
  () =>
    readCurrentAccountCustomerLink.pipe(
      Effect.map((link) =>
        NextResponse.json(link, {
          headers: { "Cache-Control": "private, no-store" },
        })
      ),
      Effect.provide(
        Layer.mergeAll(
          CustomerAuthentication.Default,
          CustomerAccountLinkRepository.Live
        )
      ),
      Effect.mapError(
        (cause) =>
          new WorkspaceRouteFailure({
            statusCode: 503,
            publicMessage: "The account customer link is unavailable.",
            cause,
          })
      )
    )
);
