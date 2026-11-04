import { afterAll, describe, expect, test } from "bun:test";
import type { EmailDraft } from "@deskohub/workspace-admin-api";
import { ConfigProvider, Effect, Layer } from "effect";
import { createWorkspacePostgresSuiteDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import { EmailPersistence } from "./email-persistence.service";

const database =
  await createWorkspacePostgresSuiteDatabase("email_publication");
afterAll(async () => database?.close());

const cloud = "synthetic-cloud";
const uploaded = `https://res.cloudinary.com/${cloud}/image/upload/v1/email-campaigns/preview/synthetic.png`;
// In the account, but not an untransformed editor upload.
const transformed = `https://res.cloudinary.com/${cloud}/image/upload/w_200/gallery/synthetic.png`;
const foreign = "https://images.deskohub.test/synthetic.png";

const translation = {
  subject: [{ _tag: "Text", text: "Synthetic" }],
  preheader: [],
  texts: {
    intro: [{ _tag: "Value", name: "display_name" }],
    alt: [],
  },
} as const;
const withImage = (source: string): EmailDraft => ({
  purpose: "marketing",
  templateKey: "workspace",
  structure: [
    { _tag: "Paragraph", id: "intro", textKey: "intro" },
    { _tag: "Image", id: "photo", src: source, altKey: "alt" },
  ],
  translations: { "cs-CZ": translation, "en-US": translation },
  values: [
    // Unused and unfinished: publication drops it.
    { name: "later", source: { kind: "discount" } },
    {
      name: "display_name",
      source: {
        kind: "customer",
        path: ["profile", "customer", "displayName"],
      },
    },
    // Unused and complete: publication keeps it.
    {
      name: "visits",
      source: {
        kind: "customer",
        path: ["activity", "stats", "reservationCount"],
      },
    },
  ],
});

describe.skipIf(!database)("email publication on disposable Postgres", () => {
  if (!database) return;
  const { pool } = database;
  // Publication reads the image account when it runs, in the caller's context.
  const layer = Layer.mergeAll(
    EmailPersistence.Default.pipe(Layer.provide(database.layer)),
    ConfigProvider.layer(
      ConfigProvider.fromUnknown({ NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME: cloud })
    )
  );
  const run = <A, E>(effect: Effect.Effect<A, E, EmailPersistence>) =>
    Effect.runPromise(Effect.provide(effect, layer));
  const create = (draft: EmailDraft) =>
    run(
      Effect.flatMap(EmailPersistence, (emails) =>
        emails.create({ title: "Synthetic email", draft })
      )
    );
  const publish = (
    emailId: Parameters<EmailPersistence["Service"]["publish"]>[0]
  ) =>
    run(Effect.flatMap(EmailPersistence, (emails) => emails.publish(emailId)));
  const versionCount = async (emailId: string) =>
    (
      await pool.query(
        "select count(*)::int as count from email_versions where email_id = $1",
        [emailId]
      )
    ).rows[0].count;

  test("publishes an uploaded image and prunes only unused unfinished definitions", async () => {
    const email = await create(withImage(uploaded));
    const version = await publish(email.id);
    expect(version.document.values.map(({ name }) => name as string)).toEqual([
      "display_name",
      "visits",
    ]);
    expect(version.requiredValueNames as readonly string[]).toEqual([
      "display_name",
    ]);
  });

  test("refuses images that aren't editor uploads, even after saving them in a draft", async () => {
    for (const source of [transformed, foreign]) {
      const email = await create(withImage(source));
      await run(
        Effect.flatMap(EmailPersistence, (emails) =>
          emails.saveDraft({ emailId: email.id, draft: withImage(source) })
        )
      );
      const failure = await run(
        Effect.flip(
          Effect.flatMap(EmailPersistence, (emails) => emails.publish(email.id))
        )
      );
      expect(failure).toMatchObject({
        _tag: "EmailImageNotAllowed",
        componentId: "photo",
        source,
      });
      expect(await versionCount(email.id)).toBe(0);
    }
  });

  test("keeps an account image the previous publication showed, never a foreign one", async () => {
    for (const [source, accepted] of [
      [transformed, true],
      [foreign, false],
    ] as const) {
      const email = await create(withImage(source));
      // A migrated publication can show images uploaded before the editor's folder rule.
      await pool.query(
        "insert into email_versions (email_id, version_number, document, required_value_names) values ($1, 1, $2, $3)",
        [email.id, withImage(source), ["display_name"]]
      );
      const result = await run(
        Effect.result(
          Effect.flatMap(EmailPersistence, (emails) => emails.publish(email.id))
        )
      );
      expect(result._tag).toBe(accepted ? "Success" : "Failure");
      expect(await versionCount(email.id)).toBe(accepted ? 2 : 1);
    }
  });
});
