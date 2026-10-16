import {
  CliResourceNotFound,
  WorkspaceAdminApi,
} from "@deskohub/workspace-admin-api";
import { Effect, Match } from "effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { LegacyAdministratorBackfill } from "@/features/administrators";
import {
  makeServiceUnavailable,
  mapAdministrationApiFailure,
} from "./administration-api-failure";

export const AdminCliAdministratorsApiHandlers = HttpApiBuilder.group(
  WorkspaceAdminApi,
  "administrators",
  Effect.fn(function* (handlers) {
    const legacyBackfill = yield* LegacyAdministratorBackfill;
    return handlers.handle("backfillLegacyAdministrator", ({ payload }) =>
      legacyBackfill.run(payload).pipe(
        mapAdministrationApiFailure((cause) =>
          Match.value(cause).pipe(
            Match.tag(
              "LegacyAdministratorAccountNotFound",
              ({ message }) => new CliResourceNotFound({ message })
            ),
            Match.tag(
              "LegacyAdministratorBackfillError",
              makeServiceUnavailable
            ),
            Match.exhaustive
          )
        )
      )
    );
  })
);
