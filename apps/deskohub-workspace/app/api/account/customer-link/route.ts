import { Effect } from "effect";
import { NextResponse } from "next/server";
import { accountCustomerLinkFor } from "@/features/account/backend/account-customer-link";
import { CurrentCustomerAccount } from "@/features/account/backend/current-customer-account";
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
    CurrentCustomerAccount.pipe(
      Effect.flatMap((current) => current.peek),
      Effect.flatMap(accountCustomerLinkFor),
      Effect.map((link) =>
        NextResponse.json(link, {
          headers: { "Cache-Control": "private, no-store" },
        })
      ),
      Effect.provide(CurrentCustomerAccount.Live),
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
