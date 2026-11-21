import "@/shared/testing/workspace-test-env";

import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import { DotyposRejected, DotyposService } from "@deskohub/dotypos";
import {
  AlgoPinSchema,
  IgloohomePinIdSchema,
  IgloohomeService,
} from "@deskohub/igloohome";
import { testEmailAddress } from "@deskohub/test-email";
import { NodeCrypto } from "@effect/platform-node";
import { Effect, Layer } from "effect";
import { TestClock } from "effect/testing";
import { loadAccountUnlimitedPasses } from "@/features/account/account-unlimited-passes.server";
import {
  CurrentCustomerAccount,
  requireVerifiedIdentity,
} from "@/features/account/backend/current-customer-account";
import { testSessionProfile } from "@/features/account/backend/customer-authentication.test-utils";
import {
  type CustomerAccountId,
  customerAccountIdSchema,
} from "@/features/account/customer-account";
import { type OrderId, orderIdSchema } from "@/features/order";
import { AdvisoryAvailabilityInventory } from "@/features/reservation/backend/availability-inventory";
import { WorkspaceReservationRepository } from "@/features/reservation/backend/workspace-reservation.repository";
import { getCoworkReservationInterval } from "@/features/reservation/cowork-reservation";
import { ReservationAccessService } from "@/features/reservation-access";
import { ReservationAccessRepository } from "@/features/reservation-access/backend/reservation-access.repository";
import {
  createWorkspacePostgresSuiteDatabase,
  type WorkspacePostgresSuiteDatabase,
} from "@/shared/testing/workspace-postgres-test-database.test-utils";
import { atInstant } from "@/shared/testing/workspace-test-clock.test-utils";
import type { PassTier } from "../pass-offer";
import { unlimitedAccessTokenQueryParam } from "../unlimited-access";
import { loadUnlimitedAccess } from "./unlimited-access";
import {
  createUnlimitedAccessUrl,
  exchangeUnlimitedAccessToken,
} from "./unlimited-access-capability";

const firstDay = "2030-03-31"; // Prague moves to summer time on this date.
const nextDay = "2030-04-01";
const during = Temporal.Instant.from("2030-03-31T11:00Z");
const openSpaceClosing = Temporal.Instant.from("2030-03-31T15:00Z");
const nextMidnight = Temporal.Instant.from("2030-03-31T22:00Z");
const syntheticPin = AlgoPinSchema.make("246813579");

