import "server-only";

import type { DotyposCustomerId } from "@deskohub/dotypos";
import {
  type EmailPreparationId,
  type EmailValueName,
  EmailValueSnapshot,
  type EmailVersionId,
  emailValueSnapshotForDefinition,
} from "@deskohub/workspace-admin-api";
import { and, eq, inArray } from "drizzle-orm";
import { Context, Data, Effect, Layer, Schema } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import {
  emailCampaignRecipients,
  emailCampaignSends,
} from "@/db/schema/email-campaigns";
import {
  type EmailDeliveryOutcome,
  type EmailDiscountIssuanceRow,
  type EmailPreparationFailureReason,
  type EmailPreparationRow,
  type EmailPreparationSkipReason,
  type EmailPreparationUnavailableReason,
  emailDiscountIssuances,
  emailPreparations,
  emailValueSnapshots,
  emailVersions,
} from "@/db/schema/emails";
import type { DatabaseQueryError } from "@/db/sql-constraint";
import type { CampaignSendId } from "@/features/email-campaigns/campaign-identifiers";
import { canonicalJson } from "@/shared/utils/canonical-json";
import { currentInstant } from "@/shared/utils/temporal";

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

/** A terminal preparation state; skipped and failed outcomes carry their recorded reason. */
export type EmailPreparationOutcome =
  | { readonly state: "ready" }
  | {
      readonly state: "skipped";
      readonly reason: EmailPreparationSkipReason;
      readonly valueName?: EmailValueName;
    }
  | {
      readonly state: "failed";
      readonly reason: EmailPreparationFailureReason;
      readonly valueName?: EmailValueName;
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
  /**
   * Seals an open preparation with its outcome. A preparation another attempt
   * already sealed is returned unchanged, so callers read the winning outcome.
   * A skip or failure naming a value that another attempt has stored meanwhile
   * leaves the preparation open, so the caller resumes from that value.
   */
  readonly finish: (
    preparationId: EmailPreparationId,
    outcome: EmailPreparationOutcome
  ) => Effect.Effect<EmailPreparationRow, RecipientPersistenceFailure>;
  /** CAS plus the database transition guard fences cleanup from any later delivery. */
  /**
   * Records that a temporary failure outlasted an attempt's retries, on a
   * preparation that stays open for a later retry. A preparation another
   * attempt sealed meanwhile is returned unchanged.
   */
  readonly recordUnavailable: (
    preparationId: EmailPreparationId,
    unavailable: {
      readonly reason: EmailPreparationUnavailableReason;
      readonly valueName: EmailValueName;
    }
  ) => Effect.Effect<EmailPreparationRow, RecipientPersistenceFailure>;
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
                const preparation = yield* lockedPreparation(preparationId);
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
                const [version] = yield* db
                  .select({ document: emailVersions.document })
                  .from(emailVersions)
                  .where(eq(emailVersions.id, preparation.emailVersionId));
                const definition = version?.document.values.find(
                  (value) => value.name === valueName
                );
                if (!definition)
                  return yield* new EmailPreparationConflict({
                    preparationId,
                    reason: "invalid-snapshot",
                  });
                const validated = yield* Schema.decodeEffect(
                  emailValueSnapshotForDefinition(
                    definition,
                    preparation.locale
                  )
                )(value).pipe(
                  Effect.mapError(
                    () =>
                      new EmailPreparationConflict({
                        preparationId,
                        reason: "invalid-snapshot",
                      })
                  )
                );
                yield* db.insert(emailValueSnapshots).values({
                  preparationId,
                  valueName,
                  value: canonicalJson(validated),
                });
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
          outcome: EmailPreparationOutcome
        ) {
          return yield* transaction(
            Effect.gen(function* () {
              const current = yield* lockedPreparation(preparationId);
              if (current.state !== "selected" && current.state !== "preparing")
                return current;
              if (outcome.state !== "ready" && outcome.valueName) {
                // Snapshot inserts lock this row too, so this read sees any committed value.
                const [stored] = yield* db
                  .select({ valueName: emailValueSnapshots.valueName })
                  .from(emailValueSnapshots)
                  .where(
                    and(
                      eq(emailValueSnapshots.preparationId, preparationId),
                      eq(emailValueSnapshots.valueName, outcome.valueName)
                    )
                  );
                if (stored) return current;
              }
              const [sealed] = yield* db
                .update(emailPreparations)
                .set({
                  state: outcome.state,
                  outcomeReason:
                    outcome.state === "ready" ? null : outcome.reason,
                  outcomeValueName:
                    outcome.state === "ready"
                      ? null
                      : (outcome.valueName ?? null),
                })
                .where(eq(emailPreparations.id, preparationId))
                .returning();
              return sealed!;
            })
          );
        }),
        recordUnavailable: Effect.fn(
          "EmailRecipientPersistence.recordUnavailable"
        )(function* (
          preparationId: EmailPreparationId,
          unavailable: {
            readonly reason: EmailPreparationUnavailableReason;
            readonly valueName: EmailValueName;
          }
        ) {
          const [recorded] = yield* db
            .update(emailPreparations)
            .set({
              unavailableReason: unavailable.reason,
              unavailableValueName: unavailable.valueName,
              unavailableAt: yield* currentInstant,
            })
            .where(
              and(
                eq(emailPreparations.id, preparationId),
                inArray(emailPreparations.state, ["selected", "preparing"])
              )
            )
            .returning();
          if (recorded) return recorded;
          const [current] = yield* db
            .select()
            .from(emailPreparations)
            .where(eq(emailPreparations.id, preparationId));
          if (!current)
            return yield* new EmailPreparationConflict({
              preparationId,
              reason: "not-found",
            });
          return current;
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
