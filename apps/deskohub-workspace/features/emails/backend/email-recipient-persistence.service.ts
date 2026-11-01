import "server-only";

import type { DotyposCustomerId } from "@deskohub/dotypos";
import {
  type EmailPreparationId,
  type EmailValueName,
  EmailValueSnapshot,
  type EmailVersionId,
} from "@deskohub/workspace-admin-api";
import { and, eq } from "drizzle-orm";
import { Context, Data, Effect, Layer, Schema } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import {
  emailCampaignRecipients,
  emailCampaignSends,
} from "@/db/schema/email-campaigns";
import {
  type EmailDeliveryOutcome,
  type EmailDiscountIssuanceRow,
  type EmailPreparationRow,
  emailDiscountIssuances,
  emailPreparations,
  emailValueSnapshots,
} from "@/db/schema/emails";
import type { DatabaseQueryError } from "@/db/sql-constraint";
import type { CampaignSendId } from "@/features/email-campaigns/campaign-identifiers";
import { canonicalJson } from "@/shared/utils/canonical-json";

export class EmailPreparationConflict extends Data.TaggedError(
  "EmailPreparationConflict"
)<{
  readonly preparationId: EmailPreparationId;
  readonly reason:
    | "not-found"
    | "snapshot-conflict"
    | "issuance-conflict"
    | "invalid-snapshot"
    | "delivery-conflict";
}> {}

type RecipientPersistenceFailure =
  | DatabaseQueryError
  | EmailPreparationConflict;
type Selection = {
  readonly sendId: CampaignSendId;
  readonly dotyposCustomerId: DotyposCustomerId;
  readonly emailVersionId: EmailVersionId;
  readonly locale: string;
};
type NamedValue = {
  readonly preparationId: EmailPreparationId;
  readonly valueName: EmailValueName;
};

/** Fully resolved parameters, including absolute expiry, persisted before provider work. */
export type EmailIssuanceParameters = {
  readonly discountId: string;
  readonly expiresAt: string;
  readonly maxUses: number;
  readonly maxUsesPerCustomer: number;
};

export interface IEmailRecipientPersistence {
  readonly freezeOneOffVersion: (
    sendId: CampaignSendId,
    versionId: EmailVersionId
  ) => Effect.Effect<EmailVersionId | undefined, DatabaseQueryError>;
  /** The first selection wins; retries return it even if a newer version was requested. */
  readonly select: (
    input: Selection
  ) => Effect.Effect<EmailPreparationRow, RecipientPersistenceFailure>;
  readonly saveSnapshot: (
    input: NamedValue & { readonly value: EmailValueSnapshot }
  ) => Effect.Effect<void, RecipientPersistenceFailure>;
  readonly readSnapshots: (preparationId: EmailPreparationId) => Effect.Effect<
    readonly {
      readonly valueName: EmailValueName;
      readonly value: EmailValueSnapshot;
    }[],
    RecipientPersistenceFailure
  >;
  readonly finish: (
    preparationId: EmailPreparationId,
    state: "ready" | "skipped" | "failed"
  ) => Effect.Effect<EmailPreparationRow, RecipientPersistenceFailure>;
  /** CAS plus the database transition guard fences cleanup from any later delivery. */
  readonly recordDeliveryOutcome: (
    preparationId: EmailPreparationId,
    expected: EmailDeliveryOutcome,
    outcome: EmailDeliveryOutcome
  ) => Effect.Effect<EmailPreparationRow, RecipientPersistenceFailure>;
  /** Reserves identity only; provider ownership/recovery must be claimed before a provider call. */
  readonly reserveIssuance: (
    input: NamedValue & { readonly parameters: EmailIssuanceParameters }
  ) => Effect.Effect<EmailDiscountIssuanceRow, RecipientPersistenceFailure>;
}

export class EmailRecipientPersistence extends Context.Service<
  EmailRecipientPersistence,
  IEmailRecipientPersistence
