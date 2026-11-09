import {
  CliMutationRejected,
  CliResourceNotFound,
  CurrentAdministrationCaller,
  WorkspaceAdminApi,
} from "@deskohub/workspace-admin-api";
import { Effect, Match } from "effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import {
  AdministratorRoster,
  LegacyAdministratorBackfill,
} from "@/features/administrators";
import {
  makeServiceUnavailable,
  mapAdministrationApiFailure,
  mapServiceFailure,
} from "./administration-api-failure";

export const AdminCliAdministratorsApiHandlers = HttpApiBuilder.group(
  WorkspaceAdminApi,
  "administrators",
  Effect.fn(function* (handlers) {
    const roster = yield* AdministratorRoster;
    const legacyBackfill = yield* LegacyAdministratorBackfill;
    return handlers
      .handle("listAdministrators", () =>
        roster.list.pipe(
          Effect.map((grants) => ({
            administrators: grants.map((grant) => ({
              accountId: grant.accountId,
              email: grant.email,
              grantedByEmail: grant.grantedBy?.email ?? null,
              grantedAt: grant.grantedAt.toString(),
            })),
          })),
          mapServiceFailure
        )
      )
      .handle(
        "grantAdministrator",
        Effect.fn(
          function* ({ payload }) {
            const { actor } = yield* CurrentAdministrationCaller;
            const { changed, email } = yield* roster.grant({
              email: payload.email,
              actor,
            });
            return {
              outcome: changed
                ? ("granted" as const)
                : ("already_granted" as const),
              email,
            };
          },
          mapAdministrationApiFailure((cause) =>
            Match.value(cause).pipe(
              Match.tag(
                "AdministratorAccountNotFoundError",
                ({ message }) => new CliResourceNotFound({ message })
              ),
              Match.tag(
                "AdministratorReviewAccountError",
                ({ message }) => new CliMutationRejected({ message })
              ),
              Match.orElse(makeServiceUnavailable)
            )
          )
        )
      )
      .handle(
        "revokeAdministrator",
        Effect.fn(
          function* ({ params }) {
            const { actor } = yield* CurrentAdministrationCaller;
            const { changed } = yield* roster.revoke({
              accountId: params.accountId,
              actor,
            });
            return {
              outcome: changed
                ? ("revoked" as const)
                : ("not_administrator" as const),
            };
          },
          mapAdministrationApiFailure((cause) =>
            Match.value(cause).pipe(
              Match.tag(
                "AdministratorSelfRevocationError",
                ({ message }) => new CliMutationRejected({ message })
              ),
              Match.orElse(makeServiceUnavailable)
            )
          )
        )
      )
      .handle("backfillLegacyAdministrator", ({ payload }) =>
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
