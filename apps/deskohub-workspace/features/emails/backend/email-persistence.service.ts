import "server-only";

import {
  EmailDocument,
  EmailDocumentForPublication,
  type EmailDraft,
  type EmailId,
  type EmailVersionId,
  requiredEmailValueNames,
} from "@deskohub/workspace-admin-api";
import { desc, eq } from "drizzle-orm";
import { Context, Data, Effect, Layer, Schema } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import {
  type EmailRow,
  type EmailVersionRow,
  emails,
  emailVersions,
} from "@/db/schema/emails";
import type { DatabaseQueryError } from "@/db/sql-constraint";
import { campaignImageCloudName } from "@/features/email-campaigns/body/campaign-image-account";
import {
  disallowedEmailImages,
  type EmailImageNotAllowed,
  emailImages,
} from "@/features/emails/body/email-image-policy";
import { currentInstant } from "@/shared/utils/temporal";

export class EmailNotFound extends Data.TaggedError("EmailNotFound")<{
  readonly emailId: EmailId;
}> {}
export class EmailVersionInvalid extends Data.TaggedError(
  "EmailVersionInvalid"
)<{ readonly versionId: EmailVersionId }> {}
export class EmailPublicationInvalid extends Data.TaggedError(
  "EmailPublicationInvalid"
)<{ readonly emailId: EmailId }> {}

type EmailPersistenceFailure = DatabaseQueryError | EmailNotFound;

export interface IEmailPersistence {
  readonly create: (input: {
    readonly title: string;
    readonly draft: EmailDraft;
  }) => Effect.Effect<EmailRow, DatabaseQueryError>;
  readonly saveDraft: (input: {
    readonly emailId: EmailId;
    readonly draft: EmailDraft;
  }) => Effect.Effect<EmailRow, EmailPersistenceFailure>;
  readonly publish: (
    emailId: EmailId
  ) => Effect.Effect<
    EmailVersionRow,
    EmailPersistenceFailure | EmailPublicationInvalid | EmailImageNotAllowed
  >;
  readonly getVersion: (
    versionId: EmailVersionId
  ) => Effect.Effect<
    EmailVersionRow | undefined,
    DatabaseQueryError | EmailVersionInvalid
  >;
  readonly latestVersion: (
    emailId: EmailId
  ) => Effect.Effect<
    EmailVersionRow | undefined,
    DatabaseQueryError | EmailVersionInvalid
  >;
}

/** Draft edits remain independent of immutable publications, including on archived emails. */
export class EmailPersistence extends Context.Service<
  EmailPersistence,
  IEmailPersistence
>()("@deskohub-workspace/emails/EmailPersistence") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const { db, transaction } = yield* WorkspaceDatabase;
      return {
        create: Effect.fn("EmailPersistence.create")(function* (input: {
          readonly title: string;
          readonly draft: EmailDraft;
        }) {
          const [row] = yield* db.insert(emails).values(input).returning();
          return row!;
        }),
        saveDraft: Effect.fn("EmailPersistence.saveDraft")(function* ({
          emailId,
          draft,
        }: {
          readonly emailId: EmailId;
          readonly draft: EmailDraft;
        }) {
          const [row] = yield* db
            .update(emails)
            .set({ draft, updatedAt: yield* currentInstant })
            .where(eq(emails.id, emailId))
            .returning();
          if (!row) return yield* new EmailNotFound({ emailId });
          return row;
        }),
        publish: Effect.fn("EmailPersistence.publish")(function* (
          emailId: EmailId
        ) {
          return yield* transaction(
            Effect.gen(function* () {
              // Serializes publication numbers and draft edits against this publication.
              const [email] = yield* db
                .select()
                .from(emails)
                .where(eq(emails.id, emailId))
                .for("update");
              if (!email) return yield* new EmailNotFound({ emailId });
              const document = yield* Schema.decodeUnknownEffect(
                EmailDocumentForPublication
              )(email.draft).pipe(
                Effect.mapError(() => new EmailPublicationInvalid({ emailId }))
              );
              const [latest] = yield* db
                .select({
                  number: emailVersions.versionNumber,
                  document: emailVersions.document,
                })
                .from(emailVersions)
                .where(eq(emailVersions.emailId, emailId))
                .orderBy(desc(emailVersions.versionNumber))
                .limit(1);
              // Only the previous publication vouches for an image; drafts never do.
              const [disallowed] = disallowedEmailImages(
                document,
                yield* campaignImageCloudName,
                new Set(
                  latest
                    ? emailImages(latest.document).map(({ source }) => source)
                    : []
                )
              );
              if (disallowed) return yield* disallowed;
              const publication: typeof emailVersions.$inferInsert = {
                emailId,
                versionNumber: (latest?.number ?? 0) + 1,
                document,
                requiredValueNames: [...requiredEmailValueNames(document)],
              };
              const [version] = yield* db
                .insert(emailVersions)
                .values(publication)
                .returning();
              return version!;
            })
          );
        }),
        // Historical reads deliberately do not apply today's publication rules.
        getVersion: Effect.fn("EmailPersistence.getVersion")(function* (
          versionId: EmailVersionId
        ) {
          const [version] = yield* db
            .select()
            .from(emailVersions)
            .where(eq(emailVersions.id, versionId));
          if (!version) return undefined;
          const document = yield* Schema.decodeEffect(EmailDocument)(
            version.document
          ).pipe(
            Effect.mapError(
              () => new EmailVersionInvalid({ versionId: version.id })
            )
          );
          return { ...version, document };
        }),
        latestVersion: Effect.fn("EmailPersistence.latestVersion")(function* (
          emailId: EmailId
        ) {
          const [version] = yield* db
            .select()
            .from(emailVersions)
            .where(eq(emailVersions.emailId, emailId))
            .orderBy(desc(emailVersions.versionNumber))
            .limit(1);
          if (!version) return undefined;
          const document = yield* Schema.decodeEffect(EmailDocument)(
            version.document
          ).pipe(
            Effect.mapError(
              () => new EmailVersionInvalid({ versionId: version.id })
            )
          );
          return { ...version, document };
        }),
      };
    })
  );
}
