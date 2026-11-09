import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import {
  DotyposCustomerIdSchema,
  DotyposReservationIdSchema,
} from "@deskohub/dotypos";
import { testEmailAddress } from "@deskohub/test-email";
import { eq } from "drizzle-orm";
import { Effect } from "effect";
import {
  discountApplications,
  paymentAttempts,
  referralCodes,
  workspaceReservations,
} from "@/db/schema";
import { authUser } from "@/db/schema/auth";
import { customerAccounts } from "@/db/schema/customer-accounts";
import { customerAccountIdSchema } from "@/features/account/customer-account";
import { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import { E2EDatabase } from "../integrations/database.service";
import {
  seedWorkspaceE2EReferralInvitee,
  seedWorkspaceE2EReferralOwner,
  seedWorkspaceE2EReferrerSavings,
} from "./referral-fixture";

const testDatabase = await connectWorkspacePostgresTestDatabase();

const runWithDatabase = <A, E>(effect: Effect.Effect<A, E, E2EDatabase>) =>
  effect.pipe(
    Effect.provideService(
      E2EDatabase,
      E2EDatabase.of({ db: testDatabase!.db })
    ),
    Effect.runPromise
  );

const readCustomerReservations = (customerId: string) =>
  testDatabase!.db
    .select()
    .from(workspaceReservations)
    .where(
      eq(
        workspaceReservations.dotyposCustomerId,
        DotyposCustomerIdSchema.make(customerId)
      )
    )
    .pipe(Effect.runPromise);

describe.skipIf(!testDatabase)(
  "Referral fixture on disposable Postgres",
  () => {
    test("seeds a linked owner, a paid invitee booking, and the referrer's savings", async () => {
      const run = crypto.randomUUID();
      const referrer = DotyposCustomerIdSchema.make(`referral-owner-${run}`);
      const invitee = DotyposCustomerIdSchema.make(`referral-invitee-${run}`);
      const owner = {
        accountId: `referral-owner-account-${run}`,
        dotyposCustomerId: referrer,
        email: testEmailAddress(`referral-owner-${run}`),
        name: "Workspace E2E referral owner",
      };

      const { promotionCodeId } = await runWithDatabase(
        seedWorkspaceE2EReferralOwner(owner)
      );

      const [user] = await testDatabase!.db
        .select({
          deletionRequestedAt: authUser.deletionRequestedAt,
          email: authUser.email,
          emailVerified: authUser.emailVerified,
          name: authUser.name,
        })
        .from(authUser)
        .where(eq(authUser.id, owner.accountId))
        .pipe(Effect.runPromise);
      expect(user).toEqual({
        deletionRequestedAt: null,
        email: owner.email,
        emailVerified: true,
        name: owner.name,
      });
      const [ownerAccount] = await testDatabase!.db
        .select({ dotyposCustomerId: customerAccounts.dotyposCustomerId })
        .from(customerAccounts)
        .where(
          eq(customerAccounts.id, customerAccountIdSchema.make(owner.accountId))
        )
        .pipe(Effect.runPromise);
      expect(ownerAccount).toEqual({ dotyposCustomerId: referrer });
      const [code] = await testDatabase!.db
        .select({ referrer: referralCodes.referrerDotyposCustomerId })
        .from(referralCodes)
        .where(eq(referralCodes.promotionCodeId, promotionCodeId))
        .pipe(Effect.runPromise);
      expect(code).toEqual({ referrer });

      const visitEndedAt = new Date(Date.now() - 86_400_000);
      const inviteeReservationId = DotyposReservationIdSchema.make(
        `referral-invitee-visit-${run}`
      );
      await runWithDatabase(
        seedWorkspaceE2EReferralInvitee({
          invitedDotyposCustomerId: invitee,
          paidVisit: {
            dotyposReservationId: inviteeReservationId,
            endedAt: visitEndedAt,
          },
          referrerDotyposCustomerId: referrer,
          referrerPromotionCodeId: promotionCodeId,
        })
      );
      const [inviteeBooking] = await readCustomerReservations(invitee);
      const paidAt = Temporal.Instant.fromEpochMilliseconds(
        visitEndedAt.getTime()
      ).toString();
      expect(inviteeBooking).toMatchObject({
        dotyposReservationId: inviteeReservationId,
        reservationState: "confirmed",
        paymentState: "paid",
        fulfillmentState: "not_started",
        reservationDetails: {
          kind: "cowork",
          entryTier: "basic",
          coffee: false,
        },
        locale: "en-US",
      });
      expect(inviteeBooking?.id).toStartWith("account-referral-history-");
      expect(inviteeBooking?.authorAccountId).toStartWith(
        "e2e-reservation-author-"
      );
      expect(String(inviteeBooking?.paidAt)).toBe(paidAt);
      expect(String(inviteeBooking?.reservationConfirmedAt)).toBe(paidAt);
      expect(String(inviteeBooking?.reservationCreatedAt)).toBe(paidAt);

      await runWithDatabase(
        seedWorkspaceE2EReferrerSavings({
          dotyposReservationId: DotyposReservationIdSchema.make(
            `referral-owner-visit-${run}`
          ),
          paidAt: visitEndedAt,
          referrerDotyposCustomerId: referrer,
          saved: { subtotal: 20_000, value: 1_000 },
        })
      );
      const [savingsBooking] = await readCustomerReservations(referrer);
      expect(savingsBooking).toMatchObject({
        authorAccountId: owner.accountId,
        reservationState: "confirmed",
        paymentState: "paid",
      });
      const [application] = await testDatabase!.db
        .select({ paymentAttemptId: discountApplications.paymentAttemptId })
        .from(discountApplications)
        .where(
          eq(discountApplications.workspaceReservationId, savingsBooking!.id)
        )
        .pipe(Effect.runPromise);
      const [attempt] = await testDatabase!.db
        .select({ reservationId: paymentAttempts.workspaceReservationId })
        .from(paymentAttempts)
        .where(eq(paymentAttempts.id, application!.paymentAttemptId))
        .pipe(Effect.runPromise);
      expect(attempt).toEqual({ reservationId: savingsBooking!.id });
    });
  }
);
