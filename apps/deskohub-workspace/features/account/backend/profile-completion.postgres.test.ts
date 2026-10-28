import { testEmailAddress } from "@deskohub/test-email";
import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { type DotyposCustomerId, DotyposService } from "@deskohub/dotypos";
import { PostHogFeatureFlagEvaluationError } from "@deskohub/posthog/feature-flags/node";
import { Deferred, Effect, Fiber, Layer } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { WorkspaceDatabaseAdvisoryLock } from "@/db/postgres-advisory-lock";
import {
  promotionCodes,
  referralAttributions,
  referralCodes,
} from "@/db/schema";
import { PaymentLifecycleRepository } from "@/features/checkout/backend/repositories/payment-lifecycle.repository";
import { admitPendingNexiPayment } from "@/features/checkout/backend/repositories/payment-lifecycle.test-utils";
import { canonicalPromotionCodeSchema } from "@/features/discounts/persistence-contracts";
import { WorkspaceFeatureFlagServiceMock } from "@/features/feature-flags/backend/workspace-feature-flag.service.mock";
import { ReferralService } from "@/features/referrals";
import { ReferralFeatureFlagService } from "@/features/referrals/referral-feature-flag.service";
import { ReferralFeatureFlagServiceMock } from "@/features/referrals/referral-feature-flag.service.mock";
import { ReferralSignupIntentRepository } from "@/features/referrals/signup-intent.repository";
import { NoReviewAccounts } from "@/features/review-accounts/backend/review-accounts.repository.mock";
import { workspaceFixtures } from "@/shared/testing/workspace-fixtures.test-utils";
import { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import {
  type CustomerAccountId,
  customerAccountIdSchema,
  customerAccountUnavailable,
} from "../customer-account";
import { CustomerAccountLinkRepository } from "./customer-account-link.repository";
import { waitForAccountAdvisoryLockWait } from "./customer-account-lock.test-utils";
import { CustomerAccountResolver } from "./customer-account-resolver.service";
import { CustomerDotyposAdapter } from "./customer-dotypos-adapter.service";
import { CustomerProfileService } from "./customer-profile.service";
import { completeNewCustomerProfile } from "./profile-completion";
import {
  acknowledgeSignupReferral,
  recordSignupReferral,
} from "./signup-referral";

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
    workspaceFixtures(testDatabase!.db).account("profile-completion", {
      id: accountId,
      email: testEmailAddress(accountId),
      verified: false,
      linkedCustomer,
    })
  );

/** An active referrer: an auth account linked to a customer with a code. */
const insertReferrer = async () => {
  const accountId = customerAccountIdSchema.make(uniqueId());
  const customerId = uniqueDotyposId();
  await insertAuthUser(accountId, customerId);
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
      referrerDotyposCustomerId: customerId,
    })
  );
  return { customerId, code, promotionCodeId: promotion!.id };
};

const disableCode = async (promotionCodeId: string) => {
  await testDatabase!.pool.query(
    "update promotion_codes set enabled = false where id = $1",
    [promotionCodeId]
  );
};

const newAccount = async () => {
  const accountId = customerAccountIdSchema.make(uniqueId());
  await insertAuthUser(accountId);
  return accountId;
};

