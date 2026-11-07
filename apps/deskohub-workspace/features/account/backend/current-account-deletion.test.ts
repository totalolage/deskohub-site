import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { Effect, Exit, Layer } from "effect";
import { CurrentWorkspaceRequestHeaders } from "@/shared/backend/workspace-request-context";
import { CustomerAccountAccessError } from "../customer-account";
import {
  authenticatedAs,
  testCustomerSession,
} from "./account-operations.test-utils";
import {
  CustomerAccountDeletionEndpoint,
  type CustomerAccountDeletionEndpointResult,
} from "./auth/delete-account-endpoint";
import { requestCurrentAccountDeletion } from "./current-account-deletion";

const requestHeaders = new Headers({ cookie: "session=operations-test" });

/**
 * Runs the deletion for `session` (or a failed session read) within a
 * request carrying `requestHeaders`, against an endpoint answering
 * `endpointResult`. Records the headers every endpoint call received.
 */
const run = async (options: {
  readonly session?: typeof testCustomerSession | null;
  readonly sessionFailure?: CustomerAccountAccessError;
  readonly endpointResult?: CustomerAccountDeletionEndpointResult;
}) => {
  const endpointCalls: Headers[] = [];
  const exit = await Effect.runPromiseExit(
    requestCurrentAccountDeletion.pipe(
      Effect.provide(
        Layer.mergeAll(
          authenticatedAs(
            options.session === undefined
              ? testCustomerSession
              : options.session,
            { failure: options.sessionFailure }
          ),
          Layer.succeed(CustomerAccountDeletionEndpoint, {
            deleteCurrentAccount: (headers) =>
              Effect.sync(() => {
                endpointCalls.push(headers);
                return options.endpointResult ?? { status: "deleted" };
              }),
          })
        )
      ),
      Effect.provideService(CurrentWorkspaceRequestHeaders, requestHeaders)
    )
  );
  return { exit, endpointCalls };
};

describe("requestCurrentAccountDeletion", () => {
  test("deletes through the endpoint with the request's headers", async () => {
    const { exit, endpointCalls } = await run({});

    expect(exit).toEqual(Exit.succeed({ status: "deleted" }));
    expect(endpointCalls).toEqual([requestHeaders]);
  });

  test("asks for reauthentication without a session and never calls the endpoint", async () => {
    const { exit, endpointCalls } = await run({ session: null });

    expect(exit).toEqual(Exit.succeed({ status: "reauthentication-required" }));
    expect(endpointCalls).toEqual([]);
  });

  test("reports a retryable failure when the session cannot be read", async () => {
    const { exit, endpointCalls } = await run({
      sessionFailure: new CustomerAccountAccessError({ reason: "unavailable" }),
    });

    expect(exit).toEqual(Exit.succeed({ status: "failed" }));
    expect(endpointCalls).toEqual([]);
  });

  test("passes the endpoint's refusal and reauthentication through", async () => {
    const refused = await run({ endpointResult: { status: "refused" } });
    const stale = await run({
      endpointResult: { status: "reauthentication-required" },
    });

    expect(refused.exit).toEqual(Exit.succeed({ status: "refused" }));
    expect(stale.exit).toEqual(
      Exit.succeed({ status: "reauthentication-required" })
    );
  });

  test("reports an endpoint failure without its diagnostic code", async () => {
    const { exit } = await run({
      endpointResult: { status: "failed", code: "account.delete.endpoint" },
    });

    expect(exit).toEqual(Exit.succeed({ status: "failed" }));
  });
});
