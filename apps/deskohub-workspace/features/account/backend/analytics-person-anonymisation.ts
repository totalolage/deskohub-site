import {
  type PostHogPersonDeletion,
  PostHogPersonsConfig,
  PostHogPersonsService,
  type PostHogPersonsWriteFailure,
  postHogPersonsFailureLogFields,
} from "@deskohub/posthog/persons";
import { Context, Effect, Layer, Match, Option } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import { AnalyticsConsentLedger } from "@/features/legal/backend/analytics-consent-ledger";
import {
  PostHogPersonPrivacyConfig,
  postHogPersonDeletionBudget,
} from "@/shared/backend/config/posthog-person-privacy.config";
import { runWorkspaceEffectAfterResponse } from "@/shared/backend/workspace-effect";
import type { CustomerAccountId } from "../customer-account";
import { getPostHogAccountDistinctId } from "../posthog-account-distinct-id";

interface IAnalyticsPersonAnonymisation {
  /**
   * Schedules, after the response, deletion of a deleted account's PostHog
   * person; events stay. Never fails.
   */
  readonly anonymiseDeletedAccount: (
    accountId: CustomerAccountId
  ) => Effect.Effect<void>;
  /**
   * Schedules, after the response, deletion of the account's PostHog person,
   * skipped at dispatch once the account's current analytics decision is no
   * longer a withdrawal; events stay. Never fails.
   */
  readonly anonymiseWithdrawnAccount: (
    accountId: CustomerAccountId
  ) => Effect.Effect<void>;
}

/**
 * Deletes an account's PostHog person profile, with its person properties,
 * and keeps its events, which stay queryable as pseudonymous records. Best
 * effort: the deletion runs after the response, and it logs every outcome
 * with a stable code and no identifiers, never raising one. Without the
 * person privacy key it sends nothing and logs that it is unavailable.
 */
export class AnalyticsPersonAnonymisation extends Context.Service<
  AnalyticsPersonAnonymisation,
  IAnalyticsPersonAnonymisation
>()("@deskohub-workspace/account/AnalyticsPersonAnonymisation") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const config = yield* PostHogPersonPrivacyConfig;
      const ledger = yield* AnalyticsConsentLedger;
      const persons = yield* Option.match(config.persons, {
        onNone: () => Effect.succeedNone,
        onSome: (personsConfig) =>
          Effect.map(PostHogPersonsService, Option.some).pipe(
            Effect.provide(
              PostHogPersonsService.Default.pipe(
                Layer.provide(PostHogPersonsConfig.from(personsConfig))
              )
            )
          ),
      });

      const deletePerson = (
        accountId: CustomerAccountId,
        proceed?: Effect.Effect<boolean>
      ) =>
        Option.match(persons, {
          onNone: () =>
            Effect.logWarning(
              "PostHog person anonymisation is unavailable: no person privacy key is configured.",
              { code: "posthog_person_anonymisation_unavailable" }
            ),
          onSome: (service) =>
            service
              .deletePersonKeepingEvents({
                distinctId: getPostHogAccountDistinctId(accountId),
                proceed,
              })
              .pipe(
                Effect.flatMap(logDeletion),
                Effect.catch(logDeletionFailure)
              ),
        });

      /**
       * Whether the account still withdraws analytics consent. A later grant
       * wins over the withdrawal that requested the deletion; a ledger that
       * can't be read proves nothing, so the deletion is skipped.
       */
      const isStillWithdrawn = (accountId: CustomerAccountId) =>
        ledger.currentDecision(accountId).pipe(
          Effect.map(
            Option.exists((current) => current.decision === "withdraw")
          ),
          Effect.catchTag("AnalyticsConsentUnavailable", () =>
            Effect.logWarning(
              "PostHog person anonymisation skipped: the analytics consent ledger is unavailable.",
              { code: "posthog_person_anonymisation_ledger_unavailable" }
            ).pipe(Effect.as(false))
          )
        );

      return {
        anonymiseDeletedAccount: (accountId) =>
          runWorkspaceEffectAfterResponse(
            "account.analytics-person-anonymisation.deleted-account",
            deletePerson(accountId).pipe(withinDeletionBudget)
          ),
        anonymiseWithdrawnAccount: (accountId) =>
          runWorkspaceEffectAfterResponse(
            "account.analytics-person-anonymisation.withdrawn-account",
            deletePerson(accountId, isStillWithdrawn(accountId)).pipe(
              withinDeletionBudget
            )
          ),
      } satisfies IAnalyticsPersonAnonymisation;
    })
  );

  static Live = this.Default.pipe(
    Layer.provide(
      Layer.mergeAll(
        PostHogPersonPrivacyConfig.Default,
        AnalyticsConsentLedger.Live,
        FetchHttpClient.layer
      )
    )
  );
}

/**
 * Bounds the whole deletion, ledger reads included, so it ends inside the
 * function limit that also bounds work after the response. A deletion cut
 * off mid-request may have applied.
 */
const withinDeletionBudget = (deletion: Effect.Effect<void>) =>
  deletion.pipe(
    Effect.timeoutOrElse({
      duration: postHogPersonDeletionBudget,
      orElse: () =>
        Effect.logWarning(
          "PostHog person anonymisation ran out of time; it may not have applied.",
          { code: "posthog_person_anonymisation_timed_out" }
        ),
    })
  );

const logDeletion = Match.type<PostHogPersonDeletion>().pipe(
  Match.when("deleted", () =>
    Effect.logInfo("PostHog person anonymised; its events are kept.", {
      code: "posthog_person_anonymised",
    })
  ),
  Match.when("absent", () =>
    Effect.logInfo("PostHog person anonymisation found no person.", {
      code: "posthog_person_anonymisation_absent",
    })
  ),
  Match.when("skipped", () =>
    Effect.logInfo(
      "PostHog person anonymisation skipped: the account no longer withdraws analytics consent.",
      { code: "posthog_person_anonymisation_skipped" }
    )
  ),
  Match.exhaustive
);

const logDeletionFailure = (failure: PostHogPersonsWriteFailure) =>
  Effect.logWarning(
    failure._tag === "PostHogPersonsUncertain"
      ? "PostHog person anonymisation may not have applied; it is not retried."
      : "PostHog person anonymisation failed.",
    {
      code:
        failure._tag === "PostHogPersonsUncertain"
          ? "posthog_person_anonymisation_uncertain"
          : "posthog_person_anonymisation_failed",
      ...postHogPersonsFailureLogFields(failure),
    }
  );
