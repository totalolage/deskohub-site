import "@/shared/testing/workspace-test-env";

import { afterAll, describe, expect, test } from "bun:test";
import {
  type DotyposCustomerId,
  DotyposCustomerIdSchema,
} from "@deskohub/dotypos";
import { NexiOrderIdSchema } from "@deskohub/nexi";
import { EmailValueName } from "@deskohub/workspace-admin-api";
import { Effect, Layer, Option } from "effect";
import { TestClock } from "effect/testing";
import { WorkspaceDatabase } from "@/db/database.service";
import {
  discountApplications,
  discountCodeRedemptions,
  discountProductTargets,
  discounts,
  paymentAttempts,
} from "@/db/schema";
import { paymentAttemptIdSchema } from "@/features/checkout/checkout-identifiers";
import {
  canonicalPromotionCodeSchema,
  DiscountService,
  discountIdSchema,
  normalizeSubmittedPromotionCode,
} from "@/features/discounts";
import { CalendarDiscountProviderMock } from "@/features/discounts/calendar-discount-provider.service.mock";
import { discountQuoteCodec } from "@/features/discounts/contracts";
import { CustomerDiscountProviderMock } from "@/features/discounts/customer-discount-provider.service.mock";
import { insertDiscountCode } from "@/features/discounts/discount-code-issuance";
import { DiscountDefinitionRepository } from "@/features/discounts/discount-definition.repository";
import { DiscountReleaseGateServiceMock } from "@/features/discounts/discount-release-gate.service.mock";
import { storedDiscountIdSchema } from "@/features/discounts/persistence-contracts";
import { PromotionCodeRepository } from "@/features/discounts/promotion-code.repository";
import { PromotionCodeProvider } from "@/features/discounts/promotion-code-provider.service";
import { seedCampaignSend } from "@/features/email-campaigns/backend/email-campaigns.test-utils";
import {
  EmailPersistence,
  EmailRecipientPersistence,
} from "@/features/emails/backend";
import { ReferralServiceMock } from "@/features/referrals/referral.service.mock";
import { workspaceFixtures } from "@/shared/testing/workspace-fixtures.test-utils";
import { createWorkspacePostgresSuiteDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import {
  EmailDiscountValues,
  emailDiscountSampleCode,
  sampleEmailDiscountValue,
} from "./index";

const database = await createWorkspacePostgresSuiteDatabase("email_discounts");
afterAll(async () => database?.close());

const offer = EmailValueName.make("offer");
const money = (value: number) => ({ value, exponent: 2, currency: "CZK" });
const cowork = { kind: "cowork", tier: "basic" } as const;
const meetingRoom = {
  kind: "meeting-room",
  duration: { unit: "day", amount: 1 },
} as const;

describe.skipIf(!database)(
  "email discount values on disposable Postgres",
  () => {
    if (!database) return;
    const { db, pool } = database;
    const layer = EmailDiscountValues.Default.pipe(
      Layer.provideMerge(
        Layer.mergeAll(
          EmailPersistence.Default,
          EmailRecipientPersistence.Default
        )
      ),
      Layer.provideMerge(database.layer)
    );
    const run = (effect) =>
      Effect.runPromise(effect.pipe(Effect.provide(layer)));
    const issue = (preparationId, valueName = offer) =>
      run(
        Effect.flatMap(EmailDiscountValues, (values) =>
          values.issue({ preparationId, valueName })
        )
      );

    const issueFailure = (preparationId, valueName = offer) =>
      run(
        Effect.flatMap(EmailDiscountValues, (values) =>
          values.issue({ preparationId, valueName })
        ).pipe(Effect.flip)
      );

    /** A cowork-only 30 % discount with complete labels. */
    const seedDiscount = async () => {
      const discountId = storedDiscountIdSchema.make(crypto.randomUUID());
      await Effect.runPromise(
        db.insert(discounts).values({
          id: discountId,
          labels: { "cs-CZ": "Návratová sleva", "en-US": "Return offer" },
          percentageBasisPoints: 3000,
        })
      );
      await Effect.runPromise(
        db
          .insert(discountProductTargets)
          .values({ discountId, productTarget: { kind: "cowork" } })
      );
      return discountId;
    };

    const draftFor = (discountId: string, validDays = 30) => ({
      purpose: "marketing",
      templateKey: "workspace",
      structure: [{ _tag: "Paragraph", id: "intro", textKey: "intro" }],
      translations: Object.fromEntries(
        ["en-US", "cs-CZ"].map((locale) => [
          locale,
          {
            subject: [{ _tag: "Text", text: "Synthetic offer" }],
            preheader: [],
            texts: {
              intro: [
                { _tag: "Value", name: offer, field: ["code"] },
                { _tag: "Value", name: offer, field: ["expiresAt"] },
              ],
            },
          },
        ])
      ),
      values: [
        { name: offer, source: { kind: "discount", discountId, validDays } },
      ],
    });

    const publish = (discountId: string, validDays?: number) =>
      run(
        Effect.gen(function* () {
          const emails = yield* EmailPersistence;
          const email = yield* emails.create({
            title: "Synthetic return offer",
            draft: draftFor(discountId, validDays),
          });
          return yield* emails.publish(email.id);
        })
      );

    const customer = () =>
      DotyposCustomerIdSchema.make(`synthetic-${crypto.randomUUID()}`);

    /** One logical recipient delivery of `version` in a fresh campaign send. */
    const prepare = async (version, dotyposCustomerId = customer()) => {
      const { sendId } = await seedCampaignSend(db, {
        purpose: "marketing",
        recipients: [{ dotyposCustomerId }],
      });
      const preparation = await run(
        Effect.gen(function* () {
          const recipients = yield* EmailRecipientPersistence;
          yield* recipients.freezeOneOffVersion(sendId, version.id);
          return yield* recipients.select({
            sendId,
            dotyposCustomerId,
            emailVersionId: version.id,
            locale: "cs-CZ",
          });
        })
      );
      return { preparationId: preparation.id, dotyposCustomerId };
    };

    const codesFor = async (dotyposCustomerId: DotyposCustomerId) =>
      (
        await pool.query(
          `select p.code, p.enabled, p.valid_from, p.valid_until, d.max_uses, d.max_uses_per_customer, d.discount_id
           from promotion_codes p
           join promotion_code_customers c on c.promotion_code_id = p.id
           join discount_codes d on d.promotion_code_id = p.id
          where c.dotypos_customer_id = $1`,
          [dotyposCustomerId]
        )
      ).rows;

    const issuanceRow = async (preparationId: string) =>
      (
        await pool.query(
          "select state, code, expires_at from email_discount_issuances where preparation_id = $1",
          [preparationId]
        )
      ).rows;

    const recordOutcome = (preparationId, expected, outcome) =>
      run(
        Effect.flatMap(EmailRecipientPersistence, (recipients) =>
          recipients.recordDeliveryOutcome(preparationId, expected, outcome)
        )
      );

    /** Saves the issued value and seals the preparation, as preparation does before delivery. */
    const seal = (preparationId, value) =>
      run(
        Effect.gen(function* () {
          const recipients = yield* EmailRecipientPersistence;
          yield* recipients.saveSnapshot({
            preparationId,
            valueName: offer,
            value: { _tag: "Resolved", value },
          });
          return yield* recipients.finish(preparationId, { state: "ready" });
        })
      );

    const disableUnsent = (preparationId) =>
      run(
        Effect.flatMap(EmailDiscountValues, (values) =>
          values.disableUnsent(preparationId)
        )
      );

    test("concurrent issuance under one identity creates exactly one restricted, single-use code", async () => {
      const discountId = await seedDiscount();
      const version = await publish(discountId);
      const { preparationId, dotyposCustomerId } = await prepare(version);

      const issued = await Promise.all(
        Array.from({ length: 6 }, () => issue(preparationId))
      );

      expect(new Set(issued.map((value) => value.code)).size).toBe(1);
      expect(new Set(issued.map((value) => value.expiresAt)).size).toBe(1);
      const [value] = issued;
      const codes = await codesFor(dotyposCustomerId);
      expect(codes).toHaveLength(1);
      expect(codes[0]).toMatchObject({
        code: value.code,
        enabled: true,
        valid_from: null,
        max_uses: 1,
        max_uses_per_customer: 1,
        discount_id: discountId,
      });
      const [{ matches }] = (
        await pool.query(
          "select valid_until = $2::timestamptz as matches from promotion_codes where code = $1",
          [value.code, value.expiresAt]
        )
      ).rows;
      expect(matches).toBe(true);
      expect(await issuanceRow(preparationId)).toMatchObject([
        { state: "issued", code: value.code },
      ]);
      const [{ count }] = (
        await pool.query(
          "select count(*)::int as count from promotion_code_customers where promotion_code_id = (select id from promotion_codes where code = $1)",
          [value.code]
        )
      ).rows;
      expect(count).toBe(1);
    });

    test("expiry is the configured days after issuance and replays unchanged", async () => {
      const discountId = await seedDiscount();
      const version = await publish(discountId, 30);
      const { preparationId } = await prepare(version);
      const issuedAt = Temporal.Instant.from("2026-11-01T09:15:00.123Z");

      const first = await run(
        Effect.gen(function* () {
          yield* TestClock.setTime(issuedAt.epochMilliseconds);
          return yield* (yield* EmailDiscountValues).issue({
            preparationId,
            valueName: offer,
          });
        }).pipe(Effect.provide(TestClock.layer()))
      );
      expect(first.expiresAt).toBe("2026-12-01T09:15:00.123Z");
      expect(await issue(preparationId)).toEqual(first);
      expect(
        await run(
          Effect.flatMap(EmailDiscountValues, (values) =>
            values.recover({ preparationId, valueName: offer })
          )
        )
      ).toEqual(Option.some(first));
    });

    test("separate recipient deliveries sharing one email, and separate campaigns, get distinct codes", async () => {
      const discountId = await seedDiscount();
      const version = await publish(discountId);
      const sameCustomer = customer();
      const firstCampaign = await prepare(version, sameCustomer);
      const secondCampaign = await prepare(version, sameCustomer);
      const otherRecipient = await prepare(version);

      const codes = [
        (await issue(firstCampaign.preparationId)).code,
        (await issue(secondCampaign.preparationId)).code,
        (await issue(otherRecipient.preparationId)).code,
      ];

      expect(new Set(codes).size).toBe(3);
      expect(await codesFor(sameCustomer)).toHaveLength(2);
      expect(await codesFor(otherRecipient.dotyposCustomerId)).toHaveLength(1);
    });

    test("a crash before the ledger records the code leaves nothing; a crash after it recovers the original code", async () => {
      const discountId = await seedDiscount();
      const version = await publish(discountId);
      const { preparationId, dotyposCustomerId } = await prepare(version);

      // Fails the statement that records the created code, after the code rows exist.
      const trigger = `crash_${crypto.randomUUID().replaceAll("-", "")}`;
      await pool.query(`
      create function ${trigger}() returns trigger language plpgsql as $$
      begin
        if NEW.preparation_id = '${preparationId}' and NEW.state = 'issued' then
          raise exception 'injected crash after code creation';
        end if;
        return NEW;
      end $$;
      create trigger ${trigger} before update on email_discount_issuances
        for each row execute function ${trigger}();
    `);
      try {
        await expect(issue(preparationId)).rejects.toThrow();
      } finally {
        await pool.query(
          `drop trigger ${trigger} on email_discount_issuances; drop function ${trigger}();`
        );
      }
      expect(await codesFor(dotyposCustomerId)).toHaveLength(0);
      expect(await issuanceRow(preparationId)).toHaveLength(0);

      const issued = await issue(preparationId);
      // The preparation owner crashes before saving the snapshot; its retry recovers.
      const retried = await issue(preparationId);

      expect(retried).toEqual(issued);
      expect(await codesFor(dotyposCustomerId)).toEqual([
        expect.objectContaining({ code: issued.code, enabled: true }),
      ]);
      await run(
        Effect.flatMap(EmailRecipientPersistence, (recipients) =>
          recipients.saveSnapshot({
            preparationId,
            valueName: offer,
            value: { _tag: "Resolved", value: retried },
          })
        )
      );
    });

    test("definitive no-send disables the code idempotently; uncertain delivery keeps it active", async () => {
      const discountId = await seedDiscount();
      const version = await publish(discountId);
      const unsent = await prepare(version);
      const uncertain = await prepare(version);
      const unsentCode = (await issue(unsent.preparationId)).code;
      const uncertainValue = await issue(uncertain.preparationId);
      const uncertainCode = uncertainValue.code;
      await seal(uncertain.preparationId, uncertainValue);

      expect(await disableUnsent(unsent.preparationId)).toEqual({
        _tag: "Kept",
        deliveryOutcome: "pending",
      });
      await recordOutcome(
        unsent.preparationId,
        "pending",
        "definitively-unsent"
      );
      await recordOutcome(uncertain.preparationId, "pending", "delivering");
      await recordOutcome(uncertain.preparationId, "delivering", "uncertain");

      const cleanup = { _tag: "Disabled", disabled: [offer], uncertain: [] };
      expect(await disableUnsent(unsent.preparationId)).toEqual(cleanup);
      expect(await disableUnsent(unsent.preparationId)).toEqual(cleanup);
      expect(await disableUnsent(uncertain.preparationId)).toEqual({
        _tag: "Kept",
        deliveryOutcome: "uncertain",
      });

      expect(await codesFor(unsent.dotyposCustomerId)).toEqual([
        expect.objectContaining({ code: unsentCode, enabled: false }),
      ]);
      const [mirror] = (
        await pool.query("select enabled from discount_codes where code = $1", [
          unsentCode,
        ])
      ).rows;
      expect(mirror.enabled).toBe(false);
      expect(await issuanceRow(unsent.preparationId)).toMatchObject([
        { state: "disabled", code: unsentCode },
      ]);
      expect(await codesFor(uncertain.dotyposCustomerId)).toEqual([
        expect.objectContaining({ code: uncertainCode, enabled: true }),
      ]);
      expect(await issueFailure(unsent.preparationId)).toMatchObject({
        _tag: "EmailDiscountValueUnavailable",
        reason: "disabled",
      });
    });

    test("an unissued reservation is closed without a code on definitive no-send", async () => {
      const discountId = await seedDiscount();
      const version = await publish(discountId);
      const { preparationId, dotyposCustomerId } = await prepare(version);
      await run(
        Effect.flatMap(EmailRecipientPersistence, (recipients) =>
          recipients.reserveIssuance({
            preparationId,
            valueName: offer,
            parameters: {
              discountId,
              expiresAt: "2026-12-01T00:00:00Z",
              maxUses: 1,
              maxUsesPerCustomer: 1,
            },
          })
        )
      );
      await recordOutcome(preparationId, "pending", "definitively-unsent");

      expect(await disableUnsent(preparationId)).toEqual({
        _tag: "Disabled",
        disabled: [offer],
        uncertain: [],
      });
      expect(await issuanceRow(preparationId)).toMatchObject([
        { state: "disabled", code: null },
      ]);
      expect(await codesFor(dotyposCustomerId)).toHaveLength(0);
    });

    test("an issuance left mid-way by another writer refuses a second code and stays uncertain on cleanup", async () => {
      const discountId = await seedDiscount();
      const version = await publish(discountId);
      const { preparationId, dotyposCustomerId } = await prepare(version);
      await run(
        Effect.flatMap(EmailRecipientPersistence, (recipients) =>
          recipients.reserveIssuance({
            preparationId,
            valueName: offer,
            parameters: {
              discountId,
              expiresAt: "2026-12-01T00:00:00Z",
              maxUses: 1,
              maxUsesPerCustomer: 1,
            },
          })
        )
      );
      await pool.query(
        "update email_discount_issuances set state = 'issuing' where preparation_id = $1",
        [preparationId]
      );

      expect(await issueFailure(preparationId)).toMatchObject({
        _tag: "EmailDiscountValueUnavailable",
        reason: "issuance-uncertain",
      });
      expect(await codesFor(dotyposCustomerId)).toHaveLength(0);
      await recordOutcome(preparationId, "pending", "definitively-unsent");
      expect(await disableUnsent(preparationId)).toEqual({
        _tag: "Disabled",
        disabled: [],
        uncertain: [offer],
      });
      expect(await issuanceRow(preparationId)).toMatchObject([
        { state: "issuing" },
      ]);
    });

    test("refuses issuance once delivery ended or for a value the email does not require", async () => {
      const discountId = await seedDiscount();
      const version = await publish(discountId);
      const started = await prepare(version);
      await recordOutcome(
        started.preparationId,
        "pending",
        "definitively-unsent"
      );

      expect(await issueFailure(started.preparationId)).toMatchObject({
        _tag: "EmailDiscountValueUnavailable",
        reason: "delivery-started",
      });
      const fresh = await prepare(version);
      expect(
        await issueFailure(fresh.preparationId, EmailValueName.make("missing"))
      ).toMatchObject({
        _tag: "EmailDiscountValueUnavailable",
        reason: "not-required",
      });
      expect(await codesFor(started.dotyposCustomerId)).toHaveLength(0);
      expect(await codesFor(fresh.dotyposCustomerId)).toHaveLength(0);
    });

    test("samples are clearly marked, unredeemable, and touch no storage", async () => {
      const counts = async () =>
        (
          await pool.query(
            "select (select count(*) from promotion_codes)::int as codes, (select count(*) from email_discount_issuances)::int as issuances"
          )
        ).rows[0];
      const before = await counts();

      const sample = sampleEmailDiscountValue(
        { validDays: 30 },
        Temporal.Instant.from("2026-11-01T10:00:00Z")
      );

      expect(sample).toEqual({
        code: emailDiscountSampleCode,
        expiresAt: "2026-12-01T10:00:00Z",
      });
      expect(
        await Effect.runPromise(
          normalizeSubmittedPromotionCode({ submittedCode: sample.code }).pipe(
            Effect.flip
          )
        )
      ).toMatchObject({ reason: "invalid_syntax" });
      await expect(
        pool.query(
          "insert into promotion_codes (kind, code, enabled) values ('discount', $1, true)",
          [sample.code]
        )
      ).rejects.toThrow();
      expect(await counts()).toEqual(before);
    });

    describe("through the checkout discount application boundary", () => {
      const discountLayer = DiscountService.Default.pipe(
        Layer.provide(
          Layer.mergeAll(
            CalendarDiscountProviderMock(),
            CustomerDiscountProviderMock(),
            PromotionCodeProvider.Default.pipe(
              Layer.provide(
                Layer.mergeAll(
                  PromotionCodeRepository.Default,
                  DiscountDefinitionRepository.Default
                ).pipe(Layer.provide(database.layer))
              )
            ),
            DiscountReleaseGateServiceMock({
              evaluate: () =>
                Effect.succeed({
                  calendarSales: true,
                  customerDiscounts: true,
                  discountCodes: true,
                }),
            }),
            ReferralServiceMock()
          )
        )
      );
      const calendarSale = {
        discount: {
          id: discountIdSchema.make("calendar-sale"),
          label: "Calendar sale",
          adjustment: { kind: "percentage", basisPoints: 1000 },
        },
        subtotalBefore: money(10_000),
        amount: money(1000),
        subtotalAfter: money(9000),
      } as const;
      const baseQuote = (product, withSale = false) =>
        discountQuoteCodec.make({
          product,
          discountableSubtotal: money(10_000),
          discounts: withSale ? [calendarSale] : [],
          totalDiscount: money(withSale ? 1000 : 0),
          discountedSubtotal: money(withSale ? 9000 : 10_000),
        });
      const apply = (input: {
        readonly code: string;
        readonly dotyposCustomerId: DotyposCustomerId;
        readonly product?: typeof cowork | typeof meetingRoom;
        readonly withSale?: boolean;
        readonly at?: Temporal.Instant;
      }) =>
        Effect.runPromise(
          Effect.gen(function* () {
            if (input.at) yield* TestClock.setTime(input.at.epochMilliseconds);
            return yield* (yield* DiscountService).applyDiscountCode({
              baseQuote: baseQuote(input.product ?? cowork, input.withSale),
              dotyposCustomerId: input.dotyposCustomerId,
              locale: "en-US",
              submittedCode: canonicalPromotionCodeSchema.make(input.code),
            });
          }).pipe(
            Effect.result,
            Effect.provide(discountLayer),
            input.at ? Effect.provide(TestClock.layer()) : (effect) => effect
          )
        );

      /** Seeds a redeemed claim of the code by its customer. */
      const redeem = async (
        code: string,
        dotyposCustomerId: DotyposCustomerId
      ) => {
        const id = crypto.randomUUID();
        const paymentAttemptId = paymentAttemptIdSchema.make(
          `email-offer-${id}`
        );
        const { id: workspaceReservationId } = await Effect.runPromise(
          workspaceFixtures(db).reservation({
            stage: { reservation: "draft", payment: "pending" },
            customer: dotyposCustomerId,
          })
        );
        await Effect.runPromise(
          db.insert(paymentAttempts).values({
            id: paymentAttemptId,
            workspaceReservationId,
            provider: "nexi",
            providerOrderId: NexiOrderIdSchema.make(`order-${id}`),
            state: "pending",
            amountValue: 7000,
            amountExponent: 2,
            currency: "CZK",
          })
        );
        const [application] = await Effect.runPromise(
          db
            .insert(discountApplications)
            .values({
              paymentAttemptId,
              workspaceReservationId,
              sequence: 0,
              publicDiscountId: discountIdSchema.make(`email-offer-${id}`),
              label: "Return offer",
              adjustment: { kind: "percentage", basisPoints: 3000 },
              productIdentity: { kind: "cowork" },
              subtotalBeforeValue: 10_000,
              subtotalBeforeExponent: 2,
              subtotalBeforeCurrency: "CZK",
              appliedAmountValue: 3000,
              appliedAmountExponent: 2,
              appliedAmountCurrency: "CZK",
              subtotalAfterValue: 7000,
              subtotalAfterExponent: 2,
              subtotalAfterCurrency: "CZK",
              provenance: { source: "promotion-code" },
            })
            .returning({ id: discountApplications.id })
        );
        const [{ id: codeId }] = (
          await pool.query("select id from discount_codes where code = $1", [
            code,
          ])
        ).rows;
        const now = Temporal.Now.instant();
        await Effect.runPromise(
          db.insert(discountCodeRedemptions).values({
            codeId,
            dotyposCustomerId,
            applicationId: application.id,
            paymentAttemptId,
            state: "redeemed",
            reservationExpiresAt: now.add({ hours: 1 }),
            redeemedAt: now,
          })
        );
      };

      test("applies once, only for its customer, on eligible cowork products, before expiry", async () => {
        const discountId = await seedDiscount();
        const version = await publish(discountId);
        const { preparationId, dotyposCustomerId } = await prepare(version);
        const { code, expiresAt } = await issue(preparationId);

        const applied = await apply({ code, dotyposCustomerId });
        expect(applied._tag).toBe("Success");
        expect(applied.success.application.amount).toEqual(money(3000));

        expect(
          await apply({ code, dotyposCustomerId: customer() })
        ).toMatchObject({
          failure: { reason: "customer_ineligible" },
        });
        expect(
          await apply({ code, dotyposCustomerId, product: meetingRoom })
        ).toMatchObject({ failure: { reason: "product_ineligible" } });
        const expiry = Temporal.Instant.from(expiresAt);
        expect(
          (
            await apply({
              code,
              dotyposCustomerId,
              at: expiry.subtract({ milliseconds: 1 }),
            })
          )._tag
        ).toBe("Success");
        expect(
          await apply({ code, dotyposCustomerId, at: expiry })
        ).toMatchObject({ failure: { reason: "expired" } });

        await redeem(code, dotyposCustomerId);
        expect(await apply({ code, dotyposCustomerId })).toMatchObject({
          failure: { reason: "usage_limit_reached" },
        });
      });

      test("combines with other discounts exactly like an equivalent ordinary customer code", async () => {
        const discountId = await seedDiscount();
        const version = await publish(discountId);
        const { preparationId, dotyposCustomerId } = await prepare(version);
        const issued = await issue(preparationId);
        const ordinary = await Effect.runPromise(
          Effect.flatMap(WorkspaceDatabase, ({ transaction }) =>
            transaction(
              insertDiscountCode({
                code: canonicalPromotionCodeSchema.make(
                  `ORD-${crypto.randomUUID().slice(0, 8).toUpperCase()}`
                ),
                discountId,
                enabled: true,
                validFrom: null,
                validUntil: Temporal.Instant.from(issued.expiresAt),
                maxUses: 1,
                maxUsesPerCustomer: 1,
                audience: [dotyposCustomerId],
              })
            )
          ).pipe(Effect.provide(database.layer))
        );

        const viaEmail = await apply({
          code: issued.code,
          dotyposCustomerId,
          withSale: true,
        });
        const viaOrdinary = await apply({
          code: ordinary.code,
          dotyposCustomerId,
          withSale: true,
        });

        expect(viaEmail._tag).toBe("Success");
        expect(viaEmail.success.quote.discounts.map((d) => d.amount)).toEqual(
          viaOrdinary.success.quote.discounts.map((d) => d.amount)
        );
        expect(viaEmail.success.quote.discountedSubtotal).toEqual(
          viaOrdinary.success.quote.discountedSubtotal
        );
        expect(viaEmail.success.quote.discounts[0].discount.id).toBe(
          "calendar-sale"
        );
        const [{ count }] = (
          await pool.query(
            "select count(*)::int as count from discount_codes where discount_id = $1",
            [discountId]
          )
        ).rows;
        expect(count).toBe(2);
      });
    });
  }
);
