import { testEmailAddress } from "@deskohub/test-email";
import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import {
  type DotyposCustomerId,
  type DotyposReservation,
  type DotyposReservationId,
  DotyposService,
} from "@deskohub/dotypos";
import { Effect, Layer } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { WorkspaceDatabaseAdvisoryLock } from "@/db/postgres-advisory-lock";
import {
  promotionCodes,
  referralAttributions,
  referralCodes,
} from "@/db/schema";
import { canonicalPromotionCodeSchema } from "@/features/discounts/persistence-contracts";
import { ReferralService } from "@/features/referrals";
import { parseReferralCode } from "@/features/referrals/client";
import { ReferralFeatureFlagServiceMock } from "@/features/referrals/referral-feature-flag.service.mock";
import { workspaceFixtures } from "@/shared/testing/workspace-fixtures.test-utils";
import { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import {
  type CustomerAccountId,
  customerAccountIdSchema,
} from "../customer-account";
import { acceptAutoLinkedReferral } from "./auto-linked-referral";
import { CustomerAccountLinkRepository } from "./customer-account-link.repository";
import {
  type CustomerAccountResolutionDependencies,
  CustomerAccountResolver,
  resolveCustomerAccount,
  resolveCustomerAccountLink,
} from "./customer-account-resolver.service";

const testDatabase = await connectWorkspacePostgresTestDatabase();
const uniqueId = () => crypto.randomUUID();
const uniqueDotyposId = () =>
  `${Math.floor(Math.random() * 900_000) + 100_000}${Math.floor(
    Math.random() * 900
  )}` as DotyposCustomerId;
const uniqueCode = () =>
  `RFL${uniqueId().replaceAll("-", "").slice(0, 10).toUpperCase()}`;

const insertAuthUser = (
  accountId: CustomerAccountId,
  linkedCustomer?: DotyposCustomerId
) =>
  Effect.runPromise(
    workspaceFixtures(testDatabase!.db).account("auto-linked-referral", {
      id: accountId,
      email: testEmailAddress(accountId),
      verified: false,
      linkedCustomer,
    })
  );

const insertLink = async (
  accountId: CustomerAccountId,
  customerId: DotyposCustomerId
) => {
  await testDatabase!.pool.query(
    `update customer_accounts set dotypos_customer_id = $2 where id = $1`,
    [accountId, customerId]
  );
};

const insertReferralCode = async (
  referrerCustomerId: DotyposCustomerId
): Promise<{ readonly code: string; readonly promotionCodeId: string }> => {
  const code = uniqueCode();
  const [promotion] = await Effect.runPromise(
    testDatabase!.db
      .insert(promotionCodes)
      .values({
        kind: "referral",
        code: canonicalPromotionCodeSchema.make(code),
        enabled: true,
      })
      .returning({ id: promotionCodes.id })
  );
  await Effect.runPromise(
    testDatabase!.db.insert(referralCodes).values({
      promotionCodeId: promotion!.id,
      referrerDotyposCustomerId: referrerCustomerId,
    })
  );
  return { code, promotionCodeId: promotion!.id };
};

/** An active referrer: an auth account linked to a customer with a code. */
const insertReferrer = async () => {
  const accountId = customerAccountIdSchema.make(uniqueId());
  const customerId = uniqueDotyposId();
  await insertAuthUser(accountId, customerId);
  const { code, promotionCodeId } = await insertReferralCode(customerId);
  return { accountId, customerId, code, promotionCodeId };
};

const readReferrer = async (invitedCustomerId: DotyposCustomerId) => {
  const result = await testDatabase!.pool.query<{
    referrer_dotypos_customer_id: string;
  }>(
    "select referrer_dotypos_customer_id from referral_attributions where invited_dotypos_customer_id = $1",
    [invitedCustomerId]
  );
  return result.rows[0]?.referrer_dotypos_customer_id;
};

const pastReservation = {
  id: `reservation-${uniqueId()}` as DotyposReservationId,
  status: "CONFIRMED",
  endDate: Temporal.Now.instant().subtract({ hours: 24 }).toString(),
} as DotyposReservation;

/**
 * Runs the account page's sign-in sequence against the real link repository
 * and advisory lock: resolve (which may claim the existing exact-email
 * customer), then record the shared code. The Dotypos lookup always reports
 * the given customer as the unique active exact-email match.
 */
const signIn = (input: {
  readonly accountId: CustomerAccountId;
  readonly existingCustomerId: DotyposCustomerId;
  readonly code: string;
  readonly reservations?: readonly DotyposReservation[];
}) => {
  const databaseLayer = Layer.succeed(
    WorkspaceDatabase,
    WorkspaceDatabase.make(testDatabase!.db)
  );
  const lockLayer = WorkspaceDatabaseAdvisoryLock.makeLayer(testDatabase!.pool);
  const linksLayer = CustomerAccountLinkRepository.Default.pipe(
    Layer.provide(Layer.mergeAll(databaseLayer, lockLayer))
  );

  return Effect.gen(function* () {
    const links = yield* CustomerAccountLinkRepository;
    const dependencies: CustomerAccountResolutionDependencies = {
      currentUser: () =>
        Effect.succeed({
          accountId: input.accountId,
          email: testEmailAddress(input.accountId),
          deletionRequested: false,
        }),
      findLink: links.find,
      isReviewAccount: () => Effect.succeed(false),
      classify: () =>
        Effect.succeed({
          kind: "matched",
          state: "active",
          customerId: input.existingCustomerId,
        }),
      claimLink: links.claim,
      reactivate: () => Effect.void,
      withAccountLock: links.withAccountLock,
    };

    const resolution = yield* resolveCustomerAccountLink(dependencies);
    yield* acceptAutoLinkedReferral(
      resolution,
      parseReferralCode(input.code)
    ).pipe(
      Effect.provide(
        ReferralService.Default.pipe(
          Layer.provide(
            Layer.mergeAll(
              ReferralFeatureFlagServiceMock({
                isEnabled: Effect.succeed(true),
              }),
              databaseLayer,
              lockLayer,
              linksLayer,
              Layer.mock(CustomerAccountResolver, {
                resolve: resolveCustomerAccount(dependencies),
              }),
              Layer.mock(DotyposService, {
                listReservations: () =>
                  Effect.succeed(input.reservations ?? []),
              } as Partial<DotyposService["Service"]>)
            )
          )
        )
      )
    );
    return resolution;
  }).pipe(
    Effect.provide(linksLayer),
    // Recording under the resolver's account lock would wait on that lock
    // forever; the timeout turns such a regression into a failure.
    Effect.timeout("10 seconds"),
    Effect.runPromise
  );
};

const newInvitee = async () => {
  const accountId = customerAccountIdSchema.make(uniqueId());
  await insertAuthUser(accountId);
  return { accountId, customerId: uniqueDotyposId() };
};

describe.skipIf(!testDatabase)(
  "Auto-linked sign-in referral on disposable Postgres",
  () => {
    test("records the shared code once, at the sign-in that links an existing customer", async () => {
      const referrer = await insertReferrer();
      const laterReferrer = await insertReferrer();
      const invitee = await newInvitee();

      const firstSignIn = await signIn({
        accountId: invitee.accountId,
        existingCustomerId: invitee.customerId,
        code: referrer.code,
      });

      expect(firstSignIn).toEqual({
        account: {
          accountId: invitee.accountId,
          dotyposCustomerId: invitee.customerId,
        },
        autoLinked: true,
      });
      expect(await readReferrer(invitee.customerId)).toBe(referrer.customerId);

      const returningSignIn = await signIn({
        accountId: invitee.accountId,
        existingCustomerId: invitee.customerId,
        code: laterReferrer.code,
      });

      expect(returningSignIn.autoLinked).toBe(false);
      expect(await readReferrer(invitee.customerId)).toBe(referrer.customerId);
    });

    test("never records a code for an account linked before this sign-in", async () => {
      const referrer = await insertReferrer();
      const invitee = await newInvitee();
      // Profile completion and earlier sign-ins both leave a durable link.
      await insertLink(invitee.accountId, invitee.customerId);

      const resolution = await signIn({
        accountId: invitee.accountId,
        existingCustomerId: invitee.customerId,
        code: referrer.code,
      });

      expect(resolution.autoLinked).toBe(false);
      expect(await readReferrer(invitee.customerId)).toBeUndefined();
    });

    test("links silently without a referral for an unknown, self, or ineligible code", async () => {
      const referrer = await insertReferrer();

      const unknownCode = await newInvitee();
      await expect(
        signIn({
          accountId: unknownCode.accountId,
          existingCustomerId: unknownCode.customerId,
          code: uniqueCode(),
        })
      ).resolves.toMatchObject({ autoLinked: true });
      expect(await readReferrer(unknownCode.customerId)).toBeUndefined();

      const selfReferral = await newInvitee();
      const ownCode = await insertReferralCode(selfReferral.customerId);
      await expect(
        signIn({
          accountId: selfReferral.accountId,
          existingCustomerId: selfReferral.customerId,
          code: ownCode.code,
        })
      ).resolves.toMatchObject({ autoLinked: true });
      expect(await readReferrer(selfReferral.customerId)).toBeUndefined();

      const priorBooking = await newInvitee();
      await expect(
        signIn({
          accountId: priorBooking.accountId,
          existingCustomerId: priorBooking.customerId,
          code: referrer.code,
          reservations: [pastReservation],
        })
      ).resolves.toMatchObject({ autoLinked: true });
      expect(await readReferrer(priorBooking.customerId)).toBeUndefined();
    });

    test("keeps an existing attribution for the linked customer unchanged", async () => {
      const originalReferrer = await insertReferrer();
      const sharedReferrer = await insertReferrer();
      const invitee = await newInvitee();
      await Effect.runPromise(
        testDatabase!.db.insert(referralAttributions).values({
          invitedDotyposCustomerId: invitee.customerId,
          referrerDotyposCustomerId: originalReferrer.customerId,
          promotionCodeId: originalReferrer.promotionCodeId,
        })
      );

      await expect(
        signIn({
          accountId: invitee.accountId,
          existingCustomerId: invitee.customerId,
          code: sharedReferrer.code,
        })
      ).resolves.toMatchObject({ autoLinked: true });
      expect(await readReferrer(invitee.customerId)).toBe(
        originalReferrer.customerId
      );
    });
  }
);
