import "server-only";

import { createHmac } from "node:crypto";
import { NodeCrypto } from "@effect/platform-node";
import { and, eq, isNull } from "drizzle-orm";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import {
  Context,
  Crypto,
  Effect,
  Layer,
  Match,
  type PlatformError,
} from "effect";
import type { SqlError } from "effect/unstable/sql";
import { WorkspaceDatabase } from "@/db/database.service";
import {
  type CampaignRow,
  emailCampaignConfirmationCodes,
  emailCampaignRecipients,
  emailCampaignSends,
  emailCampaigns,
} from "@/db/schema";
import "@/shared/polyfills/temporal";
import type { DotyposCustomerId } from "@deskohub/dotypos";
import type { Locale } from "@/features/i18n";
import { currentInstant } from "@/shared/utils/temporal";
import type { AudienceFilter } from "../audience-filter";
import {
  type CampaignContentHash,
  hashCampaignContent,
} from "../body/campaign-content-hash";
import {
  type CampaignAudienceId,
  type CampaignConfirmationCode,
  type CampaignId,
  type CampaignSendId,
  campaignConfirmationCodeSchema,
} from "../campaign-identifiers";
import { isOnceCampaign } from "../campaign-states";
import {
  CampaignConfirmationRejected,
  type CampaignConfirmationRejection,
  CampaignDeliveryMismatch,
  CampaignNotFound,
  CampaignReadOnly,
} from "../errors";
import { loadCampaignSigningKeys } from "./campaign-signing-keys";

const campaignConfirmationCodeLifetime = Temporal.Duration.from({
  hours: 24,
});

/** Unambiguous uppercase letters and digits; 256 is a multiple of its length. */
const codeAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const codeLength = 8;

/** Failed confirmations a code survives; the last one supersedes it. */
const maxFailedConfirmationAttempts = 5;

/** Accepts the code as typed: any case, spaces, or a separating hyphen. */
const normalizeCampaignConfirmationCode = (typed: string) =>
  typed.toUpperCase().replaceAll(/[\s-]/g, "");

/**
 * Keys the code hashes with a secret outside the database: a 40-bit code
 * under a plain or salted hash falls to an offline search, while online
 * guessing is capped by the attempt limit.
 */
const loadCodeHashKey = loadCampaignSigningKeys("confirmation-code").pipe(
  Effect.map(([signing]) => signing)
);

type IssuedCampaignConfirmationCode = {
  readonly code: CampaignConfirmationCode;
  readonly expiresAt: Temporal.Instant;
};

/** The recipients and audience snapshot a confirmed send freezes. */
export type CampaignSendFreeze = {
  readonly audienceId: CampaignAudienceId | null;
  readonly audienceFilter: AudienceFilter;
  readonly recipients: readonly {
    readonly dotyposCustomerId: DotyposCustomerId;
    readonly locale: Locale;
  }[];
};

type ConfirmedCampaignSend = {
  readonly campaign: CampaignRow;
  readonly sendId: CampaignSendId;
};

type CampaignDraftError =
  | CampaignNotFound
  | CampaignReadOnly
  | CampaignDeliveryMismatch
  | EffectDrizzleQueryError
  | SqlError.SqlError;

type CampaignConfirmationCodeRow =
  typeof emailCampaignConfirmationCodes.$inferSelect;

/**
 * What a typed code does to the campaign's current code. `NoCurrentCode`
 * leaves no live code to count an attempt against.
 */
type ConfirmationVerdict =
  | { readonly _tag: "Confirm" }
  | {
      readonly _tag: "Reject";
      readonly reason: CampaignConfirmationRejection;
    }
  | {
      readonly _tag: "FailAttempt";
      readonly current: CampaignConfirmationCodeRow;
    }
  | { readonly _tag: "NoCurrentCode" };