const readLinkedCustomer = async (accountId: CustomerAccountId) => {
  const result = await testDatabase!.pool.query<{
    dotypos_customer_id: DotyposCustomerId;
  }>("select dotypos_customer_id from customer_accounts where id = $1", [
    accountId,
  ]);
  return result.rows[0]?.dotypos_customer_id;
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

/** Codes still waiting to be recorded; a settled intent no longer counts. */
const readIntentCodes = async (accountId: CustomerAccountId) => {
  const result = await testDatabase!.pool.query<{
    promotion_code_id: string;
  }>(
    "select promotion_code_id from referral_signup_intents where customer_account_id = $1 and settled_at is null",
    [accountId]
  );
  return result.rows.map((row) => row.promotion_code_id);
};

const readStoredOutcome = async (accountId: CustomerAccountId) => {
  const result = await testDatabase!.pool.query<{
    outcome: string | null;
    settled_at: Date | null;
    acknowledged_at: Date | null;
  }>(
    "select outcome, settled_at, acknowledged_at from referral_signup_intents where customer_account_id = $1",
    [accountId]
  );
  return result.rows[0];
};

const countAttributions = async (invitedCustomerId: DotyposCustomerId) => {
  const result = await testDatabase!.pool.query<{ count: string }>(
    "select count(*) from referral_attributions where invited_dotypos_customer_id = $1",
    [invitedCustomerId]
  );
  return Number(result.rows[0]?.count);
};

type Gate = {
  readonly entered: Deferred.Deferred<void>;
  readonly release: Deferred.Deferred<void>;
};

const makeGate = Effect.all({
  entered: Deferred.make<void>(),
  release: Deferred.make<void>(),
});

const passGate = (gate: Gate | undefined) =>
  gate
    ? Deferred.succeed(gate.entered, undefined).pipe(
        Effect.andThen(Deferred.await(gate.release))
      )
    : Effect.void;

const databaseLayer = () =>
  Layer.succeed(WorkspaceDatabase, WorkspaceDatabase.make(testDatabase!.db));

/**
 * The real link repository, advisory locks, intent repository, and referral
 * service on the disposable database. Only the providers are fake: Dotypos
 * creates a fresh customer with no booking history, and the session resolver
 * reads the account's link, or fails as a transient outage when
 * `identityUnavailable` is set. `createGate` holds the
 * Dotypos creation inside the account lock; `recordGate` holds acceptance
 * before its identity check, after the account lock was released.
 */
const completionLayer = (options: {
  readonly accountId: CustomerAccountId;
  readonly createGate?: Gate;
  readonly recordGate?: Gate;
  readonly identityUnavailable?: boolean;
  readonly createdCustomers?: DotyposCustomerId[];
  readonly referralsEnabled?: boolean;
  /** The referral flag the services read; `referralsEnabled` by default. */
  readonly featureFlag?: Layer.Layer<ReferralFeatureFlagService>;
}) => {
  const database = databaseLayer();
  const featureFlag =
    options.featureFlag ??
    ReferralFeatureFlagServiceMock({
      isEnabled: Effect.succeed(options.referralsEnabled ?? true),
    });
  const lock = WorkspaceDatabaseAdvisoryLock.makeLayer(testDatabase!.pool);
  const links = CustomerAccountLinkRepository.Default.pipe(
    Layer.provide(Layer.mergeAll(database, lock))
  );
  const profile = {
    firstName: "Nova",
    lastName: null,
    phone: null,
    billing: null,
  };
  const dotyposAdapter = Layer.mock(CustomerDotyposAdapter, {
    // Every completion here starts from an email no Dotypos customer has.
    classifyExactEmailCustomers: () => Effect.succeed({ kind: "not-found" }),
    createCustomerProfile: () =>
      passGate(options.createGate).pipe(
        Effect.as({ customerId: uniqueDotyposId(), profile }),
        Effect.tap(({ customerId }) =>
          Effect.sync(() => options.createdCustomers?.push(customerId))
        )
      ),
    readCustomerProfile: () => Effect.succeed(profile),
  } satisfies Partial<CustomerDotyposAdapter["Service"]>);
  const resolver = Layer.effect(
    CustomerAccountResolver,
    Effect.map(CustomerAccountLinkRepository, (repository) => ({
      resolve: passGate(options.recordGate).pipe(
        Effect.andThen(repository.find(options.accountId)),
        Effect.mapError(() => customerAccountUnavailable("account-link.read")),
        Effect.flatMap((customerId) =>
          customerId && !options.identityUnavailable
            ? Effect.succeed({
                accountId: options.accountId,
                dotyposCustomerId: customerId,
              })
            : Effect.fail(customerAccountUnavailable("account-link.read"))
        )
      ),
    }))
  ).pipe(Layer.provide(links));
  const referrals = ReferralService.Default.pipe(
    Layer.provide(
      Layer.mergeAll(
        featureFlag,
        database,
        lock,
        links,
        resolver,
        Layer.mock(DotyposService, {
          listReservations: () => Effect.succeed([]),
        } as Partial<DotyposService["Service"]>)
      )
    )
  );
  return Layer.mergeAll(
    CustomerProfileService.Default.pipe(
      Layer.provide(Layer.mergeAll(links, dotyposAdapter, NoReviewAccounts))
    ),
    referrals,
    ReferralSignupIntentRepository.Default.pipe(Layer.provide(database)),
    featureFlag,
    links
  );
};

/**
 * Recording under the completion's own account lock would wait on that lock
 * forever; the timeout turns such a regression into a failure.
 */
const withinLockBudget = Effect.timeout("10 seconds");

const complete = (
  accountId: CustomerAccountId,
  referral: { readonly code?: string; readonly prefilledCode?: string }
) =>
  completeNewCustomerProfile(
    { accountId, email: testEmailAddress(accountId) },
    { firstName: "Nova" },
    { code: referral.code, prefilledCode: referral.prefilledCode }
  );

/**
 * Completes the profile while acceptance is unavailable, so the code stays
 * stored as an intent for the linked-load retry.
 */
const completeWithStoredIntent = async (code: string) => {
  const accountId = await newAccount();
  const outcome = await complete(accountId, { code }).pipe(
    withinLockBudget,
    Effect.provide(completionLayer({ accountId, identityUnavailable: true })),
    Effect.runPromise
  );
  expect(outcome).toMatchObject({
    status: "completed",
    referral: { status: "pending" },
  });
  const customerId = (await readLinkedCustomer(accountId))!;
  return { accountId, customerId };
};

const retrySignupReferral = (account: {
  readonly accountId: CustomerAccountId;
  readonly customerId: DotyposCustomerId;
}) =>
  recordSignupReferral({
    accountId: account.accountId,
    dotyposCustomerId: account.customerId,
  }).pipe(
    withinLockBudget,
    Effect.provide(completionLayer({ accountId: account.accountId })),
    Effect.runPromise
  );

const paymentLifecycle = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      return yield* PaymentLifecycleRepository;
    }).pipe(
      Effect.provide(
        PaymentLifecycleRepository.Default.pipe(Layer.provide(databaseLayer()))
      )
    )
  );

