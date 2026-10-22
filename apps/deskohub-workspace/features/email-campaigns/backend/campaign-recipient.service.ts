import "server-only";

import type { DotyposCustomer, DotyposCustomerId } from "@deskohub/dotypos";
import { Context, Effect, Layer, Option, Order, Result, Schema } from "effect";
import type { Locale } from "@/features/i18n";
import { reservationCustomerEmailSchema } from "@/features/reservation/reservation-contact";
import { currentInstant } from "@/shared/utils/temporal";
import type {
  AudienceCandidate,
  AudienceFacts,
  AudienceFilter,
} from "../audience-filter";
import type { CampaignPurpose } from "../body/campaign-content";
import { CampaignRecipientResolutionError } from "../errors";
import { resolveRecipientLocale } from "../recipient-locale";
import { evaluateAudienceFilter } from "./audience-evaluation";
import {
  type AudienceEvaluationContext,
  type AudienceFactSource,
  AudienceScope,
  audienceEvaluationAt,
  scopedCustomers,
} from "./audience-evaluation-context";
import { AudienceFactsService } from "./audience-facts.service";
import {
  type CampaignCandidateFacts,
  CampaignCandidateRepository,
} from "./campaign-candidate.repository";

/** A customer the campaign reaches, with the Dotypos profile email. */
type CampaignRecipient = {
  readonly dotyposCustomerId: DotyposCustomerId;
  readonly locale: Locale;
  readonly email: string;
};

type CampaignRecipientExclusionReason =
  | "missing-from-dotypos"
  | "deleted-customer"
  | "missing-email"
  | "invalid-email";

/** A customer the audience matches whom the campaign can't reach. */
type CampaignRecipientExclusion = {
  readonly dotyposCustomerId: DotyposCustomerId;
  readonly reason: CampaignRecipientExclusionReason;
};

/**
 * Customers sharing one email address (compared trimmed and lowercased). The
 * campaign mails `recipientCustomerId` only.
 */
type CampaignRecipientDuplicate = {
  readonly email: string;
  readonly recipientCustomerId: DotyposCustomerId;
  readonly duplicateCustomerIds: readonly DotyposCustomerId[];
};

type CampaignRecipientResolution = {
  readonly recipients: readonly CampaignRecipient[];
  readonly exclusions: readonly CampaignRecipientExclusion[];
  readonly duplicates: readonly CampaignRecipientDuplicate[];
};

/**
 * What to resolve recipients for. A one-off send passes only the purpose
 * and filter: everyone, evaluated now from live facts. An automation unit
 * narrows the scope to its subjects, evaluates in its own context, and
 * reads the Dotypos facts it fetched.
 */
type CampaignRecipientQuery = {
  readonly purpose: CampaignPurpose;
  readonly filter: AudienceFilter;
  readonly scope?: AudienceScope;
  readonly context?: AudienceEvaluationContext;
  readonly facts?: AudienceFactSource;
};

export interface ICampaignRecipientService {
  /**
   * Resolves an audience filter to campaign recipients. It never returns a
   * partial list: an unavailable source fails the whole resolution.
   */
  readonly resolve: (
    input: CampaignRecipientQuery
  ) => Effect.Effect<
    CampaignRecipientResolution,
    CampaignRecipientResolutionError
  >;
}

type Candidate = AudienceCandidate & {
  readonly latestReservationAt: Temporal.Instant | null;
};

type EligibleRecipient = CampaignRecipient & Candidate;

export class CampaignRecipientService extends Context.Service<
  CampaignRecipientService,
  ICampaignRecipientService
>()("@deskohub-workspace/email-campaigns/CampaignRecipientService") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const candidates = yield* CampaignCandidateRepository;
      const audienceFacts = yield* AudienceFactsService;

      return {
        resolve: ({
          purpose,
          filter,
          scope = AudienceScope.All(),
          context,
          facts,
        }: CampaignRecipientQuery) =>
          Effect.Do.pipe(
            Effect.bind("candidates", () =>
              candidates
                .listCandidates({
                  purpose,
                  ...Option.match(
                    Option.fromNullishOr(scopedCustomers(scope)),
                    {
                      onNone: () => ({}),
                      onSome: (ids) => ({ ids }),
                    }
                  ),
                })
                .pipe(
                  Effect.mapError(CampaignRecipientResolutionError.database)
                )
            ),
            Effect.bind("context", () =>
              context === undefined
                ? currentInstant.pipe(Effect.map(audienceEvaluationAt))
                : Effect.succeed(context)
            ),
            Effect.bind("facts", ({ context }) =>
              audienceFacts.resolve({
                filter,
                contexts: [context],
                scope,
                ...(facts && { facts }),
              })
            ),
            Effect.let("localMatches", ({ candidates, context, facts }) =>
              selectLocalMatches({ candidates, filter, context, facts })
            ),
            Effect.bind("profiles", ({ localMatches }) =>
              audienceFacts.profiles({
                customers: localMatches.map(
                  ({ dotyposCustomerId }) => dotyposCustomerId
                ),
                ...(facts && { facts }),
              })
            ),
            Effect.map(({ localMatches, profiles, context, facts }) =>
              classifyRecipients({
                localMatches,
                profiles,
                filter,
                context,
                facts,
              })
            ),
            Effect.withSpan("CampaignRecipientService.resolve")
          ),
      } satisfies ICampaignRecipientService;
    })
  );

  static Live = this.Default.pipe(
    Layer.provide(
      Layer.mergeAll(
        CampaignCandidateRepository.Live,
        AudienceFactsService.Live
      )
    )
  );
}