const judgeConfirmation = ({
  current,
  codeHash,
  contentHash,
  now,
}: {
  readonly current: CampaignConfirmationCodeRow | undefined;
  readonly codeHash: string;
  readonly contentHash: CampaignContentHash;
  readonly now: Temporal.Instant;
}): ConfirmationVerdict => {
  if (current === undefined) return { _tag: "NoCurrentCode" };
  if (Temporal.Instant.compare(current.expiresAt, now) <= 0) {
    return current.codeHash === codeHash
      ? { _tag: "Reject", reason: "expired" }
      : { _tag: "NoCurrentCode" };
  }
  if (current.codeHash !== codeHash) return { _tag: "FailAttempt", current };
  if (current.contentHash !== contentHash) {
    return { _tag: "Reject", reason: "content-changed" };
  }
  return { _tag: "Confirm" };
};

const staleCodeRejection = (
  row: CampaignConfirmationCodeRow | undefined
): CampaignConfirmationRejection => {
  if (row === undefined) return "unknown-code";
  return row.failedAttempts >= maxFailedConfirmationAttempts
    ? "too-many-attempts"
    : "superseded";
};

export interface ICampaignConfirmationCodeService {
  /**
   * Issues the code a test send delivers, bound to the hash of the content
   * that test send rendered. It supersedes the campaign's earlier codes.
   */
  readonly issue: (input: {
    readonly campaignId: CampaignId;
    readonly contentHash: CampaignContentHash;
  }) => Effect.Effect<
    IssuedCampaignConfirmationCode,
    CampaignDraftError | PlatformError.PlatformError
  >;
  /**
   * Consumes the typed code, moves the campaign from Draft to Sending, and
   * freezes `send` into the campaign's send record, all in one transaction.
   * The code must be the campaign's current unexpired code and match the
   * content the campaign has under the same row lock that content edits wait
   * on. A wrong code counts as a failed attempt against the current one.
   */
  readonly confirm: (input: {
    readonly campaignId: CampaignId;
    readonly code: string;
    readonly send: CampaignSendFreeze;
  }) => Effect.Effect<
    ConfirmedCampaignSend,
    CampaignDraftError | CampaignConfirmationRejected
  >;
}

export class CampaignConfirmationCodeService extends Context.Service<
  CampaignConfirmationCodeService,
  ICampaignConfirmationCodeService
