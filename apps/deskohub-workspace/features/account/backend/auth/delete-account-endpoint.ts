import "server-only";

import { APIError } from "better-auth";
import { headers } from "next/headers";
import { auth } from "@/features/account/server/auth.server";

export type CustomerAccountDeletionEndpointResult =
  | { readonly status: "deleted" }
  | { readonly status: "reauthentication-required" }
  | {
      readonly status: "failed";
      readonly code: "account.delete.endpoint" | "account.delete.unexpected";
    };

/**
 * Runs account deletion exclusively through Better Auth's public delete-user
 * endpoint, so its session-freshness gate and the provider-first beforeDelete
 * hook stay the single identity-deletion path. Better Auth names stay inside
 * the auth boundary; callers see only this closed, censored result union.
 */
export const deleteCurrentAccountThroughAuthEndpoint =
  async (): Promise<CustomerAccountDeletionEndpointResult> => {
    try {
      await auth.api.deleteUser({ body: {}, headers: await headers() });
      return { status: "deleted" };
    } catch (cause) {
      if (cause instanceof APIError) {
        if (
          cause.body?.code === "SESSION_EXPIRED" ||
          cause.body?.code === "UNAUTHORIZED"
        ) {
          return { status: "reauthentication-required" };
        }
        return {
          status: "failed",
          code: "account.delete.endpoint",
        };
      }
      return { status: "failed", code: "account.delete.unexpected" };
    }
  };