const toCandidate = (facts: CampaignCandidateFacts): Candidate => ({
  dotyposCustomerId: facts.dotyposCustomerId,
  hasAccount: facts.hasAccount,
  latestReservationAt: facts.latestReservationAt,
  locale: resolveRecipientLocale(facts),
});

type Evaluation = {
  readonly filter: AudienceFilter;
  readonly context: AudienceEvaluationContext;
  readonly facts: AudienceFacts;
};

/** Drops candidates the local conditions already rule out. */
const selectLocalMatches = ({
  candidates,
  filter,
  context,
  facts,
}: Evaluation & { readonly candidates: readonly CampaignCandidateFacts[] }) =>
  candidates.map(toCandidate).filter(
    (candidate) =>
      evaluateAudienceFilter({
        filter,
        context,
        facts,
        candidate,
        profile: Option.none(),
      }) !== "noMatch"
  );

const classifyRecipients = ({
  localMatches,
  profiles,
  filter,
  context,
  facts,
}: Evaluation & {
  readonly localMatches: readonly Candidate[];
  readonly profiles: ReadonlyMap<DotyposCustomerId, DotyposCustomer>;
}): CampaignRecipientResolution => {
  const classified = localMatches.flatMap((candidate) => {
    const profile = Option.fromNullishOr(
      profiles.get(candidate.dotyposCustomerId)
    );
    return evaluateAudienceFilter({
      filter,
      context,
      facts,
      candidate,
      profile,
    }) === "noMatch"
      ? []
      : [classify(candidate, profile)];
  });
  return {
    ...deduplicate(
      classified.filter(
        (entry): entry is EligibleRecipient => !("reason" in entry)
      )
    ),
    exclusions: classified
      .filter((entry): entry is CampaignRecipientExclusion => "reason" in entry)
      .sort(byCustomerId),
  };
};

const decodeEmail = Schema.decodeUnknownOption(reservationCustomerEmailSchema);

/**
 * The email a campaign can reach a customer at, or why it can't. Resolution
 * and delivery both apply it, so a profile that changed since the send was
 * frozen is excluded the same way.
 */
export const reachableCampaignEmail = (
  profile: Option.Option<DotyposCustomer>
): Result.Result<string, CampaignRecipientExclusionReason> => {
  if (Option.isNone(profile)) return Result.fail("missing-from-dotypos");
  if (profile.value.deleted) return Result.fail("deleted-customer");
  if (!profile.value.email?.trim()) return Result.fail("missing-email");
  return Option.match(decodeEmail(profile.value.email), {
    onNone: () => Result.fail("invalid-email" as const),
    onSome: Result.succeed,
  });
};

const classify = (
  candidate: Candidate,
  profile: Option.Option<DotyposCustomer>
): EligibleRecipient | CampaignRecipientExclusion =>
  Result.match(reachableCampaignEmail(profile), {
    onFailure: (reason) => ({
      dotyposCustomerId: candidate.dotyposCustomerId,
      reason,
    }),
    onSuccess: (email) => ({ ...candidate, email }),
  });

const byCustomerId = Order.mapInput(
  Order.String,
  ({ dotyposCustomerId }: { readonly dotyposCustomerId: DotyposCustomerId }) =>
    dotyposCustomerId
);

/**
 * Prefers the customer who reserved most recently, then the lowest
 * customer ID, so the same audience always mails the same record.
 */
const byRecipientPreference = Order.combine(
  Order.flip(
    Order.mapInput(
      Order.Number,
      ({ latestReservationAt }: EligibleRecipient) =>
        latestReservationAt?.epochMilliseconds ?? Number.NEGATIVE_INFINITY
    )
  ),
  byCustomerId
);

const deduplicate = (eligible: readonly EligibleRecipient[]) => {
  const groups = Map.groupBy(eligible, ({ email }) => email.toLowerCase());
  const recipients: CampaignRecipient[] = [];
  const duplicates: CampaignRecipientDuplicate[] = [];
  for (const [email, group] of groups) {
    const [recipient, ...others] = group.toSorted(byRecipientPreference);
    if (!recipient) continue;
    recipients.push({
      dotyposCustomerId: recipient.dotyposCustomerId,
      locale: recipient.locale,
      email: recipient.email,
    });
    if (others.length > 0) {
      duplicates.push({
        email,
        recipientCustomerId: recipient.dotyposCustomerId,
        duplicateCustomerIds: others
          .map(({ dotyposCustomerId }) => dotyposCustomerId)
          .toSorted(),
      });
    }
  }
  return {
    recipients: recipients.sort(byCustomerId),
    duplicates: duplicates.sort(
      Order.mapInput(
        Order.String,
        ({ email }: CampaignRecipientDuplicate) => email
      )
    ),
  };
};