>()("@deskohub-workspace/email-campaigns/CampaignConfirmationCodeService") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const { db } = yield* WorkspaceDatabase;
      const crypto = yield* Crypto.Crypto;
      const codeHashKey = yield* loadCodeHashKey;

      type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

      const hashCode = (campaignId: CampaignId, code: string) =>
        createHmac("sha256", codeHashKey)
          .update(`${campaignId}:${code}`)
          .digest("hex");

      const makeCode = crypto
        .randomBytes(codeLength)
        .pipe(
          Effect.map((bytes) =>
            campaignConfirmationCodeSchema.make(
              Array.from(
                bytes,
                (byte) => codeAlphabet[byte % codeAlphabet.length]
              ).join("")
            )
          )
        );

      /**
       * Locks a one-off Draft's row for the rest of the transaction. Content edits
       * update the same row, so they wait for the lock and then see the
       * campaign's new status.
       */
      const lockDraft = Effect.fn("CampaignConfirmationCodeService.lockDraft")(
        function* (tx: Transaction, campaignId: CampaignId) {
          const [campaign] = yield* tx
            .select()
            .from(emailCampaigns)
            .where(eq(emailCampaigns.id, campaignId))
            .for("update");
          if (!campaign) return yield* new CampaignNotFound({ campaignId });
          if (!isOnceCampaign(campaign)) {
            return yield* new CampaignDeliveryMismatch({
              campaignId,
              delivery: campaign.delivery,
            });
          }
          if (campaign.status !== "draft") {
            return yield* new CampaignReadOnly({
              campaignId,
              status: campaign.status,
            });
          }
          return campaign;
        }
      );

      const findCurrentCode = (tx: Transaction, campaignId: CampaignId) =>
        tx
          .select()
          .from(emailCampaignConfirmationCodes)
          .where(
            and(
              eq(emailCampaignConfirmationCodes.campaignId, campaignId),
              isNull(emailCampaignConfirmationCodes.supersededAt)
            )
          )
          .pipe(Effect.map(([current]) => current));

      /** Explains a typed code that isn't the current one. */
      const explainStaleCode = (
        tx: Transaction,
        input: { readonly campaignId: CampaignId; readonly codeHash: string }
      ) =>
        tx
          .select()
          .from(emailCampaignConfirmationCodes)
          .where(
            and(
              eq(emailCampaignConfirmationCodes.campaignId, input.campaignId),
              eq(emailCampaignConfirmationCodes.codeHash, input.codeHash)
            )
          )
          .pipe(Effect.map(([row]) => staleCodeRejection(row)));

      const replaceCurrentCode = (
        tx: Transaction,
        code: {
          readonly campaignId: CampaignId;
          readonly codeHash: string;
          readonly contentHash: CampaignContentHash;
          readonly issuedAt: Temporal.Instant;
          readonly expiresAt: Temporal.Instant;
        }
      ) =>
        lockDraft(tx, code.campaignId).pipe(
          Effect.andThen(
            tx
              .update(emailCampaignConfirmationCodes)
              .set({ supersededAt: code.issuedAt })
              .where(
                and(
                  eq(
                    emailCampaignConfirmationCodes.campaignId,
                    code.campaignId
                  ),
                  isNull(emailCampaignConfirmationCodes.supersededAt)
                )
              )
          ),
          Effect.andThen(tx.insert(emailCampaignConfirmationCodes).values(code))
        );

      const consumeCode = (
        tx: Transaction,
        input: {
          readonly campaign: CampaignRow;
          readonly codeHash: string;
          readonly contentHash: CampaignContentHash;
          readonly now: Temporal.Instant;
          readonly send: CampaignSendFreeze;
        }
      ) =>
        tx
          .update(emailCampaignConfirmationCodes)
          .set({ confirmedAt: input.now })
          .where(
            and(
              eq(emailCampaignConfirmationCodes.campaignId, input.campaign.id),
              eq(emailCampaignConfirmationCodes.codeHash, input.codeHash)
            )
          )
          .pipe(
            Effect.andThen(
              tx
                .update(emailCampaigns)
                .set({ status: "sending", updatedAt: input.now })
                .where(eq(emailCampaigns.id, input.campaign.id))
                .returning()
            ),
            Effect.map(([campaign]) => campaign!),
            Effect.bindTo("campaign"),
            Effect.bind("sendId", () => freezeSend(tx, input))
          );

      const freezeSend = Effect.fn(
        "CampaignConfirmationCodeService.freezeSend"
      )(function* (
        tx: Transaction,
        input: {
          readonly campaign: CampaignRow;
          readonly contentHash: CampaignContentHash;
          readonly now: Temporal.Instant;
          readonly send: CampaignSendFreeze;
        }
      ) {
        const [send] = yield* tx
          .insert(emailCampaignSends)
          .values({
            campaignId: input.campaign.id,
            audienceId: input.send.audienceId,
            audienceFilter: input.send.audienceFilter,
            contentHash: input.contentHash,
            createdAt: input.now,
          })
          .returning({ id: emailCampaignSends.id });
        if (input.send.recipients.length > 0) {
          yield* tx.insert(emailCampaignRecipients).values(
            input.send.recipients.map((recipient) => ({
              ...recipient,
              sendId: send!.id,
              statusUpdatedAt: input.now,
            }))
          );
        }
        return send!.id;
      });

      /** Counts a failed attempt; the last allowed one supersedes the code. */
      const recordFailedAttempt = Effect.fn(
        "CampaignConfirmationCodeService.recordFailedAttempt"
      )(function* (
        tx: Transaction,
        input: {
          readonly current: CampaignConfirmationCodeRow;
          readonly codeHash: string;
          readonly now: Temporal.Instant;
        }
      ) {
        const failedAttempts = input.current.failedAttempts + 1;
        const exhausted = failedAttempts >= maxFailedConfirmationAttempts;
        yield* tx
          .update(emailCampaignConfirmationCodes)
          .set({
            failedAttempts,
            supersededAt: exhausted ? input.now : null,
          })
          .where(
            and(
              eq(
                emailCampaignConfirmationCodes.campaignId,
                input.current.campaignId
              ),
              eq(
                emailCampaignConfirmationCodes.codeHash,
                input.current.codeHash
              )
            )
          );
        if (exhausted) return "too-many-attempts" as const;
        return yield* explainStaleCode(tx, {
          campaignId: input.current.campaignId,
          codeHash: input.codeHash,
        });
      });

      /**
       * Runs in one transaction under the campaign lock, and returns a
       * rejection instead of failing so a counted attempt commits.
       */
      const confirmLocked = (
        tx: Transaction,
        input: {
          readonly campaignId: CampaignId;
          readonly codeHash: string;
          readonly send: CampaignSendFreeze;
        }
      ) =>
        Effect.succeed(input).pipe(
          Effect.bind("campaign", ({ campaignId }) =>
            lockDraft(tx, campaignId)
          ),
          Effect.let("contentHash", ({ campaign }) =>
            hashCampaignContent({
              purpose: campaign.purpose,
              templateKey: campaign.templateKey,
              locales: campaign.content,
            })
          ),
          Effect.bind("now", () => currentInstant),
          Effect.bind("current", ({ campaignId }) =>
            findCurrentCode(tx, campaignId)
          ),
          Effect.let("verdict", judgeConfirmation),
          Effect.flatMap(({ verdict, ...confirmation }) =>
            Match.value(verdict).pipe(
              Match.tagsExhaustive({
                Confirm: () =>
                  consumeCode(tx, confirmation).pipe(
                    Effect.map((confirmed) => ({
                      _tag: "Confirmed" as const,
                      ...confirmed,
                    }))
                  ),
                Reject: ({ reason }) =>
                  Effect.succeed({ _tag: "Rejected" as const, reason }),
                FailAttempt: ({ current }) =>
                  recordFailedAttempt(tx, { ...confirmation, current }).pipe(
                    Effect.map((reason) => ({
                      _tag: "Rejected" as const,
                      reason,
                    }))
                  ),
                NoCurrentCode: () =>
                  explainStaleCode(tx, confirmation).pipe(
                    Effect.map((reason) => ({
                      _tag: "Rejected" as const,
                      reason,
                    }))
                  ),
              })
            )
          )
        );

      return {
        issue: (input) =>
          Effect.succeed(input).pipe(
            Effect.bind("code", () => makeCode),
            Effect.bind("issuedAt", () => currentInstant),
            Effect.let("expiresAt", ({ issuedAt }) =>
              issuedAt.add(campaignConfirmationCodeLifetime)
            ),
            Effect.tap(({ code, ...issued }) =>
              db.transaction((tx) =>
                replaceCurrentCode(tx, {
                  ...issued,
                  codeHash: hashCode(issued.campaignId, code),
                })
              )
            ),
            Effect.map(({ code, expiresAt }) => ({ code, expiresAt })),
            Effect.withSpan("CampaignConfirmationCodeService.issue")
          ),
        confirm: ({ campaignId, code, send }) =>
          db
            .transaction((tx) =>
              confirmLocked(tx, {
                campaignId,
                send,
                codeHash: hashCode(
                  campaignId,
                  normalizeCampaignConfirmationCode(code)
                ),
              })
            )
            .pipe(
              Effect.flatMap((outcome) =>
                Match.valueTags(outcome, {
                  Confirmed: ({ campaign, sendId }) =>
                    Effect.succeed({ campaign, sendId }),
                  Rejected: ({ reason }) =>
                    Effect.fail(
                      new CampaignConfirmationRejected({ campaignId, reason })
                    ),
                })
              ),
              Effect.withSpan("CampaignConfirmationCodeService.confirm")
            ),
      } satisfies ICampaignConfirmationCodeService;
    })
  );

  static Live = this.Default.pipe(
    Layer.provide(Layer.mergeAll(WorkspaceDatabase.Default, NodeCrypto.layer))
  );
}
