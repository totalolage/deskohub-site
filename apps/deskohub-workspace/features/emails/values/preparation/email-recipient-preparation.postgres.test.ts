import "@/shared/testing/workspace-test-env";

import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { DotyposCustomerIdSchema } from "@deskohub/dotypos";
import { testEmailAddress } from "@deskohub/test-email";
import {
  EmailValueName,
  emailCustomerFieldAtPath,
  emailCustomerFieldCatalogue,
} from "@deskohub/workspace-admin-api";
import { Effect, Layer } from "effect";
import { discountProductTargets, discounts } from "@/db/schema";
import { storedDiscountIdSchema } from "@/features/discounts/persistence-contracts";
import { seedCampaignSend } from "@/features/email-campaigns/backend/email-campaigns.test-utils";
import {
  EmailPersistence,
  EmailRecipientPersistence,
} from "@/features/emails/backend";
import { createWorkspacePostgresSuiteDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import {
  CustomerValueMissing,
  CustomerValueRejected,
  CustomerValueSource,
  CustomerValueUnavailable,
} from "../customer/customer-value-source.service";
import { CustomerValues } from "../customer/customer-values.service";
import { emailDiscountSampleCode } from "../discount/email-discount-value";
import { EmailDiscountValues } from "../discount/email-discount-values.service";
import { EmailRecipientPreparation } from "./email-recipient-preparation.service";
import { EmailPreparationRetry } from "./email-value-generation";
import { EmailValueSamples } from "./email-value-samples.service";
import { syntheticEmailCustomer } from "./synthetic-email-customer";

const database =
  await createWorkspacePostgresSuiteDatabase("email_preparation");
afterAll(async () => database?.close());

const contact = EmailValueName.make("contact");
const offer = EmailValueName.make("offer");
const spare = EmailValueName.make("spare");

/** Synthetic customer data per Dotypos customer, and how the fake source answers. */
type FakeCustomer = {
  email: string | null;
  mode: "ok" | "unavailable" | "rejected" | "gated" | "deleted";
  /** A gated read waits for this, then reports the customer as missing or unavailable. */
  gate?: Promise<void>;
  afterGate?: "missing" | "unavailable";
};

describe.skipIf(!database)(
  "recipient preparation on disposable Postgres",
  () => {
    if (!database) return;
    const { db, pool } = database;

    const customers = new Map<string, FakeCustomer>();
    const profileOf = (id: string, email: string | null) => ({
      customer: {
        id,
        displayName: "Synthetic Customer",
        email,
        phone: null,
        discountGroupId: null,
      },
      discountGroups: [],
      codes: [],
      claims: [],
      vouchers: [],
      voucherClaims: [],
    });
    const gated = (afterGate: "missing" | "unavailable") => {
      let release = () => {};
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      return { gate, afterGate, release };
    };
    const untilSourceCalls = async (count: number) => {
      while (sourceCalls < count) await Bun.sleep(5);
    };
    let resolverCalls = 0;
    let sourceCalls = 0;
    beforeEach(() => {
      resolverCalls = 0;
      sourceCalls = 0;
    });

    const source = Layer.succeed(CustomerValueSource, {
      profile: ({ customerId }) => {
        sourceCalls += 1;
        const customer = customers.get(customerId);
        if (customer?.mode === "gated")
          return Effect.promise(() => customer.gate).pipe(
            Effect.andThen(() =>
              customer.afterGate === "missing"
                ? Effect.succeed(profileOf(customerId, null))
                : Effect.fail(
                    new CustomerValueUnavailable({ source: "profile" })
                  )
            )
          );
        if (customer?.mode === "deleted")
          return Effect.fail(
            new CustomerValueMissing({ reason: "customer-not-found" })
          );
        if (customer?.mode === "unavailable")
          return Effect.fail(
            new CustomerValueUnavailable({ source: "profile" })
          );
        if (customer?.mode === "rejected")
          return Effect.fail(
            new CustomerValueRejected({ reason: "invalid-data" })
          );
        return Effect.succeed(profileOf(customerId, customer?.email ?? null));
      },
      activity: () => Effect.die("activity is not selected"),
    });
    /** Counts every live resolver call, including ones that fail validation before reading. */
    const countedCustomerValues = Layer.effect(
      CustomerValues,
      Effect.gen(function* () {
        const values = yield* CustomerValues;
        return {
          resolve: (input) => {
            resolverCalls += 1;
            return values.resolve(input);
          },
        };
      })
    ).pipe(Layer.provide(CustomerValues.Default.pipe(Layer.provide(source))));

    const persistence = Layer.mergeAll(
      EmailPersistence.Default,
      EmailRecipientPersistence.Default
    );
    const layer = Layer.mergeAll(
      EmailRecipientPreparation.Default.pipe(
        Layer.provide(
          Layer.mergeAll(EmailDiscountValues.Default, countedCustomerValues)
        )
      ),
      EmailDiscountValues.Default,
      EmailValueSamples.Default.pipe(Layer.provide(countedCustomerValues))
    ).pipe(Layer.provideMerge(persistence), Layer.provideMerge(database.layer));
    const run = (effect) =>
      Effect.runPromise(
        effect.pipe(
          Effect.provide(layer),
          Effect.provideService(EmailPreparationRetry, {
            retries: 2,
            baseDelay: 0,
          })
        )
      );

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

    /**
     * Contact (customer email) and offer (discount) referenced in both
     * languages, contact twice; spare is defined but never referenced.
     */
    const draftFor = (input: {
      readonly discountId: string;
      readonly order?: readonly ("contact" | "offer")[];
      readonly fallback?: Record<string, string>;
      readonly locales?: readonly string[];
    }) => ({
      purpose: "marketing",
      templateKey: "workspace",
      structure: [{ _tag: "Paragraph", id: "intro", textKey: "intro" }],
      translations: Object.fromEntries(
        (input.locales ?? ["en-US", "cs-CZ"]).map((locale) => [
          locale,
          {
            subject: [{ _tag: "Text", text: "Synthetic offer" }],
            preheader: [],
            texts: {
              intro: [
                { _tag: "Value", name: contact },
                { _tag: "Value", name: offer, field: ["code"] },
                { _tag: "Value", name: contact },
              ],
            },
          },
        ])
      ),
      values: [
        ...(input.order ?? ["contact", "offer"]).map((name) =>
          name === "contact"
            ? contactDefinition(input.fallback)
            : {
                name: offer,
                source: {
                  kind: "discount",
                  discountId: input.discountId,
                  validDays: 30,
                },
              }
        ),
        {
          name: spare,
          source: {
            kind: "discount",
            discountId: input.discountId,
            validDays: 7,
          },
        },
      ],
    });

    const contactDefinition = (fallback?: Record<string, string>) => {
      const source = {
        kind: "customer",
        path: ["profile", "customer", "email"],
      } as const;
      return fallback
        ? { name: contact, source, fallback }
        : { name: contact, source };
    };

    const publishEmail = (draft) =>
      run(
        Effect.gen(function* () {
          const emails = yield* EmailPersistence;
          const email = yield* emails.create({
            title: "Synthetic return offer",
            draft,
          });
          const version = yield* emails.publish(email.id);
          return { email, version };
        })
      );

    const republish = (emailId, draft) =>
      run(
        Effect.gen(function* () {
          const emails = yield* EmailPersistence;
          yield* emails.saveDraft({ emailId, draft });
          return yield* emails.publish(emailId);
        })
      );

    /** A fresh one-off send with one synthetic recipient, frozen to `version`. */
    const recipientFor = async (
      version,
      { locale = "cs-CZ", email = testEmailAddress("preparation") } = {}
    ) => {
      const dotyposCustomerId = DotyposCustomerIdSchema.make(
        `synthetic-${crypto.randomUUID()}`
      );
      customers.set(dotyposCustomerId, { email, mode: "ok" });
      const { sendId } = await seedCampaignSend(db, {
        purpose: "marketing",
        recipients: [{ dotyposCustomerId }],
      });
      await run(
        Effect.flatMap(EmailRecipientPersistence, (recipients) =>
          recipients.freezeOneOffVersion(sendId, version.id)
        )
      );
      return { sendId, dotyposCustomerId, emailVersionId: version.id, locale };
    };

    const prepare = (input) =>
      run(
        Effect.flatMap(EmailRecipientPreparation, (preparation) =>
          preparation.prepare(input)
        )
      );

    const codesFor = async (dotyposCustomerId: string) =>
      (
        await pool.query(
          `select p.code, p.valid_until
             from promotion_codes p
             join promotion_code_customers c on c.promotion_code_id = p.id
            where c.dotypos_customer_id = $1`,
          [dotyposCustomerId]
        )
      ).rows;

    const storedRows = async (preparationId: string) => ({
      snapshots: (
        await pool.query(
          "select value_name from email_value_snapshots where preparation_id = $1 order by value_name",
          [preparationId]
        )
      ).rows.map((row) => row.value_name),
      issuances: (
        await pool.query(
          "select value_name, state from email_discount_issuances where preparation_id = $1",
          [preparationId]
        )
      ).rows,
      preparation: (
        await pool.query(
          `select state, outcome_reason, outcome_value_name, unavailable_reason,
                  unavailable_value_name, unavailable_at is not null as unavailable_recorded
             from email_preparations where id = $1`,
          [preparationId]
        )
      ).rows[0],
    });

    const valuesOf = (prepared) => Object.fromEntries(prepared.values);

    test("concurrent attempts store one snapshot per referenced value and issue one code", async () => {
      const { version } = await publishEmail(
        draftFor({ discountId: await seedDiscount() })
      );
      const input = await recipientFor(version);
      const results = await Promise.all(
        Array.from({ length: 6 }, () => prepare(input))
      );
      expect(new Set(results.map((result) => result._tag))).toEqual(
        new Set(["Ready"])
      );
      const [first] = results;
      for (const result of results)
        expect(valuesOf(result)).toEqual(valuesOf(first));
      expect(valuesOf(first)[contact]).toEqual({
        _tag: "Resolved",
        value: customers.get(input.dotyposCustomerId)?.email,
      });
      const rows = await storedRows(first.preparation.id);
      expect(rows.snapshots).toEqual([contact, offer]);
      expect(rows.issuances).toEqual([{ value_name: offer, state: "issued" }]);
      const codes = await codesFor(input.dotyposCustomerId);
      expect(codes).toHaveLength(1);
      expect(valuesOf(first)[offer].value.code).toBe(codes[0].code);
    });

    test("retries replay the selected version, values, code and expiry after a new publication and customer edit", async () => {
      const discountId = await seedDiscount();
      const { email, version } = await publishEmail(draftFor({ discountId }));
      const input = await recipientFor(version);
      const original = await prepare(input);
      expect(original._tag).toBe("Ready");
      const callsBefore = resolverCalls;

      const newer = await republish(email.id, draftFor({ discountId }));
      customers.set(input.dotyposCustomerId, {
        email: testEmailAddress("edited"),
        mode: "ok",
      });
      const retried = await prepare({ ...input, emailVersionId: newer.id });

      expect(retried._tag).toBe("Ready");
      expect(retried.preparation.emailVersionId).toBe(version.id);
      expect(retried.version.id).toBe(version.id);
      expect(valuesOf(retried)).toEqual(valuesOf(original));
      expect(resolverCalls).toBe(callsBefore);
      expect(await codesFor(input.dotyposCustomerId)).toHaveLength(1);
    });

    test("a ready snapshot replays before any customer resolver call, even when the frozen selection is no longer compatible", async () => {
      const { version } = await publishEmail(
        draftFor({ discountId: await seedDiscount() })
      );
      const input = await recipientFor(version);
      const original = await prepare(input);
      expect(original._tag).toBe("Ready");
      const fresh = await recipientFor(version);

      const descriptor = emailCustomerFieldAtPath(
        emailCustomerFieldCatalogue,
        ["profile", "customer", "email"],
        { inheritPresence: false }
      );
      if (descriptor?.kind !== "scalar")
        throw new Error("Expected the customer email scalar descriptor");
      const originalType = descriptor.type;
      resolverCalls = 0;
      sourceCalls = 0;
      try {
        Object.assign(descriptor, { type: "number" });
        const replayed = await prepare(input);
        expect(replayed._tag).toBe("Ready");
        expect(valuesOf(replayed)).toEqual(valuesOf(original));
        expect(resolverCalls).toBe(0);
        expect(sourceCalls).toBe(0);

        // The same drift makes a live resolution of the frozen selection fail.
        const incompatible = await prepare(fresh);
        expect(incompatible).toMatchObject({
          _tag: "Failed",
          reason: "customer-rejected",
          valueName: contact,
        });
        expect(resolverCalls).toBe(1);
      } finally {
        Object.assign(descriptor, { type: originalType });
      }
    });

    test("required missing data skips with a recorded reason and replays without reading again", async () => {
      const { version } = await publishEmail(
        draftFor({ discountId: await seedDiscount() })
      );
      const input = await recipientFor(version, { email: null });
      const skipped = await prepare(input);
      expect(skipped).toMatchObject({
        _tag: "Skipped",
        reason: "missing-value",
        valueName: contact,
      });
      const rows = await storedRows(skipped.preparation.id);
      expect(rows.preparation).toMatchObject({
        state: "skipped",
        outcome_reason: "missing-value",
        outcome_value_name: contact,
      });
      // Contact precedes the offer, so nothing was issued.
      expect(rows.issuances).toEqual([]);
      const calls = resolverCalls;
      customers.set(input.dotyposCustomerId, {
        email: testEmailAddress("late"),
        mode: "ok",
      });
      expect(await prepare(input)).toMatchObject({
        _tag: "Skipped",
        reason: "missing-value",
      });
      expect(resolverCalls).toBe(calls);
    });

    test("missing data takes the recipient language's fallback, and only that language's", async () => {
      const { version } = await publishEmail(
        draftFor({
          discountId: await seedDiscount(),
          fallback: { "cs-CZ": "milý zákazníku" },
        })
      );
      const czech = await prepare(await recipientFor(version, { email: null }));
      expect(czech._tag).toBe("Ready");
      expect(valuesOf(czech)[contact]).toEqual({
        _tag: "Fallback",
        text: "milý zákazníku",
      });
      const english = await prepare(
        await recipientFor(version, { email: null, locale: "en-US" })
      );
      expect(english).toMatchObject({
        _tag: "Skipped",
        reason: "missing-value",
        valueName: contact,
      });
    });

    test("a deleted customer skips even when the language has a fallback", async () => {
      const { version } = await publishEmail(
        draftFor({
          discountId: await seedDiscount(),
          fallback: { "cs-CZ": "milý zákazníku" },
        })
      );
      const input = await recipientFor(version);
      customers.set(input.dotyposCustomerId, { email: null, mode: "deleted" });
      const skipped = await prepare(input);
      expect(skipped).toMatchObject({
        _tag: "Skipped",
        reason: "missing-customer",
        valueName: contact,
      });
      expect(await codesFor(input.dotyposCustomerId)).toEqual([]);
    });

    test("a language the version was never published in skips before any provider work", async () => {
      const { version } = await publishEmail(
        draftFor({ discountId: await seedDiscount() })
      );
      const input = await recipientFor(version, { locale: "de-DE" });
      const skipped = await prepare(input);
      expect(skipped).toMatchObject({
        _tag: "Skipped",
        reason: "missing-language",
        valueName: undefined,
      });
      expect(resolverCalls).toBe(0);
      expect((await storedRows(skipped.preparation.id)).issuances).toEqual([]);
    });

    test("unavailable customer data retries, stays open after exhaustion, and a later retry resumes with the issued code", async () => {
      const { version } = await publishEmail(
        draftFor({
          discountId: await seedDiscount(),
          order: ["offer", "contact"],
        })
      );
      const input = await recipientFor(version);
      customers.set(input.dotyposCustomerId, {
        email: testEmailAddress("outage"),
        mode: "unavailable",
      });
      const interrupted = await prepare(input);
      expect(interrupted).toMatchObject({
        _tag: "Unavailable",
        reason: "customer-unavailable",
        valueName: contact,
      });
      // One attempt plus two retries.
      expect(sourceCalls).toBe(3);
      const partial = await storedRows(interrupted.preparation.id);
      expect(partial.preparation).toEqual({
        state: "selected",
        outcome_reason: null,
        outcome_value_name: null,
        unavailable_reason: "customer-unavailable",
        unavailable_value_name: contact,
        unavailable_recorded: true,
      });
      expect(partial.snapshots).toEqual([offer]);
      const [code] = await codesFor(input.dotyposCustomerId);

      customers.set(input.dotyposCustomerId, {
        email: testEmailAddress("outage"),
        mode: "ok",
      });
      const resumed = await prepare(input);
      expect(resumed._tag).toBe("Ready");
      expect(valuesOf(resumed)[offer].value.code).toBe(code.code);
      expect(await codesFor(input.dotyposCustomerId)).toHaveLength(1);
    });

    test("rejected customer data fails with a recorded reason", async () => {
      const { version } = await publishEmail(
        draftFor({ discountId: await seedDiscount() })
      );
      const input = await recipientFor(version);
      customers.set(input.dotyposCustomerId, { email: null, mode: "rejected" });
      const failed = await prepare(input);
      expect(failed).toMatchObject({
        _tag: "Failed",
        reason: "customer-rejected",
        valueName: contact,
      });
      expect(sourceCalls).toBe(1);
      expect(
        (await storedRows(failed.preparation.id)).preparation
      ).toMatchObject({
        state: "failed",
        outcome_reason: "customer-rejected",
        outcome_value_name: contact,
      });
      expect(await prepare(input)).toMatchObject({ _tag: "Failed" });
      expect(sourceCalls).toBe(1);
    });

    test("temporary issuance failures retry, and exhaustion leaves the preparation open for a later retry", async () => {
      const discountId = await seedDiscount();
      const { version } = await publishEmail(draftFor({ discountId }));
      const flaky = await recipientFor(version);
      const outage = await recipientFor(version);
      await pool.query(`create sequence synthetic_issuance_failures`);
      await pool.query(`
        create function synthetic_failing_issuance() returns trigger language plpgsql as $$
        begin
          if nextval('synthetic_issuance_failures') <= 2 then
            raise exception 'synthetic issuance outage';
          end if;
          return new;
        end;
        $$`);
      await pool.query(
        "create trigger synthetic_failing_issuance before insert on promotion_codes for each row execute function synthetic_failing_issuance()"
      );
      try {
        // Two failures, then the third attempt issues.
        const recovered = await prepare(flaky);
        expect(recovered._tag).toBe("Ready");
        expect(await codesFor(flaky.dotyposCustomerId)).toHaveLength(1);

        await pool.query(
          "create or replace function synthetic_failing_issuance() returns trigger language plpgsql as $$ begin raise exception 'synthetic issuance outage'; end; $$"
        );
        const exhausted = await prepare(outage);
        expect(exhausted).toMatchObject({
          _tag: "Unavailable",
          reason: "issuance-unavailable",
          valueName: offer,
        });
        const rows = await storedRows(exhausted.preparation.id);
        expect(rows.preparation).toMatchObject({
          state: "selected",
          unavailable_reason: "issuance-unavailable",
          unavailable_value_name: offer,
          unavailable_recorded: true,
        });
        expect(rows.snapshots).toEqual([contact]);
        expect(await codesFor(outage.dotyposCustomerId)).toEqual([]);
      } finally {
        await pool.query(
          "drop trigger synthetic_failing_issuance on promotion_codes"
        );
        await pool.query("drop function synthetic_failing_issuance()");
        await pool.query("drop sequence synthetic_issuance_failures");
      }
      const resumed = await prepare(outage);
      expect(resumed._tag).toBe("Ready");
      expect(await codesFor(outage.dotyposCustomerId)).toHaveLength(1);
    });

    test("a crash between issuance and snapshot persistence recovers the same code and expiry", async () => {
      const { version } = await publishEmail(
        draftFor({
          discountId: await seedDiscount(),
          order: ["offer", "contact"],
        })
      );
      const input = await recipientFor(version);
      const preparation = await run(
        Effect.flatMap(EmailRecipientPersistence, (recipients) =>
          recipients.select(input)
        )
      );
      // The earlier attempt issued the code and crashed before storing its snapshot.
      const issued = await run(
        Effect.flatMap(EmailDiscountValues, (values) =>
          values.issue({ preparationId: preparation.id, valueName: offer })
        )
      );
      expect((await storedRows(preparation.id)).snapshots).toEqual([]);

      const prepared = await prepare(input);
      expect(prepared._tag).toBe("Ready");
      expect(valuesOf(prepared)[offer]).toEqual({
        _tag: "Resolved",
        value: { code: issued.code, expiresAt: issued.expiresAt },
      });
      expect(await codesFor(input.dotyposCustomerId)).toHaveLength(1);
    });

    test("a crash after values were stored resumes without generating them again", async () => {
      const { version } = await publishEmail(
        draftFor({ discountId: await seedDiscount() })
      );
      const input = await recipientFor(version);
      const preparation = await run(
        Effect.flatMap(EmailRecipientPersistence, (recipients) =>
          recipients.select(input)
        )
      );
      const stored = { _tag: "Resolved", value: testEmailAddress("stored") };
      await run(
        Effect.flatMap(EmailRecipientPersistence, (recipients) =>
          recipients.saveSnapshot({
            preparationId: preparation.id,
            valueName: contact,
            value: stored,
          })
        )
      );
      const prepared = await prepare(input);
      expect(prepared._tag).toBe("Ready");
      expect(valuesOf(prepared)[contact]).toEqual(stored);
      expect(resolverCalls).toBe(0);
    });

    test("a slow attempt that finds data missing resumes from the value another attempt stored", async () => {
      const { version } = await publishEmail(
        draftFor({ discountId: await seedDiscount() })
      );
      const input = await recipientFor(version);
      const email = customers.get(input.dotyposCustomerId)?.email ?? null;
      const { gate, afterGate, release } = gated("missing");
      customers.set(input.dotyposCustomerId, {
        email,
        mode: "gated",
        gate,
        afterGate,
      });
      const slow = prepare(input);
      await untilSourceCalls(1);
      const preparation = await run(
        Effect.flatMap(EmailRecipientPersistence, (recipients) =>
          recipients.select(input)
        )
      );
      const stored = { _tag: "Resolved", value: email };
      await run(
        Effect.flatMap(EmailRecipientPersistence, (recipients) =>
          recipients.saveSnapshot({
            preparationId: preparation.id,
            valueName: contact,
            value: stored,
          })
        )
      );
      release();
      const prepared = await slow;
      expect(prepared._tag).toBe("Ready");
      expect(valuesOf(prepared)[contact]).toEqual(stored);
      expect((await storedRows(preparation.id)).preparation.state).toBe(
        "ready"
      );
      expect(await codesFor(input.dotyposCustomerId)).toHaveLength(1);
    });

    test("an attempt interrupted after another attempt sealed reports the sealed result", async () => {
      const { version } = await publishEmail(
        draftFor({ discountId: await seedDiscount() })
      );
      const input = await recipientFor(version);
      const email = customers.get(input.dotyposCustomerId)?.email ?? null;
      const { gate, afterGate, release } = gated("unavailable");
      customers.set(input.dotyposCustomerId, {
        email,
        mode: "gated",
        gate,
        afterGate,
      });
      const slow = prepare(input);
      await untilSourceCalls(1);
      customers.set(input.dotyposCustomerId, { email, mode: "ok" });
      const winner = await prepare(input);
      expect(winner._tag).toBe("Ready");
      customers.set(input.dotyposCustomerId, { email, mode: "unavailable" });
      release();
      const interrupted = await slow;
      expect(interrupted._tag).toBe("Ready");
      expect(valuesOf(interrupted)).toEqual(valuesOf(winner));
    });

    test("a lost sealing race returns the winning outcome, and recorded outcomes stay frozen", async () => {
      const { version } = await publishEmail(
        draftFor({ discountId: await seedDiscount() })
      );
      const input = await recipientFor(version);
      const preparation = await run(
        Effect.flatMap(EmailRecipientPersistence, (recipients) =>
          recipients.select(input)
        )
      );
      const outcomes = await Promise.all([
        run(
          Effect.flatMap(EmailRecipientPersistence, (recipients) =>
            recipients.finish(preparation.id, {
              state: "skipped",
              reason: "missing-value",
              valueName: contact,
            })
          )
        ),
        run(
          Effect.flatMap(EmailRecipientPersistence, (recipients) =>
            recipients.finish(preparation.id, {
              state: "failed",
              reason: "customer-rejected",
              valueName: contact,
            })
          )
        ),
      ]);
      expect(outcomes[0]).toEqual(outcomes[1]);
      const winner = outcomes[0];
      expect(await prepare(input)).toMatchObject({
        _tag: winner.state === "skipped" ? "Skipped" : "Failed",
        reason: winner.outcomeReason,
      });
      expect(resolverCalls).toBe(0);
      await expect(
        pool.query(
          "update email_preparations set outcome_reason = 'missing-language' where id = $1",
          [preparation.id]
        )
      ).rejects.toThrow();
      const openInput = await recipientFor(version);
      const open = await run(
        Effect.flatMap(EmailRecipientPersistence, (recipients) =>
          recipients.select(openInput)
        )
      );
      await expect(
        pool.query(
          "update email_preparations set state = 'skipped' where id = $1",
          [open.id]
        )
      ).rejects.toThrow("email_preparations_outcome_check");
      await expect(
        pool.query(
          "update email_preparations set state = 'failed', outcome_reason = 'missing-value' where id = $1",
          [open.id]
        )
      ).rejects.toThrow("email_preparations_outcome_check");
      for (const partial of [
        "unavailable_value_name = 'contact', unavailable_at = now()",
        "unavailable_reason = 'customer-unavailable', unavailable_at = now()",
        "unavailable_reason = 'customer-unavailable', unavailable_value_name = 'contact'",
        "unavailable_reason = 'missing-value', unavailable_value_name = 'contact', unavailable_at = now()",
      ])
        await expect(
          pool.query(`update email_preparations set ${partial} where id = $1`, [
            open.id,
          ])
        ).rejects.toThrow("email_preparations_unavailable_check");
      // A sealed preparation keeps its outcome and records no later exhaustion.
      const sealed = await run(
        Effect.flatMap(EmailRecipientPersistence, (recipients) =>
          recipients.recordUnavailable(preparation.id, {
            reason: "customer-unavailable",
            valueName: contact,
          })
        )
      );
      expect(sealed).toMatchObject({
        state: winner.state,
        unavailableReason: null,
      });
    });

    test("samples generate preview values without storing, issuing or reading a real customer", async () => {
      const { version } = await publishEmail(
        draftFor({ discountId: await seedDiscount() })
      );
      const count = async () =>
        (
          await pool.query(
            `select (select count(*) from promotion_codes) as codes,
                    (select count(*) from email_preparations) as preparations,
                    (select count(*) from email_value_snapshots) as snapshots,
                    (select count(*) from email_discount_issuances) as issuances`
          )
        ).rows[0];
      const before = await count();
      const sample = await run(
        Effect.flatMap(EmailValueSamples, (samples) =>
          samples.sample({
            document: version.document,
            locale: "cs-CZ",
            recipient: { _tag: "Synthetic" },
          })
        )
      );
      expect(sample).toMatchObject({ _tag: "Ready" });
      expect([...sample.values.keys()]).toEqual([contact, offer]);
      expect(sample.values.get(contact)).toEqual({
        _tag: "Resolved",
        value: syntheticEmailCustomer.profile?.customer.email,
      });
      expect(sample.values.get(offer).value.code).toBe(emailDiscountSampleCode);
      expect(sourceCalls).toBe(0);
      expect(await count()).toEqual(before);

      const missingLanguage = await run(
        Effect.flatMap(EmailValueSamples, (samples) =>
          samples.sample({
            document: version.document,
            locale: "de-DE",
            recipient: { _tag: "Synthetic" },
          })
        )
      );
      expect(missingLanguage).toMatchObject({
        _tag: "Skipped",
        reason: "missing-language",
      });
    });
  }
);