>()("@deskohub-workspace/emails/EmailRecipientPersistence") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const { db, transaction } = yield* WorkspaceDatabase;
      const lockedPreparation = Effect.fn(
        "EmailRecipientPersistence.lockedPreparation"
      )(function* (preparationId: EmailPreparationId) {
        const [row] = yield* db
          .select()
          .from(emailPreparations)
          .where(eq(emailPreparations.id, preparationId))
          .for("update");
        if (!row)
          return yield* new EmailPreparationConflict({
            preparationId,
            reason: "not-found",
          });
        return row;
      });
      return {
        freezeOneOffVersion: Effect.fn(
          "EmailRecipientPersistence.freezeOneOffVersion"
        )(function* (sendId: CampaignSendId, versionId: EmailVersionId) {
          const [send] = yield* db
            .update(emailCampaignSends)
            .set({ frozenEmailVersionId: versionId })
            .where(eq(emailCampaignSends.id, sendId))
            .returning();
          return send?.frozenEmailVersionId ?? undefined;
        }),
        select: Effect.fn("EmailRecipientPersistence.select")(function* (
          input: Selection
        ) {
          return yield* transaction(
            Effect.gen(function* () {
              // Match delivery's lock order: send, then recipient, then preparation.
              yield* db
                .select({ id: emailCampaignSends.id })
                .from(emailCampaignSends)
                .where(eq(emailCampaignSends.id, input.sendId))
                .for("share");
              yield* db
                .select({ sendId: emailCampaignRecipients.sendId })
                .from(emailCampaignRecipients)
                .where(
                  and(
                    eq(emailCampaignRecipients.sendId, input.sendId),
                    eq(
                      emailCampaignRecipients.dotyposCustomerId,
                      input.dotyposCustomerId
                    )
                  )
                )
                .for("update");
              const [existing] = yield* db
                .select()
                .from(emailPreparations)
                .where(
                  and(
                    eq(emailPreparations.sendId, input.sendId),
                    eq(
                      emailPreparations.dotyposCustomerId,
                      input.dotyposCustomerId
                    )
                  )
                );
              if (existing) return existing;
              yield* db.insert(emailPreparations).values(input);
              const [row] = yield* db
                .select()
                .from(emailPreparations)
                .where(
                  and(
                    eq(emailPreparations.sendId, input.sendId),
                    eq(
                      emailPreparations.dotyposCustomerId,
                      input.dotyposCustomerId
                    )
                  )
                );
              return row!;
            })
          );
        }),
        saveSnapshot: Effect.fn("EmailRecipientPersistence.saveSnapshot")(
          function* ({
            preparationId,
            valueName,
            value,
          }: NamedValue & { readonly value: EmailValueSnapshot }) {
            return yield* transaction(
              Effect.gen(function* () {
                yield* lockedPreparation(preparationId);
                const [existing] = yield* db
                  .select()
                  .from(emailValueSnapshots)
                  .where(
                    and(
                      eq(emailValueSnapshots.preparationId, preparationId),
                      eq(emailValueSnapshots.valueName, valueName)
                    )
                  );
                const encoded = canonicalJson(value);
                if (existing) {
                  if (existing.value !== encoded)
                    return yield* new EmailPreparationConflict({
                      preparationId,
                      reason: "snapshot-conflict",
                    });
                  return;
                }
                yield* db
                  .insert(emailValueSnapshots)
                  .values({ preparationId, valueName, value: encoded });
              })
            );
          }
        ),
        readSnapshots: Effect.fn("EmailRecipientPersistence.readSnapshots")(
          function* (preparationId: EmailPreparationId) {
            const rows = yield* db
              .select()
              .from(emailValueSnapshots)
              .where(eq(emailValueSnapshots.preparationId, preparationId));
            return yield* Effect.forEach(rows, (row) =>
              Schema.decodeUnknownEffect(
                Schema.fromJsonString(EmailValueSnapshot)
              )(row.value).pipe(
                Effect.map((value) => ({ valueName: row.valueName, value })),
                Effect.mapError(
                  () =>
                    new EmailPreparationConflict({
                      preparationId,
                      reason: "invalid-snapshot",
                    })
                )
              )
            );
          }
        ),
        finish: Effect.fn("EmailRecipientPersistence.finish")(function* (
          preparationId: EmailPreparationId,
          state: "ready" | "skipped" | "failed"
        ) {
          const [row] = yield* db
            .update(emailPreparations)
            .set({ state })
            .where(eq(emailPreparations.id, preparationId))
            .returning();
          if (!row)
            return yield* new EmailPreparationConflict({
              preparationId,
              reason: "not-found",
            });
          return row;
        }),
        recordDeliveryOutcome: Effect.fn(
          "EmailRecipientPersistence.recordDeliveryOutcome"
        )(function* (
          preparationId: EmailPreparationId,
          expected: EmailDeliveryOutcome,
          outcome: EmailDeliveryOutcome
        ) {
          const [row] = yield* db
            .update(emailPreparations)
            .set({ deliveryOutcome: outcome })
            .where(
              and(
                eq(emailPreparations.id, preparationId),
                eq(emailPreparations.deliveryOutcome, expected)
              )
            )
            .returning();
          if (!row)
            return yield* new EmailPreparationConflict({
              preparationId,
              reason: "delivery-conflict",
            });
          return row;
        }),
        reserveIssuance: Effect.fn("EmailRecipientPersistence.reserveIssuance")(
          function* ({
            preparationId,
            valueName,
            parameters,
          }: NamedValue & { readonly parameters: EmailIssuanceParameters }) {
            return yield* transaction(
              Effect.gen(function* () {
                yield* lockedPreparation(preparationId);
                const [existing] = yield* db
                  .select()
                  .from(emailDiscountIssuances)
                  .where(
                    and(
                      eq(emailDiscountIssuances.preparationId, preparationId),
                      eq(emailDiscountIssuances.valueName, valueName)
                    )
                  );
                const encoded = canonicalJson(parameters);
                if (existing) {
                  if (existing.parameters !== encoded)
                    return yield* new EmailPreparationConflict({
                      preparationId,
                      reason: "issuance-conflict",
                    });
                  return existing;
                }
                const [row] = yield* db
                  .insert(emailDiscountIssuances)
                  .values({
                    preparationId,
                    valueName,
                    recoveryIdentity: `email:${preparationId}:${valueName}`,
                    parameters: encoded,
                  })
                  .returning();
                return row!;
              })
            );
          }
        ),
      };
    })
  );
}