/**
 * Starts a Nexi payment for the customer through the real lifecycle,
 * optionally carrying a checkout referral, and returns its paid transition.
 */
const startPayment = async (
  customerId: DotyposCustomerId,
  referral?: {
    readonly customerId: DotyposCustomerId;
    readonly promotionCodeId: string;
  }
) => {
  const lifecycle = await paymentLifecycle();
  const reservation = await Effect.runPromise(
    workspaceFixtures(testDatabase!.db).reservation({
      stage: { reservation: "held" },
      customer: customerId,
    })
  );
  const attempt = await Effect.runPromise(
    admitPendingNexiPayment(
      lifecycle,
      reservation,
      referral && {
        referrerDotyposCustomerId: referral.customerId,
        promotionCodeId: referral.promotionCodeId,
      }
    )
  );
  return {
    markPaid: () =>
      Effect.runPromise(
        lifecycle.markPaid({
          id: attempt.id,
          workspaceReservationId: reservation.id,
          paidAt: Temporal.Now.instant(),
        })
      ),
  };
};

describe.skipIf(!testDatabase)(
  "Profile completion referral on disposable Postgres",
  () => {
    test("records a typed code after releasing the account lock and clears its intent", async () => {
      const referrer = await insertReferrer();
      const accountId = await newAccount();

      const outcome = await complete(accountId, {
        code: referrer.code.toLowerCase(),
      }).pipe(
        withinLockBudget,
        Effect.provide(completionLayer({ accountId })),
        Effect.runPromise
      );

      expect(outcome).toMatchObject({
        status: "completed",
        referral: { status: "applied" },
      });
      const customerId = await readLinkedCustomer(accountId);
      expect(await readReferrer(customerId!)).toBe(referrer.customerId);
      expect(await readIntentCodes(accountId)).toEqual([]);
    });

    test("records only the code of the completion that creates the link", async () => {
      const winningReferrer = await insertReferrer();
      const losingReferrer = await insertReferrer();
      const accountId = await newAccount();
      const createdCustomers: DotyposCustomerId[] = [];

      const [winner, loser] = await Effect.gen(function* () {
        const createGate = yield* makeGate;
        const first = yield* Effect.forkChild(
          complete(accountId, { code: winningReferrer.code }).pipe(
            Effect.provide(
              completionLayer({ accountId, createGate, createdCustomers })
            )
          )
        );
        // The first completion now holds the account lock inside creation.
        yield* Deferred.await(createGate.entered);
        const second = yield* Effect.forkChild(
          complete(accountId, { code: losingReferrer.code }).pipe(
            Effect.provide(completionLayer({ accountId, createdCustomers }))
          )
        );
        yield* Effect.promise(() =>
          waitForAccountAdvisoryLockWait(testDatabase!.pool, accountId)
        );
        yield* Deferred.succeed(createGate.release, undefined);
        return [yield* Fiber.join(first), yield* Fiber.join(second)] as const;
      }).pipe(withinLockBudget, Effect.runPromise);

      expect(winner).toMatchObject({
        status: "completed",
        referral: { status: "applied" },
      });
      expect(loser).toMatchObject({
        status: "completed",
        referral: { status: "not-applied", reason: "already-referred" },
      });
      expect(createdCustomers).toHaveLength(1);
      const customerId = await readLinkedCustomer(accountId);
      expect(customerId).toBe(createdCustomers[0]);
      expect(await readReferrer(customerId!)).toBe(winningReferrer.customerId);
      expect(await readIntentCodes(accountId)).toEqual([]);
    });

    test("reports the completion code as not applied when a checkout code lands first", async () => {
      const completionReferrer = await insertReferrer();
      const checkoutReferrer = await insertReferrer();
      const accountId = await newAccount();

      const { outcome, checkout } = await Effect.gen(function* () {
        const recordGate = yield* makeGate;
        const completion = yield* Effect.forkChild(
          complete(accountId, { code: completionReferrer.code }).pipe(
            Effect.provide(completionLayer({ accountId, recordGate }))
          )
        );
        // The link and intent are committed and the account lock released.
        yield* Deferred.await(recordGate.entered);
        const customerId = yield* Effect.promise(() =>
          readLinkedCustomer(accountId)
        );
        const checkout = yield* Effect.flatMap(ReferralService, (referrals) =>
          referrals.acceptReferral({
            code: checkoutReferrer.code,
            customerAccountId: accountId,
            dotyposCustomerId: customerId!,
          })
        ).pipe(Effect.provide(completionLayer({ accountId })));
        yield* Deferred.succeed(recordGate.release, undefined);
        return { outcome: yield* Fiber.join(completion), checkout };
      }).pipe(withinLockBudget, Effect.runPromise);

      expect(checkout).toEqual({ kind: "accepted" });
      expect(outcome).toMatchObject({
        status: "completed",
        referral: { status: "not-applied", reason: "already-referred" },
      });
      const customerId = await readLinkedCustomer(accountId);
      expect(await readReferrer(customerId!)).toBe(checkoutReferrer.customerId);
      expect(await readIntentCodes(accountId)).toEqual([]);
    });

    test("keeps the intent after a transient failure and records it on the next linked visit", async () => {
      const referrer = await insertReferrer();
      const accountId = await newAccount();

      const outcome = await complete(accountId, { code: referrer.code }).pipe(
        withinLockBudget,
        Effect.provide(
          completionLayer({ accountId, identityUnavailable: true })
        ),
        Effect.runPromise
      );

      expect(outcome).toMatchObject({
        status: "completed",
        referral: { status: "pending" },
      });
      const customerId = await readLinkedCustomer(accountId);
      expect(await readReferrer(customerId!)).toBeUndefined();
      expect(await readIntentCodes(accountId)).toEqual([
        referrer.promotionCodeId,
      ]);

      const retried = await recordSignupReferral({
        accountId,
        dotyposCustomerId: customerId!,
      }).pipe(
        withinLockBudget,
        Effect.provide(completionLayer({ accountId })),
        Effect.runPromise
      );

      expect(retried).toEqual({ status: "applied" });
      expect(await readReferrer(customerId!)).toBe(referrer.customerId);
      expect(await readIntentCodes(accountId)).toEqual([]);
    });

    test("keeps a stored code pending while the referral program is withheld", async () => {
      const referrer = await insertReferrer();
      const account = await completeWithStoredIntent(referrer.code);

      const retried = await recordSignupReferral({
        accountId: account.accountId,
        dotyposCustomerId: account.customerId,
      }).pipe(
        withinLockBudget,
        Effect.provide(
          completionLayer({
            accountId: account.accountId,
            referralsEnabled: false,
          })
        ),
        Effect.runPromise
      );

      expect(retried).toEqual({ status: "pending" });
      expect(await readIntentCodes(account.accountId)).toEqual([
        referrer.promotionCodeId,
      ]);
      expect(await readStoredOutcome(account.accountId)).toMatchObject({
        outcome: null,
        settled_at: null,
      });
      expect(await retrySignupReferral(account)).toEqual({
        status: "applied",
      });
    });

    test("keeps a stored code pending when the referral flag becomes unreadable after the page gate passed", async () => {
      const referrer = await insertReferrer();
      const account = await completeWithStoredIntent(referrer.code);
      // PostHog answers the first evaluation and fails every later one.
      let evaluations = 0;
      // A fresh build evaluates on its own; a shared one is memoized.
      const flakyFlag = (build: "fresh" | "shared") =>
        (build === "fresh"
          ? Layer.fresh(ReferralFeatureFlagService.Default)
          : ReferralFeatureFlagService.Default
        ).pipe(
          Layer.provide(
            WorkspaceFeatureFlagServiceMock({
              isEnabled: () =>
                Effect.suspend(() =>
                  evaluations++ === 0
                    ? Effect.succeed(true)
                    : Effect.fail(
                        new PostHogFeatureFlagEvaluationError({
                          message: "synthetic flag outage",
                          cause: undefined,
                        })
                      )
                ),
            })
          )
        );
      const pageGate = ReferralFeatureFlagService.pipe(
        Effect.flatMap((featureFlag) => featureFlag.isEnabled)
      );
      const linkedLoad = Effect.gen(function* () {
        const released = yield* pageGate;
        return released
          ? yield* recordSignupReferral({
              accountId: account.accountId,
              dotyposCustomerId: account.customerId,
            })
          : undefined;
      }).pipe(withinLockBudget);

      // The page gate and the referral service each evaluating the flag: the
      // gate passes, the service's own evaluation fails closed, and the
      // intent must stay pending rather than settle as an unusable code.
      const separateDecisions = await linkedLoad.pipe(
        Effect.provide(flakyFlag("fresh")),
        Effect.provide(
          completionLayer({
            accountId: account.accountId,
            featureFlag: flakyFlag("fresh"),
          })
        ),
        Effect.runPromise
      );
      expect(evaluations).toBe(2);
      expect(separateDecisions).toEqual({ status: "pending" });
      expect(await readIntentCodes(account.accountId)).toEqual([
        referrer.promotionCodeId,
      ]);
      expect(await readStoredOutcome(account.accountId)).toMatchObject({
        outcome: null,
        settled_at: null,
      });

      // One decision for the whole load, as Workspace provides it: the flag
      // is read once and the stored code is recorded.
      evaluations = 0;
      const sharedDecision = await linkedLoad.pipe(
        Effect.provide(
          completionLayer({
            accountId: account.accountId,
            featureFlag: flakyFlag("shared"),
          })
        ),
        Effect.runPromise
      );
      expect(evaluations).toBe(1);
      expect(sharedDecision).toEqual({ status: "applied" });
      expect(await readReferrer(account.customerId)).toBe(referrer.customerId);
    });

    test("keeps reporting a settled code on later loads without recording it again, until acknowledged", async () => {
      const referrer = await insertReferrer();
      const account = await completeWithStoredIntent(referrer.code);

      // The load that settles the code may be abandoned before it renders.
      expect(await retrySignupReferral(account)).toEqual({ status: "applied" });
      const settled = await readStoredOutcome(account.accountId);
      expect(settled).toMatchObject({
        outcome: "applied",
        acknowledged_at: null,
      });

      expect(await retrySignupReferral(account)).toEqual({ status: "applied" });
      expect(await readStoredOutcome(account.accountId)).toEqual(settled);
      expect(await countAttributions(account.customerId)).toBe(1);

      await acknowledgeSignupReferral({
        accountId: account.accountId,
        dotyposCustomerId: account.customerId,
      }).pipe(
        Effect.provide(completionLayer({ accountId: account.accountId })),
        Effect.runPromise
      );
      expect(await retrySignupReferral(account)).toBeUndefined();
      expect(
        (await readStoredOutcome(account.accountId))?.acknowledged_at
      ).not.toBeNull();
    });

    test("settles a stored code once when two account loads retry it together", async () => {
      const referrer = await insertReferrer();
      const account = await completeWithStoredIntent(referrer.code);
      const linked = {
        accountId: account.accountId,
        dotyposCustomerId: account.customerId,
      };

      const outcomes = await Effect.gen(function* () {
        const first = yield* makeGate;
        const second = yield* makeGate;
        const load = (gate: Gate) =>
          recordSignupReferral(linked).pipe(
            Effect.provide(
              completionLayer({
                accountId: account.accountId,
                recordGate: gate,
              })
            )
          );
        const loads = yield* Effect.forkChild(
          Effect.all([load(first), load(second)], { concurrency: "unbounded" })
        );
        // Both loads have read the unsettled code before either records it.
        yield* Deferred.await(first.entered);
        yield* Deferred.await(second.entered);
        yield* Deferred.succeed(first.release, undefined);
        yield* Deferred.succeed(second.release, undefined);
        return yield* Fiber.join(loads);
      }).pipe(withinLockBudget, Effect.runPromise);

      expect(outcomes).toEqual([{ status: "applied" }, { status: "applied" }]);
      expect(await countAttributions(account.customerId)).toBe(1);
      expect(await readStoredOutcome(account.accountId)).toMatchObject({
        outcome: "applied",
      });
    });

    test("lets only one of several concurrent settlements record a stored code's outcome", async () => {
      const referrer = await insertReferrer();
      const account = await completeWithStoredIntent(referrer.code);

      const settled = await Effect.gen(function* () {
        const intents = yield* ReferralSignupIntentRepository;
        return yield* Effect.all(
          (["applied", "already-referred", "not-eligible"] as const).map(
            (outcome) =>
              intents
                .settle(account.accountId, referrer.promotionCodeId, outcome)
                .pipe(Effect.map((won) => ({ outcome, won })))
          ),
          { concurrency: "unbounded" }
        );
      }).pipe(
        Effect.provide(
          ReferralSignupIntentRepository.Default.pipe(
            Layer.provide(databaseLayer())
          )
        ),
        Effect.runPromise
      );

      const winners = settled.filter(({ won }) => won);
      expect(winners).toHaveLength(1);
      expect(await readStoredOutcome(account.accountId)).toMatchObject({
        outcome: winners[0]!.outcome,
      });
    });

    test("keeps the intent while a payment is pending and settles it as not eligible once that payment is paid", async () => {
      const referrer = await insertReferrer();
      const account = await completeWithStoredIntent(referrer.code);
      const payment = await startPayment(account.customerId);

      expect(await retrySignupReferral(account)).toEqual({ status: "pending" });
      expect(await readIntentCodes(account.accountId)).toEqual([
        referrer.promotionCodeId,
      ]);

      expect((await payment.markPaid()).changed).toBe(true);

      expect(await retrySignupReferral(account)).toEqual({
        status: "not-applied",
        reason: "not-eligible",
      });
      expect(await readReferrer(account.customerId)).toBeUndefined();
      expect(await readIntentCodes(account.accountId)).toEqual([]);
    });

    test.each([
      ["the stored code", "applied"],
      ["a different code", "already-referred"],
    ] as const)(
      "settles the intent from the attribution recorded when a pending checkout carrying %s is paid",
      async (carried, expected) => {
        const referrer = await insertReferrer();
        const account = await completeWithStoredIntent(referrer.code);
        const checkoutReferrer =
          carried === "the stored code" ? referrer : await insertReferrer();
        const payment = await startPayment(
          account.customerId,
          checkoutReferrer
        );

        expect(await retrySignupReferral(account)).toEqual({
          status: "pending",
        });
        expect(
          await Effect.flatMap(ReferralService, (referrals) =>
            referrals.evaluateCheckoutReferral({
              code: referrer.code,
              dotyposCustomerId: account.customerId,
            })
          ).pipe(
            Effect.flip,
            Effect.provide(completionLayer({ accountId: account.accountId })),
            Effect.runPromise
          )
        ).toMatchObject({ reason: "pending_payment" });
        expect(await readIntentCodes(account.accountId)).toEqual([
          referrer.promotionCodeId,
        ]);

        expect((await payment.markPaid()).changed).toBe(true);
        expect(await readReferrer(account.customerId)).toBe(
          checkoutReferrer.customerId
        );

        expect(await retrySignupReferral(account)).toEqual(
          expected === "applied"
            ? { status: "applied" }
            : { status: "not-applied", reason: expected }
        );
        expect(await readReferrer(account.customerId)).toBe(
          checkoutReferrer.customerId
        );
        expect(await readIntentCodes(account.accountId)).toEqual([]);
      }
    );

    test("settles the intent as not applied when the code's owner was meanwhile invited by this customer", async () => {
      const referrer = await insertReferrer();
      const account = await completeWithStoredIntent(referrer.code);
      const [ownCode] = await Effect.runPromise(
        testDatabase!.db
          .insert(promotionCodes)
          .values({
            kind: "referral",
            code: canonicalPromotionCodeSchema.make(uniqueCode()),
            enabled: true,
          })
          .returning({ id: promotionCodes.id })
      );
      await Effect.runPromise(
        testDatabase!.db.insert(referralCodes).values({
          promotionCodeId: ownCode!.id,
          referrerDotyposCustomerId: account.customerId,
        })
      );
      await Effect.runPromise(
        testDatabase!.db.insert(referralAttributions).values({
          invitedDotyposCustomerId: referrer.customerId,
          referrerDotyposCustomerId: account.customerId,
          promotionCodeId: ownCode!.id,
        })
      );

      expect(await retrySignupReferral(account)).toEqual({
        status: "not-applied",
        reason: "code-unusable",
      });
      expect(await readReferrer(account.customerId)).toBeUndefined();
      expect(await readIntentCodes(account.accountId)).toEqual([]);
    });

    test("clears the intent when the code became unusable before recording", async () => {
      const referrer = await insertReferrer();
      const accountId = await newAccount();

      const outcome = await Effect.gen(function* () {
        const recordGate = yield* makeGate;
        const completion = yield* Effect.forkChild(
          complete(accountId, { code: referrer.code }).pipe(
            Effect.provide(completionLayer({ accountId, recordGate }))
          )
        );
        yield* Deferred.await(recordGate.entered);
        yield* Effect.promise(() => disableCode(referrer.promotionCodeId));
        yield* Deferred.succeed(recordGate.release, undefined);
        return yield* Fiber.join(completion);
      }).pipe(withinLockBudget, Effect.runPromise);

      expect(outcome).toMatchObject({
        status: "completed",
        referral: { status: "not-applied", reason: "code-unusable" },
      });
      const customerId = await readLinkedCustomer(accountId);
      expect(await readReferrer(customerId!)).toBeUndefined();
      expect(await readIntentCodes(accountId)).toEqual([]);
    });

    test("completes without a referral when the shared-link code stopped being usable", async () => {
      const referrer = await insertReferrer();
      await disableCode(referrer.promotionCodeId);
      const accountId = await newAccount();

      const outcome = await complete(accountId, {
        code: ` ${referrer.code.toLowerCase()} `,
        prefilledCode: referrer.code,
      }).pipe(
        withinLockBudget,
        Effect.provide(completionLayer({ accountId })),
        Effect.runPromise
      );

      expect(outcome).toMatchObject({ status: "completed" });
      expect(outcome).not.toHaveProperty("referral");
      const customerId = await readLinkedCustomer(accountId);
      expect(customerId).toBeDefined();
      expect(await readReferrer(customerId!)).toBeUndefined();
      expect(await readIntentCodes(accountId)).toEqual([]);
    });

    test("rejects a typed code that is not usable and creates nothing", async () => {
      const referrer = await insertReferrer();
      const prefilled = await insertReferrer();
      await disableCode(referrer.promotionCodeId);
      const accountId = await newAccount();
      const createdCustomers: DotyposCustomerId[] = [];

      const outcome = await complete(accountId, {
        code: referrer.code,
        prefilledCode: prefilled.code,
      }).pipe(
        withinLockBudget,
        Effect.provide(completionLayer({ accountId, createdCustomers })),
        Effect.runPromise
      );

      expect(outcome).toEqual({ status: "referral-code-unavailable" });
      expect(createdCustomers).toEqual([]);
      expect(await readLinkedCustomer(accountId)).toBeNull();
    });

    test("ignores a submitted code while the referral program is withheld", async () => {
      const referrer = await insertReferrer();
      const unusable = await insertReferrer();
      await disableCode(unusable.promotionCodeId);

      for (const code of [referrer.code, unusable.code]) {
        const accountId = await newAccount();

        const outcome = await complete(accountId, { code }).pipe(
          withinLockBudget,
          Effect.provide(
            completionLayer({ accountId, referralsEnabled: false })
          ),
          Effect.runPromise
        );

        expect(outcome).toEqual({
          status: "completed",
          account: expect.objectContaining({ accountId }),
        });
        const customerId = await readLinkedCustomer(accountId);
        expect(customerId).toBeDefined();
        expect(await readStoredOutcome(accountId)).toBeUndefined();
        expect(await countAttributions(customerId!)).toBe(0);
      }
    });
  }
);
