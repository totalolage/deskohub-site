import "server-only";

import type { DotyposCustomer, DotyposCustomerId } from "@deskohub/dotypos";
import { and, eq, inArray } from "drizzle-orm";
import { Data, Effect, Match, Option, Result, Schema } from "effect";
import type { WorkspaceDatabaseClient } from "@/db/database.service";
import { customerMarketingConsents } from "@/db/schema";
import { marketingConsentState } from "@/features/legal/backend/marketing-consent-ledger";
import { reservationCustomerEmailSchema } from "@/features/reservation/reservation-contact";
import type { DeploymentEnvironment } from "@/shared/deployment/deployment-stage";
import type { CampaignPurpose } from "../body/campaign-content";
import type { CampaignRecipientSkipReason } from "../campaign-states";
import { isCampaignRecipientAllowed } from "../recipient-domain-guard";

const decodeEmail = Schema.decodeUnknownOption(reservationCustomerEmailSchema);

/** Why the campaign can't reach a customer at their Dotypos profile email. */
export type CampaignUnreachableReason = Exclude<
  CampaignRecipientSkipReason,
  "consent-withdrawn" | "outside-test-domain"
>;

/**
 * Where a campaign decides whether one recipient may get its email.
 *
 * - `Resolution` checks the profile email only. Its candidate pool already
 *   admits only consenting customers (`listCandidates`), and it keeps an
 *   address outside the email test domain, so a one-off send refuses the
 *   whole list (`ensureCampaignRecipientsAllowed`) and an automated
 *   recipient is skipped at delivery.
 * - `Delivery` re-checks the consent it read, then the profile email, then,
 *   outside production, skips an address outside the test domain.
 */
export type CampaignEligibilityStage = Data.TaggedEnum<{
  Resolution: Record<never, never>;
  Delivery: {
    readonly consenting: boolean;
    readonly deploymentEnvironment: DeploymentEnvironment;
  };
}>;

export const CampaignEligibilityStage =
  Data.taggedEnum<CampaignEligibilityStage>();

type EligibilityInput<Stage extends CampaignEligibilityStage> = {
  readonly profile: Option.Option<DotyposCustomer>;
  readonly stage: Stage;
};

const reachableEmail = (
  profile: Option.Option<DotyposCustomer>
): Result.Result<string, CampaignUnreachableReason> => {
  if (Option.isNone(profile)) return Result.fail("missing-from-dotypos");
  if (profile.value.deleted) return Result.fail("deleted-customer");
  if (!profile.value.email?.trim()) return Result.fail("missing-email");
  return Option.match(decodeEmail(profile.value.email), {
    onNone: () => Result.fail("invalid-email" as const),
    onSome: Result.succeed,
  });
};

/**
 * The email a campaign mails one recipient at, or why it can't. Resolution
 * and delivery both classify with it, so a profile that changed since the
 * send was frozen fails the same way, with the same skip vocabulary.
 */
export function campaignEligibility(
  input: EligibilityInput<
    Extract<CampaignEligibilityStage, { readonly _tag: "Resolution" }>
  >
): Result.Result<string, CampaignUnreachableReason>;
export function campaignEligibility(
  input: EligibilityInput<CampaignEligibilityStage>
): Result.Result<string, CampaignRecipientSkipReason>;
export function campaignEligibility({
  profile,
  stage,
}: EligibilityInput<CampaignEligibilityStage>): Result.Result<
  string,
  CampaignRecipientSkipReason
> {
  if (stage._tag === "Delivery" && !stage.consenting) {
    return Result.fail("consent-withdrawn");
  }
  return reachableEmail(profile).pipe(
    Result.flatMap((email) =>
      stage._tag === "Delivery" &&
      !isCampaignRecipientAllowed(stage.deploymentEnvironment, email)
        ? Result.fail("outside-test-domain" as const)
        : Result.succeed(email)
    )
  );
}

export const consentingCampaignCustomers = (input: {
  readonly db: WorkspaceDatabaseClient;
  readonly purpose: CampaignPurpose;
  readonly customerIds: readonly DotyposCustomerId[];
}) =>
  Match.value(input.purpose).pipe(
    Match.when("marketing", () =>
      input.db
        .select({
          dotyposCustomerId: customerMarketingConsents.dotyposCustomerId,
        })
        .from(customerMarketingConsents)
        .where(
          and(
            inArray(customerMarketingConsents.dotyposCustomerId, [
              ...input.customerIds,
            ]),
            eq(
              marketingConsentState(
                customerMarketingConsents.dotyposCustomerId
              ),
              "active"
            )
          )
        )
        .pipe(
          Effect.map(
            (rows) => new Set(rows.map((row) => row.dotyposCustomerId))
          )
        )
    ),
    Match.orElse(() => Effect.succeed(new Set(input.customerIds)))
  );
