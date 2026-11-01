import { afterAll, describe, expect, test } from "bun:test";
import { DotyposCustomerIdSchema } from "@deskohub/dotypos";
import { EmailValueName } from "@deskohub/workspace-admin-api";
import { Effect, Layer } from "effect";
import { seedAutomatedCampaign, seedAutomatedSend, seedAutomationVersion, seedCampaignSend } from "@/features/email-campaigns/backend/email-campaigns.test-utils";
import { createWorkspacePostgresSuiteDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import { EmailPersistence } from "./email-persistence.service";
import { EmailRecipientPersistence } from "./email-recipient-persistence.service";

const database = await createWorkspacePostgresSuiteDatabase("email_foundation");
afterAll(async () => database?.close());

const discountName = EmailValueName.make("offer");
const draft = {
  purpose: "marketing",
  templateKey: "workspace",
  structure: [{ _tag: "Paragraph", id: "intro", textKey: "intro" }],
  translations: Object.fromEntries(["en-US", "cs-CZ"].map((locale) => [locale, {
    subject: [{ _tag: "Text", text: "Synthetic offer" }],
    preheader: [],
    texts: { intro: [{ _tag: "Value", name: discountName, field: ["code"] }] },
  }])),
  values: [{ name: discountName, source: { kind: "discount", discountId: "synthetic-discount", validDays: 7, maxUses: 1, maxUsesPerCustomer: 1 } }],
};
const parameters = { discountId: "synthetic-discount", expiresAt: "2027-01-10T12:00:00Z", maxUses: 1, maxUsesPerCustomer: 1 };
const snapshot = { _tag: "Resolved", value: { code: "SYNTHETIC-NEVER-REDEEM", expiresAt: parameters.expiresAt } };

describe.skipIf(!database)("reusable email persistence on disposable Postgres", () => {
  if (!database) return;
  const { db, pool } = database;
  const layer = Layer.mergeAll(EmailPersistence.Default, EmailRecipientPersistence.Default).pipe(Layer.provide(database.layer));
  const run = (effect) => Effect.runPromise(effect.pipe(Effect.provide(layer)));
  const publication = async () => run(Effect.gen(function* () {
    const emails = yield* EmailPersistence;
    const email = yield* emails.create({ title: "Synthetic email", draft });
    return yield* emails.publish(email.id);
  }));
  const recipient = () => DotyposCustomerIdSchema.make(`synthetic-${crypto.randomUUID()}`);
  const selected = async () => {
    const version = await publication();
    const customer = recipient();
    const { sendId } = await seedCampaignSend(db, { purpose: "marketing", recipients: [{ dotyposCustomerId: customer }] });
    return run(Effect.gen(function* () {
      const persistence = yield* EmailRecipientPersistence;
      yield* persistence.freezeOneOffVersion(sendId, version.id);
      return yield* persistence.select({ sendId, dotyposCustomerId: customer, emailVersionId: version.id, locale: "cs-CZ" });
    }));
  };

  test("saves incomplete drafts, validates publication, serializes versions, retains historical locales", async () => {
    const email = await run(Effect.flatMap(EmailPersistence, (service) => service.create({ title: "Incomplete", draft: {} })));
    expect(await run(Effect.flatMap(EmailPersistence, (service) => service.publish(email.id)).pipe(Effect.flip))).toMatchObject({ _tag: "EmailPublicationInvalid" });
    await run(Effect.flatMap(EmailPersistence, (service) => service.saveDraft({ emailId: email.id, draft })));
    const versions = await Promise.all(Array.from({ length: 4 }, () => run(Effect.flatMap(EmailPersistence, (service) => service.publish(email.id)))));
    expect(versions.map((version) => version.versionNumber).sort()).toEqual([1, 2, 3, 4]);
    const version = versions[0];
    await expect(pool.query("update email_versions set document = '{}' where id = $1", [version.id])).rejects.toThrow("immutable");
    await expect(pool.query("delete from email_versions where id = $1", [version.id])).rejects.toThrow("immutable");
    const historical = { ...draft, translations: { "retired-language": draft.translations["cs-CZ"] } };
    const inserted = await pool.query("insert into email_versions (email_id, version_number, document, required_value_names) values ($1, 5, $2, $3) returning id", [email.id, historical, [discountName]]);
    const read = await run(Effect.flatMap(EmailPersistence, (service) => service.getVersion(inserted.rows[0].id)));
    expect(read.document.translations["retired-language"]).toBeDefined();
  });

  test("freezes one-off sends and permits different automated recipients to select different versions", async () => {
    const first = await publication();
    const second = await run(Effect.flatMap(EmailPersistence, (service) => service.publish(first.emailId)));
    const customers = [recipient(), recipient()];
    const campaignId = await seedAutomatedCampaign(db, { purpose: "marketing" });
    const automationVersionId = await seedAutomationVersion(db, { campaignId, purpose: "marketing" });
    const sendId = await seedAutomatedSend(db, { campaignId, versionId: automationVersionId, purpose: "marketing", recipients: customers.map((dotyposCustomerId) => ({ dotyposCustomerId })) });
    const rows = await Promise.all([first, second].map((version, i) => run(Effect.flatMap(EmailRecipientPersistence, (service) => service.select({ sendId, dotyposCustomerId: customers[i], emailVersionId: version.id, locale: "cs-CZ" })))));
    expect(rows.map((row) => row.emailVersionId)).toEqual([first.id, second.id]);
    const retries = await Promise.all(Array.from({ length: 6 }, () => run(Effect.flatMap(EmailRecipientPersistence, (service) => service.select({ sendId, dotyposCustomerId: customers[0], emailVersionId: second.id, locale: "en-US" })))));
    expect(new Set(retries.map((row) => row.id)).size).toBe(1);
    expect(retries[0].emailVersionId).toBe(first.id);
    expect(retries[0].locale).toBe("cs-CZ");
    const oneOff = await selected();
    await expect(pool.query("update email_campaign_sends set frozen_email_version_id = $1 where id = $2", [second.id, oneOff.sendId])).rejects.toThrow("frozen");
    await expect(pool.query("update email_preparations set required_value_names = '{}' where id = $1", [oneOff.id])).rejects.toThrow("frozen");
    await expect(pool.query("update email_campaign_sends set frozen_email_version_id = $1 where id = $2", [first.id, sendId])).rejects.toThrow();
  });

  test("concurrent snapshots and issuances share identities; conflicting retries fail; ready requires the exact frozen set", async () => {
    const preparation = await selected();
    const input = { preparationId: preparation.id, valueName: discountName };
    await expect(run(Effect.flatMap(EmailRecipientPersistence, (service) => service.finish(preparation.id, "ready")))).rejects.toThrow();
    const ledger = await Promise.all(Array.from({ length: 6 }, () => run(Effect.flatMap(EmailRecipientPersistence, (service) => service.reserveIssuance({ ...input, parameters })))));
    expect(new Set(ledger.map((row) => row.recoveryIdentity)).size).toBe(1);
    expect(await run(Effect.flatMap(EmailRecipientPersistence, (service) => service.reserveIssuance({ ...input, parameters: { ...parameters, maxUses: 2 } })).pipe(Effect.flip))).toMatchObject({ reason: "issuance-conflict" });
    await Promise.all(Array.from({ length: 6 }, () => run(Effect.flatMap(EmailRecipientPersistence, (service) => service.saveSnapshot({ ...input, value: snapshot })))));
    expect((await pool.query("select * from email_value_snapshots where preparation_id = $1", [preparation.id])).rowCount).toBe(1);
    expect((await pool.query("select * from email_discount_issuances where preparation_id = $1", [preparation.id])).rowCount).toBe(1);
    expect(await run(Effect.flatMap(EmailRecipientPersistence, (service) => service.saveSnapshot({ ...input, value: { _tag: "Fallback", text: "changed" } })).pipe(Effect.flip))).toMatchObject({ reason: "snapshot-conflict" });
    await expect(pool.query("insert into email_value_snapshots (preparation_id, value_name, value) values ($1, 'unused', '{}')", [preparation.id])).rejects.toThrow("not required");
    await run(Effect.flatMap(EmailRecipientPersistence, (service) => service.finish(preparation.id, "ready")));
    await run(Effect.flatMap(EmailRecipientPersistence, (service) => service.saveSnapshot({ ...input, value: snapshot })));
    expect(await run(Effect.flatMap(EmailRecipientPersistence, (service) => service.readSnapshots(preparation.id)))).toEqual([{ valueName: discountName, value: snapshot }]);
    for (const statement of ["update email_value_snapshots set value = '{}' where preparation_id = $1", "delete from email_value_snapshots where preparation_id = $1", "update email_preparations set state = 'preparing' where id = $1"]) await expect(pool.query(statement, [preparation.id])).rejects.toThrow();
  });

  test("snapshot insert and ready serialize on the preparation row", async () => {
    const preparation = await selected();
    const connection = await pool.connect();
    try {
      await connection.query("begin");
      await connection.query("insert into email_value_snapshots (preparation_id, value_name, value) values ($1, $2, $3)", [preparation.id, discountName, JSON.stringify(snapshot)]);
      const sealing = pool.query("update email_preparations set state = 'ready' where id = $1 returning state", [preparation.id]);
      await connection.query("commit");
      expect((await sealing).rows[0].state).toBe("ready");
    } finally {
      await connection.query("rollback");
      connection.release();
    }
  });

  test("retains uncertain issuance and delivery, and permanently fences delivery before cleanup", async () => {
    const preparation = await selected();
    const input = { preparationId: preparation.id, valueName: discountName };
    await run(Effect.flatMap(EmailRecipientPersistence, (service) => service.reserveIssuance({ ...input, parameters })));
    await pool.query("update email_discount_issuances set state = 'issuing' where preparation_id = $1", [preparation.id]);
    await pool.query("update email_discount_issuances set state = 'issuance-uncertain' where preparation_id = $1", [preparation.id]);
    await run(Effect.flatMap(EmailRecipientPersistence, (service) => service.saveSnapshot({ ...input, value: snapshot })));
    await run(Effect.flatMap(EmailRecipientPersistence, (service) => service.finish(preparation.id, "ready")));
    await run(Effect.flatMap(EmailRecipientPersistence, (service) => service.recordDeliveryOutcome(preparation.id, "pending", "delivering")));
    await run(Effect.flatMap(EmailRecipientPersistence, (service) => service.recordDeliveryOutcome(preparation.id, "delivering", "uncertain")));
    await expect(pool.query("update email_discount_issuances set state = 'disabled' where preparation_id = $1", [preparation.id])).rejects.toThrow();
    await run(Effect.flatMap(EmailRecipientPersistence, (service) => service.recordDeliveryOutcome(preparation.id, "uncertain", "definitively-unsent")));
    await expect(pool.query("update email_discount_issuances set state = 'cleanup-required' where preparation_id = $1", [preparation.id])).rejects.toThrow();
    await pool.query("update email_discount_issuances set state = 'issued', code = $2, expires_at = $3 where preparation_id = $1", [preparation.id, "SYNTHETIC-NEVER-REDEEM", parameters.expiresAt]);
    await pool.query("update email_discount_issuances set state = 'cleanup-required' where preparation_id = $1", [preparation.id]);
    await expect(run(Effect.flatMap(EmailRecipientPersistence, (service) => service.recordDeliveryOutcome(preparation.id, "definitively-unsent", "delivering")))).rejects.toThrow();
    await pool.query("update email_discount_issuances set state = 'disabled' where preparation_id = $1", [preparation.id]);
    await expect(pool.query("delete from email_preparations where id = $1", [preparation.id])).rejects.toThrow();
    await expect(pool.query("update email_discount_issuances set parameters = '{}' where preparation_id = $1", [preparation.id])).rejects.toThrow("frozen");
  });
});
