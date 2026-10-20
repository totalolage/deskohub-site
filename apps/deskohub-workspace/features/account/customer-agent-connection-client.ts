"use client";

import { Data, Effect } from "effect";
import { runWorkspaceBrowserEffect } from "@/shared/browser/workspace-browser-effect";
import { reportWorkspaceBrowserFailure } from "@/shared/browser/workspace-browser-logs";
import { authClient } from "./auth.client";
import type { CustomerAgentDisconnectResult } from "./customer-agent-connections";

/** The OAuth server refused the disconnect, or could not be reached. */
class CustomerAgentDisconnectError extends Data.TaggedError(
  "CustomerAgentDisconnectError"
)<{ readonly status?: number; readonly cause?: unknown }> {}

/**
 * Deletes the customer's consent `id`. A consent that is already gone, such
 * as one disconnected in another tab, counts as disconnected.
 */
const deleteConsent = (id: string) =>
  Effect.tryPromise({
    try: () => authClient.oauth2.deleteConsent({ id }),
    catch: (cause) => new CustomerAgentDisconnectError({ cause }),
  }).pipe(
    Effect.flatMap(({ error }) =>
      error === null || error.status === 404
        ? Effect.void
        : Effect.fail(
            new CustomerAgentDisconnectError({
              status: error.status,
              cause: error,
            })
          )
    )
  );

/**
 * Disconnects the assistant behind the customer's consent `id`: Better Auth
 * deletes the consent and revokes the tokens that client holds for the
 * customer.
 */
export const disconnectCustomerAgent = (
  id: string
): Promise<CustomerAgentDisconnectResult> =>
  deleteConsent(id).pipe(
    Effect.as<CustomerAgentDisconnectResult>("disconnected"),
    Effect.catch((error) =>
      reportWorkspaceBrowserFailure(
        "account.customer-agent-disconnect.failed",
        error
      ).pipe(Effect.as<CustomerAgentDisconnectResult>("failed"))
    ),
    runWorkspaceBrowserEffect("account.customer-agent-disconnect")
  );
