import { WorkspaceAdminApi } from "@deskohub/workspace-admin-api";
import { Effect } from "effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { CustomerAccountBackfill } from "@/features/account";
import { mapServiceFailure } from "./administration-api-failure";

export const AdminCliAccountsApiHandlers = HttpApiBuilder.group(
  WorkspaceAdminApi,
  "accounts",
  Effect.fn(function* (handlers) {
    const backfill = yield* CustomerAccountBackfill;
    return handlers.handle("backfillAccounts", ({ payload }) =>
      backfill.run(payload).pipe(mapServiceFailure)
    );
  })
);
