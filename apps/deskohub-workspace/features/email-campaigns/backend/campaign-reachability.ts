import "server-only";

import type { DotyposCustomer, DotyposCustomerId } from "@deskohub/dotypos";
import { and, eq, inArray } from "drizzle-orm";
import { Effect, Match, Option, Result, Schema } from "effect";
import type { WorkspaceDatabaseClient } from "@/db/database.service";
import { customerMarketingConsents } from "@/db/schema";
import { marketingConsentState } from "@/features/legal/backend/marketing-consent-ledger";
import { reservationCustomerEmailSchema } from "@/features/reservation/reservation-contact";
import type { DeploymentEnvironment } from "@/shared/deployment/deployment-stage";
import type { CampaignPurpose } from "../body/campaign-content";
import type { CampaignRecipientSkipReason } from "../campaign-states";
import { isCampaignRecipientAllowed } from "../recipient-domain-guard";

const decodeEmail = Schema.decodeUnknownOption(reservationCustomerEmailSchema);

export const reachableCampaignEmail = (
  profile: Option.Option<DotyposCustomer>
): Result.Result<
  string,
  | "missing-from-dotypos"
  | "deleted-customer"
  | "missing-email"
  | "invalid-email"
> => {
  if (Option.isNone(profile)) return Result.fail("missing-from-dotypos");
  if (profile.value.deleted) return Result.fail("deleted-customer");
  if (!profile.value.email?.trim()) return Result.fail("missing-email");
  return Option.match(decodeEmail(profile.value.email), {
    onNone: () => Result.fail("invalid-email" as const),
    onSome: Result.succeed,
  });
};

export const campaignEligibility = (input: {
  readonly profile: Option.Option<DotyposCustomer>;
  readonly consenting: boolean;
  readonly deploymentEnvironment: DeploymentEnvironment;
}): Result.Result<string, CampaignRecipientSkipReason> => {
  if (!input.consenting) return Result.fail("consent-withdrawn" as const);
  return reachableCampaignEmail(input.profile).pipe(
    Result.flatMap((email) =>
      isCampaignRecipientAllowed(input.deploymentEnvironment, email)
        ? Result.succeed(email)
        : Result.fail("outside-test-domain" as const)
    )
  );
};

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