describe.skipIf(!process.env.WORKSPACE_TEST_DATABASE_URL)(
  "Unlimited access on disposable Postgres",
  () => {
    let buyer: CustomerAccountId;
    let holder: CustomerAccountId;
    let database: WorkspacePostgresSuiteDatabase;

    beforeAll(async () => {
      database = (await createWorkspacePostgresSuiteDatabase(
        "unlimited_access"
      ))!;
    });

    beforeEach(async () => {
      buyer = customerAccountIdSchema.make(crypto.randomUUID());
      holder = customerAccountIdSchema.make(crypto.randomUUID());
      await database.pool.query(
        "insert into customer_accounts (id) values ($1), ($2)",
        [buyer, holder]
      );
      await database.pool.query(
        `insert into auth."user" (id, name, email, email_verified)
         values ($1, 'Synthetic buyer', $3, true), ($2, 'Synthetic holder', $4, true)`,
        [
          buyer,
          holder,
          testEmailAddress(`pass-buyer-${buyer}`),
          testEmailAddress(`pass-holder-${holder}`),
        ]
      );
    });

    afterAll(async () => {
      await database?.close();
    });

    const seedPass = async (
      tier: PassTier,
      gifted = false,
      period: {
        readonly start: string;
        readonly end: string;
        readonly renews?: OrderId;
      } = { start: firstDay, end: "2030-04-30" }
    ) => {
      const orderId = orderIdSchema.make(crypto.randomUUID());
      await database.pool.query(
        `insert into orders (id, kind, dotypos_customer_id, payment_state, fulfillment_state, paid_at)
         values ($1, 'pass-purchase', '1', 'paid', 'processing', now())`,
        [orderId]
      );
      await database.pool.query(
        `insert into pass_purchases (id, buyer_account_id, holder_account_id, product, tier, unlimited_coffee,
           status, valid_from, valid_until, renews_pass_id, quote, locale, created_at)
         values ($1, $2, $3, 'unlimited', $4, $5, 'active', $6, $7, $8, '{}', 'en-US', now())`,
        [
          orderId,
          buyer,
          gifted ? holder : buyer,
          tier,
          tier === "open-space" ? false : null,
          period.start,
          period.end,
          period.renews ?? null,
        ]
      );
      const { rows } = await database.pool.query<{ id: string }>(
        `insert into workspace_reservations (checkout_attempt_key, pass_id, service_date, pass_day_table_id, dotypos_customer_id,
           author_account_id, dotypos_reservation_id, reservation_state, payment_state, fulfillment_state,
           paid_at, fulfilled_at, reservation_details, locale)
         values (uuid_generate_v7(), $1, $3::date, '14', '1', $2, concat($1::text, ':', $3::text), 'confirmed', 'paid', 'fulfilled', now(), now(), '{}', 'en-US'),
                (uuid_generate_v7(), $1, $4::date, '14', '1', $2, concat($1::text, ':', $4::text), 'confirmed', 'paid', 'fulfilled', now(), now(), '{}', 'en-US')
         returning id`,
        [
          orderId,
          buyer,
          period.start,
          Temporal.PlainDate.from(period.start).add({ days: 1 }).toString(),
        ]
      );
      return { orderId, dayIds: rows.map(({ id }) => id) };
    };

    type Provider = {
      readonly issue: () => Effect.Effect<{
        pin: typeof syntheticPin;
        pinId: ReturnType<typeof IgloohomePinIdSchema.make>;
      }>;
      readonly reads?: string[];
      readonly onRead?: () => void;
      readonly readReservation?: DotyposService["Service"]["getReservationWithoutCustomer"];
      readonly intervalEndsEarly?: boolean;
      readonly isSignedIn?: () => boolean;
      readonly accessCookie?: string;
    };

    const load = (
      orderId: OrderId,
      tier: PassTier,
      viewer: CustomerAccountId | null,
      now: Temporal.Instant,
      provider: Provider
    ) => {
      const accessCodes = ReservationAccessService.Default.pipe(
        Layer.provide(
          Layer.mergeAll(
            ReservationAccessRepository.Default,
            Layer.mock(IgloohomeService, { issueHourlyAlgoPin: provider.issue })
          )
        ),
        Layer.provide(Layer.mergeAll(database.layer, NodeCrypto.layer))
      );

      return Effect.runPromise(
        loadUnlimitedAccess(orderId, provider.accessCookie).pipe(
          Effect.provide(
            Layer.mergeAll(
              database.layer,
              accessCodes,
              Layer.mock(CurrentCustomerAccount, {
                requireActive: Effect.suspend(() =>
                  requireVerifiedIdentity(
                    viewer === null || provider.isSignedIn?.() === false
                      ? null
                      : {
                          ...testSessionProfile,
                          accountId: viewer,
                          deletionRequested: false,
                          email: testEmailAddress("pass-viewer"),
                        }
                  )
                ),
              }),
              Layer.mock(DotyposService, {
                getReservationWithoutCustomer:
                  provider.readReservation ??
                  ((id) =>
                    Effect.sync(() => {
                      const date = id.slice(-10);
                      provider.reads?.push(date);
                      provider.onRead?.();
                      const { startsAt, endsAt } = getCoworkReservationInterval(
                        tier === "open-space" ? "open-space" : "reserved-desk",
                        date
                      );
                      return {
                        id,
                        _tableId: "14",
                        status: "CONFIRMED",
                        startDate: startsAt,
                        endDate: provider.intervalEndsEarly
                          ? Temporal.Instant.from(endsAt)
                              .subtract({ minutes: 1 })
                              .toString()
                          : endsAt,
                        seats: 1,
                      };
                    })),
                getTables: () =>
                  Effect.succeed([{ id: "14", name: "Desk 14" }]),
              })
            )
          ),
          atInstant(now)
        )
      );
    };

    const issue = () =>
      Effect.succeed({
        pin: syntheticPin,
        pinId: IgloohomePinIdSchema.make("synthetic-unlimited-pin"),
      });

    const holderCookie = (
      orderId: OrderId,
      holderAccountId: CustomerAccountId
    ) =>
      Effect.runPromise(
        Effect.gen(function* () {
          const locale = "en-US";
          const url = yield* createUnlimitedAccessUrl({
            orderId,
            holderAccountId,
            locale,
            origin: new URL("https://workspace.example"),
          });
          const token = new URL(url).searchParams.get(
            unlimitedAccessTokenQueryParam
          )!;
          const cookie = yield* exchangeUnlimitedAccessToken({
            token,
            orderId,
            locale,
          });
          return cookie.value;
        })
      );

    const reassignToHolder = (orderId: OrderId) =>
      database.pool.query(
        "update pass_purchases set holder_account_id = $2, gift_claimed_at = now() where id = $1",
        [orderId, holder]
      );

    test("the original link follows the signed-in holder at the Prague renewal boundary", async () => {
      const original = await seedPass("open-space", true, {
        start: "2030-03-01",
        end: firstDay,
      });
      const successor = await seedPass("open-space", true, {
        start: firstDay,
        end: "2030-04-30",
        renews: original.orderId,
      });
      await reassignToHolder(original.orderId);
      await reassignToHolder(successor.orderId);
      const reads: string[] = [];
      const provider = { issue, reads };

      expect(
        await load(
          original.orderId,
          "open-space",
          holder,
          Temporal.Instant.from("2030-03-30T22:59:59Z"),
          provider
        )
      ).toMatchObject({ state: "closed", day: 30 });
      expect(reads).toEqual([]);

      expect(
        await load(original.orderId, "open-space", buyer, during, provider)
      ).toEqual({ state: "not-found" });
      expect(reads).toEqual([]);

      const accessCookie = await holderCookie(original.orderId, holder);
      for (const viewer of [null, holder]) {
        expect(
          await load(original.orderId, "open-space", viewer, during, {
            ...provider,
            accessCookie,
          })
        ).toMatchObject({ state: "ended", validUntil: firstDay });
      }
      expect(reads).toEqual([]);

      let signedIn = true;
      let attemptedIssue = false;
      expect(
        await load(original.orderId, "open-space", holder, during, {
          issue: () => {
            attemptedIssue = true;
            return issue();
          },
          isSignedIn: () => signedIn,
          onRead: () => {
            signedIn = false;
          },
        })
      ).toEqual({ state: "not-found" });
      expect(attemptedIssue).toBe(false);

      expect(
        await load(original.orderId, "open-space", holder, during, provider)
      ).toMatchObject({ state: "available", day: 1, validFrom: firstDay });
      expect(reads).toEqual([firstDay]);
    });

    test("the first URL reaches a later paid renewal without crossing an unpaid or reassigned period", async () => {
      const original = await seedPass("open-space", false, {
        start: "2030-01-30",
        end: "2030-03-01",
      });
      const middle = await seedPass("open-space", false, {
        start: "2030-03-01",
        end: firstDay,
        renews: original.orderId,
      });
      await seedPass("open-space", false, {
        start: firstDay,
        end: "2030-04-30",
        renews: middle.orderId,
      });

      const reads: string[] = [];
      const access = () =>
        load(original.orderId, "open-space", buyer, during, { issue, reads });
      expect(await access()).toMatchObject({ state: "available", day: 1 });
      reads.length = 0;

      await database.pool.query(
        "update orders set payment_state = 'pending', paid_at = null where id = $1",
        [middle.orderId]
      );
      expect(await access()).toMatchObject({ state: "ended" });
      await database.pool.query(
        "update orders set payment_state = 'paid', paid_at = now() where id = $1",
        [middle.orderId]
      );
      await reassignToHolder(middle.orderId);
      expect(await access()).toMatchObject({ state: "ended" });
      expect(reads).toEqual([]);
    });

    test("a historical paid fork blocks access through its only current descendant", async () => {
      const original = await seedPass("open-space", false, {
        start: "2030-01-30",
        end: "2030-03-01",
      });
      const period = {
        start: "2030-03-01",
        end: firstDay,
        renews: original.orderId,
      };
      const middle = await seedPass("open-space", false, period);
      const sibling = await seedPass("open-space", false, period);
      await database.pool.query(
        "update pass_purchases set status = 'expired' where id in ($1, $2)",
        [middle.orderId, sibling.orderId]
      );
      await seedPass("open-space", false, {
        start: firstDay,
        end: "2030-04-30",
        renews: middle.orderId,
      });

      const reads: string[] = [];
      expect(
        await load(original.orderId, "open-space", buyer, during, {
          issue,
          reads,
        })
      ).toMatchObject({ state: "ended", validUntil: "2030-03-01" });
      expect(reads).toEqual([]);
    });

    test("withdrawal preserves the access cutoff and offers exactly the original term end to the holder", async () => {
      const original = await seedPass("open-space", false, {
        start: "2030-03-01",
        end: firstDay,
      });
      await database.pool.query(
        "update pass_purchases set status = 'withdrawn', access_ends_on = '2030-03-28' where id = $1",
        [original.orderId]
      );
      const afterCutoff = Temporal.Instant.from("2030-03-28T11:00Z");
      const accountPass = async () => {
        const passes = await Effect.runPromise(
          loadAccountUnlimitedPasses("en-US").pipe(
            Effect.provide(
              Layer.mergeAll(
                database.layer,
                Layer.mock(AdvisoryAvailabilityInventory, {}),
                Layer.mock(CurrentCustomerAccount, {
                  peek: Effect.succeed({
                    kind: "unlinked",
                    reviewMarker: "absent",
                    session: {
                      ...testSessionProfile,
                      accountId: buyer,
                      deletionRequested: false,
                      email: testEmailAddress("pass-viewer"),
                    },
                  }),
                })
              )
            ),
            atInstant(afterCutoff)
          )
        );
        return passes.find((pass) => pass.orderId === original.orderId);
      };
      const renewalPath = `/en-US/passes/unlimited?renew=${original.orderId}`;
      expect(await accountPass()).toMatchObject({ renewalPath });
      const reads: string[] = [];
      expect(
        await load(original.orderId, "open-space", buyer, afterCutoff, {
          issue,
          reads,
        })
      ).toMatchObject({
        state: "ended",
        validUntil: "2030-03-28",
        renewalOrderId: original.orderId,
      });

      const accessCookie = await holderCookie(original.orderId, buyer);
      expect(
        await load(original.orderId, "open-space", buyer, afterCutoff, {
          issue,
          accessCookie,
        })
      ).toMatchObject({ state: "ended", renewalOrderId: original.orderId });
      const capabilityOnly = await load(
        original.orderId,
        "open-space",
        null,
        afterCutoff,
        { issue, accessCookie }
      );
      expect(capabilityOnly).toMatchObject({ state: "ended" });
      expect(capabilityOnly).not.toHaveProperty("renewalOrderId");

      const independentlyBought = await seedPass("open-space", false, {
        start: "2030-04-02",
        end: "2030-05-02",
      });
      const overlapping = await load(
        original.orderId,
        "open-space",
        buyer,
        afterCutoff,
        { issue }
      );
      expect(overlapping).not.toHaveProperty("renewalOrderId");
      expect(await accountPass()).not.toHaveProperty("renewalPath");
      await database.pool.query(
        "update pass_purchases set status = 'withdrawn', access_ends_on = valid_from where id = $1",
        [independentlyBought.orderId]
      );
      expect(
        await load(original.orderId, "open-space", buyer, afterCutoff, {
          issue,
        })
      ).toMatchObject({ state: "ended", renewalOrderId: original.orderId });
      expect(await accountPass()).toMatchObject({ renewalPath });

      const pending = await seedPass("open-space", false, {
        start: firstDay,
        end: "2030-04-30",
        renews: original.orderId,
      });
      await database.pool.query(
        "update pass_purchases set status = 'pending_payment' where id = $1",
        [pending.orderId]
      );
      await database.pool.query(
        "update orders set payment_state = 'pending', paid_at = null where id = $1",
        [pending.orderId]
      );
      expect(
        await load(original.orderId, "open-space", buyer, afterCutoff, {
          issue,
        })
      ).toMatchObject({ state: "ended", renewalOrderId: original.orderId });

      const afterOriginalEnd = Temporal.Instant.from("2030-04-01T11:00Z");
      const lapsed = await load(
        original.orderId,
        "open-space",
        buyer,
        afterOriginalEnd,
        { issue, reads }
      );
      expect(lapsed).toMatchObject({ state: "ended" });
      expect(lapsed).not.toHaveProperty("renewalOrderId");
      expect(reads).toEqual([]);
    });

    test("a renewal withdrawn before it starts does not mask a replacement on the same date", async () => {
      const original = await seedPass("open-space", false, {
        start: "2030-03-01",
        end: firstDay,
      });
      const renewal = {
        start: firstDay,
        end: "2030-04-30",
        renews: original.orderId,
      };
      const withdrawn = await seedPass("open-space", false, renewal);
      await database.pool.query(
        "update pass_purchases set status = 'withdrawn', access_ends_on = valid_from where id = $1",
        [withdrawn.orderId]
      );
      const access = () =>
        load(original.orderId, "open-space", buyer, during, { issue });
      expect(await access()).toMatchObject({
        state: "ended",
        renewalOrderId: original.orderId,
      });

      const replacement = await seedPass("open-space", false, renewal);
      expect(await access()).toMatchObject({ state: "available", day: 1 });
      const { rows } = await database.pool.query<{
        workspace_reservation_id: string;
      }>(
        "select workspace_reservation_id from reservation_access_grants where workspace_reservation_id = any($1::text[])",
        [[withdrawn.dayIds[0], replacement.dayIds[0]]]
      );
      expect(rows).toEqual([
        { workspace_reservation_id: replacement.dayIds[0] },
      ]);

      // An inconsistent duplicate with two live passes cannot select a code.
      await database.pool.query(
        "update pass_purchases set status = 'active', access_ends_on = null where id = $1",
        [withdrawn.orderId]
      );
      const reads: string[] = [];
      expect(
        await load(original.orderId, "open-space", buyer, during, {
          issue,
          reads,
        })
      ).toMatchObject({ state: "ended" });
      expect(reads).toEqual([]);
    });

    test("gates a gift to the claimed holder and never exposes a pass day as a reservation order", async () => {
      const {
        orderId,
        dayIds: [firstDayId],
      } = await seedPass("reserved-desk", true);
      const reads: string[] = [];
      const provider = { issue, reads };
      expect(
        await load(orderId, "reserved-desk", null, during, provider)
      ).toEqual({ state: "sign-in" });
      expect(
        await load(orderId, "reserved-desk", holder, during, provider)
      ).toEqual({ state: "not-found" });
      await database.pool.query(
        "update pass_purchases set gift_claimed_at = now() where id = $1",
        [orderId]
      );
      expect(
        await load(orderId, "reserved-desk", buyer, during, provider)
      ).toEqual({ state: "not-found" });
      expect(reads).toEqual([]);

      const ordinaryOrder = await Effect.runPromise(
        WorkspaceReservationRepository.pipe(
          Effect.flatMap((reservations) => reservations.findById(firstDayId)),
          Effect.provide(WorkspaceReservationRepository.Default),
          Effect.provide(database.layer)
        )
      );
      expect(ordinaryOrder).toBeNull();

      const lastMinute = nextMidnight.subtract({ minutes: 1 });
      expect(
        await load(orderId, "reserved-desk", holder, lastMinute, provider)
      ).toMatchObject({
        state: "available",
        day: 1,
        code: syntheticPin,
        endsAt: nextMidnight,
        deskLabel: "Desk 14",
      });
      expect(reads).toEqual([firstDay]);

      await database.pool.query(
        "update pass_purchases set status = 'withdrawn', access_ends_on = $2 where id = $1",
        [orderId, nextDay]
      );
      expect(
        await load(orderId, "reserved-desk", holder, lastMinute, provider)
      ).toMatchObject({ state: "available", continuesTomorrow: false });
      expect(
        await load(orderId, "reserved-desk", holder, nextMidnight, provider)
      ).toMatchObject({ state: "ended" });
    });

    test("opens for the named holder without a session and rejects replay after reassignment", async () => {
      const { orderId } = await seedPass("open-space");
      const accessCookie = await holderCookie(orderId, buyer);
      const reads: string[] = [];
      const provider = { issue, reads, accessCookie };

      expect(
        await load(orderId, "open-space", null, during, provider)
      ).toMatchObject({
        state: "available",
        code: syntheticPin,
        endsAt: openSpaceClosing,
      });
      await reassignToHolder(orderId);

      // Reopening the original email is still bound to its original holder.
      const reopenedCookie = await holderCookie(orderId, buyer);
      for (const cookie of [accessCookie, reopenedCookie]) {
        expect(
          await load(orderId, "open-space", null, during, {
            ...provider,
            accessCookie: cookie,
          })
        ).toEqual({ state: "not-found" });
      }
      expect(
        await load(orderId, "open-space", buyer, during, provider)
      ).toEqual({ state: "not-found" });
      expect(reads).toEqual([firstDay]);
      expect(
        await load(orderId, "open-space", holder, during, provider)
      ).toMatchObject({
        state: "available",
        code: syntheticPin,
      });
    });

    test("withholds the code if the pass changes holder during issuance", async () => {
      const { orderId } = await seedPass("open-space");
      const accessCookie = await holderCookie(orderId, buyer);
      const access = await load(orderId, "open-space", null, during, {
        accessCookie,
        issue: () =>
          Effect.promise(() => reassignToHolder(orderId)).pipe(
            Effect.andThen(issue())
          ),
      });
      expect(access).toEqual({ state: "not-found" });
    });

    test("withholds bearer access while the holder's login is unverified or awaiting deletion", async () => {
      const { orderId } = await seedPass("open-space");
      const accessCookie = await holderCookie(orderId, buyer);
      const reads: string[] = [];
      try {
        await database.pool.query(
          `update auth."user" set email_verified = false where id = $1`,
          [buyer]
        );
        expect(
          await load(orderId, "open-space", null, during, {
            issue,
            reads,
            accessCookie,
          })
        ).toEqual({ state: "not-found" });
        await database.pool.query(
          `update auth."user" set email_verified = true, deletion_requested_at = now() where id = $1`,
          [buyer]
        );
        expect(
          await load(orderId, "open-space", null, during, {
            issue,
            reads,
            accessCookie,
          })
        ).toEqual({ state: "not-found" });
        expect(reads).toEqual([]);
      } finally {
        await database.pool.query(
          `update auth."user" set email_verified = true, deletion_requested_at = null where id = $1`,
          [buyer]
        );
      }
    });

    test("only one request issues today's code and the next Prague date has a different grant", async () => {
      const { orderId, dayIds } = await seedPass("open-space");
      const started = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      let issued = 0;
      const provider = {
        issue: () =>
          Effect.promise(async () => {
            issued++;
            started.resolve();
            await release.promise;
          }).pipe(Effect.andThen(issue())),
      };
      expect(
        await load(
          orderId,
          "open-space",
          buyer,
          during.subtract({ hours: 24 }),
          provider
        )
      ).toMatchObject({ state: "before-start" });

      const issuing = load(orderId, "open-space", buyer, during, provider);
      await Promise.race([
        started.promise,
        issuing.then(() => {
          throw new Error("Request finished before issuance");
        }),
      ]);
      try {
        expect(
          await load(orderId, "open-space", buyer, during, provider)
        ).toMatchObject({ state: "retry" });
        expect(issued).toBe(1);
      } finally {
        release.resolve();
      }
      expect(await issuing).toMatchObject({
        state: "available",
        day: 1,
        code: syntheticPin,
        endsAt: openSpaceClosing,
      });
      expect(
        await load(
          orderId,
          "open-space",
          buyer,
          during.add({ hours: 1 }),
          provider
        )
      ).toMatchObject({ state: "available", code: syntheticPin });
      expect(
        await load(orderId, "open-space", buyer, openSpaceClosing, provider)
      ).toMatchObject({ state: "closed", continuesTomorrow: true });
      expect(issued).toBe(1);
      expect(
        await load(orderId, "open-space", buyer, nextMidnight, provider)
      ).toMatchObject({ state: "available", day: 2 });
      expect(issued).toBe(2);
      const { rows } = await database.pool.query(
        "select workspace_reservation_id from reservation_access_grants where workspace_reservation_id = any($1)",
        [dayIds]
      );
      expect(rows).toHaveLength(2);
    });

    test("withholds a code when issuance completes across the closing boundary", async () => {
      const { orderId } = await seedPass("open-space");
      const access = await load(
        orderId,
        "open-space",
        buyer,
        openSpaceClosing.subtract({ seconds: 1 }),
        {
          issue: () =>
            TestClock.setTime(openSpaceClosing.epochMilliseconds).pipe(
              Effect.andThen(issue())
            ),
        }
      );
      expect(access).toMatchObject({ state: "closed" });
      expect(access).not.toHaveProperty("code");
    });

    test("uses live reservation facts without requiring the provider's customer profile", async () => {
      const { orderId } = await seedPass("open-space");
      const reads: string[] = [];
      expect(
        await load(orderId, "open-space", buyer, during, { issue, reads })
      ).toMatchObject({
        state: "available",
        code: syntheticPin,
      });
      expect(reads).toEqual([firstDay]);
      const access = await load(orderId, "open-space", buyer, during, {
        issue,
        intervalEndsEarly: true,
      });
      expect(access.state).toBe("retry");
      expect(access).not.toHaveProperty("code");
    });

    test("shows closed when the venue read fails at the Open Space cutoff", async () => {
      const { orderId } = await seedPass("open-space");
      const access = await load(
        orderId,
        "open-space",
        buyer,
        openSpaceClosing.subtract({ seconds: 1 }),
        {
          issue: () => Effect.die("Unexpected issuance"),
          readReservation: () =>
            TestClock.setTime(openSpaceClosing.epochMilliseconds).pipe(
              Effect.andThen(
                new DotyposRejected({
                  operation: "getReservationWithoutCustomer",
                  request: "reservation.get",
                  reason: "not-found",
                  message: "Synthetic venue record missing",
                })
              )
            ),
        }
      );
      expect(access).toMatchObject({
        state: "closed",
        continuesTomorrow: true,
      });
      expect(access).not.toHaveProperty("code");
    });

    test("withholds a newly issued PIN if the holder's session ended during issuance", async () => {
      const { orderId } = await seedPass("open-space");
      let signedIn = true;
      const access = await load(orderId, "open-space", buyer, during, {
        isSignedIn: () => signedIn,
        issue: () =>
          Effect.sync(() => {
            signedIn = false;
          }).pipe(Effect.andThen(issue())),
      });
      expect(access).toEqual({ state: "not-found" });
    });
  }
);
