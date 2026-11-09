import "server-only";

import type {
  EmailDiscountSelection,
  EmailPreparationId,
  EmailValueName,
} from "@deskohub/workspace-admin-api";
import { and, eq } from "drizzle-orm";
import {
  Clock,
  Context,
  Data,
  Effect,
  Layer,
  Match,
  Option,
  Schema,
} from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { discounts } from "@/db/schema";
import {
  type EmailDeliveryOutcome,
  type EmailDiscountIssuanceRow,
  type EmailPreparationRow,
  emailDiscountIssuances,
  emailPreparations,
} from "@/db/schema/emails";
import type { DatabaseQueryError } from "@/db/sql-constraint";
import { canonicalPromotionCodeSchema } from "@/features/discounts/contracts";
import {
  type DiscountCodeSpaceExhausted,
  disableDiscountCode,
  insertGeneratedDiscountCode,
} from "@/features/discounts/discount-code-issuance";
import { storedDiscountIdSchema } from "@/features/discounts/persistence-contracts";
import {
  EmailPersistence,
  EmailPreparationConflict,
  EmailRecipientPersistence,
  type EmailVersionInvalid,
} from "@/features/emails/backend";
import {
  type EmailDiscountValue,
  emailDiscountIssuanceParameters,
} from "./email-discount-value";

/** Why a discount value cannot be issued for this recipient delivery. */
export class EmailDiscountValueUnavailable extends Data.TaggedError(
  "EmailDiscountValueUnavailable"
)<{
  readonly preparationId: EmailPreparationId;
  readonly valueName?: EmailValueName;
  readonly reason:
    | "preparation-not-found"
    | "not-a-discount-value"
    | "not-required"
    | "delivery-started"
    | "disabled"
    | "issuance-uncertain"
    | "discount-not-found";
}> {}

/** Outcome of cleaning up a preparation's discount values. */
export type EmailDiscountCleanup =
  | {
      /** Delivery is not definitively unsent, so every code stays active. */
      readonly _tag: "Kept";
      readonly deliveryOutcome: EmailDeliveryOutcome;
    }
  | {
      readonly _tag: "Disabled";
      /** Values disabled now or earlier; repeating cleanup lists them again. */
      readonly disabled: readonly EmailValueName[];
      /** Values whose issuance outcome is unknown; they are left untouched. */
      readonly uncertain: readonly EmailValueName[];
    };

type IssueFailure =
  | DatabaseQueryError
  | EmailVersionInvalid
  | EmailPreparationConflict
  | EmailDiscountValueUnavailable
  | DiscountCodeSpaceExhausted;

type DiscountValueReference = {
  readonly preparationId: EmailPreparationId;
  readonly valueName: EmailValueName;
};

export interface IEmailDiscountValues {
  /**
   * Issues the recipient delivery's customer-restricted code for one named
   * discount value, or returns the code already issued under the same durable
   * issuance identity. Creating the code and recording it in the issuance
   * ledger commit together, so a retry after any failure or crash recovers the
   * original code and expiry instead of creating another.
   */
  readonly issue: (
    reference: DiscountValueReference
  ) => Effect.Effect<EmailDiscountValue, IssueFailure>;
  /** The code already issued for this value, if any. Never creates a code. */
  readonly recover: (
    reference: DiscountValueReference
  ) => Effect.Effect<Option.Option<EmailDiscountValue>, DatabaseQueryError>;
  /**
   * Disables every discount code issued for the preparation, but only after
   * the delivery owner recorded a definitive no-send outcome. Any other
   * outcome, including an uncertain one, keeps the codes active and reports
   * it. Repeating cleanup is harmless.
   */
  readonly disableUnsent: (
    preparationId: EmailPreparationId
  ) => Effect.Effect<
    EmailDiscountCleanup,
    DatabaseQueryError | EmailDiscountValueUnavailable
  >;
}

type IssuanceRequest = {
  readonly reference: DiscountValueReference;
  readonly preparation: EmailPreparationRow;
  readonly existing: Option.Option<EmailDiscountIssuanceRow>;
};

const unavailable = (
  reference: DiscountValueReference,
  reason: EmailDiscountValueUnavailable["reason"]
) => new EmailDiscountValueUnavailable({ ...reference, reason });

/** The code and expiry the ledger records for an issuance, if any. */
const recordedCode = (
  row: EmailDiscountIssuanceRow
): Option.Option<EmailDiscountValue> =>
  Option.zipWith(
    Option.fromNullishOr(row.code),
    Option.fromNullishOr(row.expiresAt),
    (code, expiresAt) => ({ code, expiresAt: expiresAt.toString() })
  );

/**
 * An issued code replays. A closed issuance, or one whose outcome is unknown,
 * refuses a new code: issuing again could leave two redeemable codes.
 */
const replayedValue = ({ reference, existing }: IssuanceRequest) =>
  Option.match(existing, {
    onNone: () => Effect.succeed(Option.none<EmailDiscountValue>()),
    onSome: (row) =>
      Match.value(row.state).pipe(
        Match.when("reserved", () =>
          Effect.succeed(Option.none<EmailDiscountValue>())
        ),
        Match.when("issued", () => Effect.succeed(recordedCode(row))),
        Match.whenOr("cleanup-required", "disabled", () =>
          Effect.fail(unavailable(reference, "disabled"))
        ),
        Match.whenOr("issuing", "issuance-uncertain", () =>
          Effect.fail(unavailable(reference, "issuance-uncertain"))
        ),
        Match.exhaustive
      ),
  });

/** A code is issued only before delivery, for a value the email requires. */
const requireIssuable = ({ reference, preparation }: IssuanceRequest) =>
  Effect.succeed(preparation).pipe(
    Effect.filterOrFail(
      ({ deliveryOutcome, state }) =>
        deliveryOutcome === "pending" &&
        (state === "selected" || state === "preparing"),
      () => unavailable(reference, "delivery-started")
    ),
    Effect.filterOrFail(
      ({ requiredValueNames }) =>
        requiredValueNames.includes(reference.valueName),
      () => unavailable(reference, "not-required")
    )
  );

const StoredIssuanceParameters = Schema.fromJsonString(
  Schema.Struct({
    discountId: Schema.String,
    expiresAt: Schema.String,
    maxUses: Schema.Int,
    maxUsesPerCustomer: Schema.Int,
  })
);

/** A stored reservation must match the frozen definition it came from. */
const reservedParameters = ({
  reference,
  reservation,
  selection,
}: {
  readonly reference: DiscountValueReference;
  readonly reservation: EmailDiscountIssuanceRow;
  readonly selection: EmailDiscountSelection;
}) => {
  const conflict = () =>
    new EmailPreparationConflict({
      preparationId: reference.preparationId,
      reason: "issuance-conflict",
    });
  return Schema.decodeEffect(StoredIssuanceParameters)(
    reservation.parameters
  ).pipe(
    Effect.mapError(conflict),
    Effect.filterOrFail(
      (stored) =>
        stored.discountId === selection.discountId &&
        stored.maxUses === selection.maxUses &&
        stored.maxUsesPerCustomer === selection.maxUsesPerCustomer,
      conflict
    )
  );
};

const isUnresolved = (row: EmailDiscountIssuanceRow) =>
  row.state === "issuing" || row.state === "issuance-uncertain";

export class EmailDiscountValues extends Context.Service<
  EmailDiscountValues,
  IEmailDiscountValues
>()("@deskohub-workspace/emails/EmailDiscountValues") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const { db, transaction } = yield* WorkspaceDatabase;
      const emails = yield* EmailPersistence;
      const recipients = yield* EmailRecipientPersistence;

      /** Serializes every issuance and cleanup of a delivery on its row. */
      const lockedPreparation = (preparationId: EmailPreparationId) =>
        db
          .select()
          .from(emailPreparations)
          .where(eq(emailPreparations.id, preparationId))
          .for("update")
          .pipe(
            Effect.map(([row]) => Option.fromNullishOr(row)),
            Effect.flatMap(
              Option.match({
                onNone: () =>
                  Effect.fail(
                    new EmailDiscountValueUnavailable({
                      preparationId,
                      reason: "preparation-not-found",
                    })
                  ),
                onSome: Effect.succeed,
              })
            )
          );

      const findIssuance = ({
        preparationId,
        valueName,
      }: DiscountValueReference) =>
        db
          .select()
          .from(emailDiscountIssuances)
          .where(
            and(
              eq(emailDiscountIssuances.preparationId, preparationId),
              eq(emailDiscountIssuances.valueName, valueName)
            )
          )
          .pipe(Effect.map(([row]) => Option.fromNullishOr(row)));

      const updateIssuance = (
        { preparationId, valueName }: DiscountValueReference,
        values: Partial<
          Pick<EmailDiscountIssuanceRow, "state" | "code" | "expiresAt">
        >
      ) =>
        db
          .update(emailDiscountIssuances)
          .set(values)
          .where(
            and(
              eq(emailDiscountIssuances.preparationId, preparationId),
              eq(emailDiscountIssuances.valueName, valueName)
            )
          );

      /** The discount definition frozen in the delivery's selected version. */
      const frozenSelection = ({ reference, preparation }: IssuanceRequest) =>
        emails.getVersion(preparation.emailVersionId).pipe(
          Effect.map((version) =>
            Option.fromNullishOr(
              version?.document.values.find(
                (value) => value.name === reference.valueName
              )?.source
            ).pipe(
              Option.filter(
                (source): source is EmailDiscountSelection =>
                  source.kind === "discount"
              )
            )
          ),
          Effect.flatMap(
            Option.match({
              onNone: () =>
                Effect.fail(unavailable(reference, "not-a-discount-value")),
              onSome: Effect.succeed,
            })
          )
        );

      const requireDiscount = ({
        reference,
        selection,
      }: {
        readonly reference: DiscountValueReference;
        readonly selection: EmailDiscountSelection;
      }) =>
        db
          .select({ id: discounts.id })
          .from(discounts)
          .where(
            eq(discounts.id, storedDiscountIdSchema.make(selection.discountId))
          )
          .pipe(
            Effect.filterOrFail(
              (rows) => rows.length > 0,
              () => unavailable(reference, "discount-not-found")
            )
          );

      /** Reuses the reservation's frozen parameters, or freezes them now. */
      const reserve = ({
        reference,
        existing,
        selection,
      }: IssuanceRequest & { readonly selection: EmailDiscountSelection }) =>
        Option.match(existing, {
          onSome: Effect.succeed,
          onNone: () =>
            Clock.currentTimeMillis.pipe(
              Effect.flatMap((now) =>
                recipients.reserveIssuance({
                  ...reference,
                  parameters: emailDiscountIssuanceParameters(selection, now),
                })
              )
            ),
        });

      /**
       * Creates the customer-restricted code and records it in the ledger in
       * the caller's transaction, so neither survives without the other.
       */
      const issueNew = (request: IssuanceRequest) =>
        Effect.succeed(request).pipe(
          Effect.tap(requireIssuable),
          Effect.bind("selection", frozenSelection),
          Effect.tap(requireDiscount),
          Effect.bind("reservation", reserve),
          Effect.bind("parameters", reservedParameters),
          Effect.let("expiresAt", ({ parameters }) =>
            Temporal.Instant.from(parameters.expiresAt)
          ),
          Effect.tap(({ reference }) =>
            updateIssuance(reference, { state: "issuing" })
          ),
          Effect.bind("created", ({ preparation, parameters, expiresAt }) =>
            insertGeneratedDiscountCode({
              discountId: storedDiscountIdSchema.make(parameters.discountId),
              enabled: true,
              validFrom: null,
              validUntil: expiresAt,
              maxUses: parameters.maxUses,
              maxUsesPerCustomer: parameters.maxUsesPerCustomer,
              serviceDateFrom: null,
              serviceDateUntil: null,
              audience: [preparation.dotyposCustomerId],
            })
          ),
          Effect.tap(({ reference, created, expiresAt }) =>
            updateIssuance(reference, {
              state: "issued",
              code: created.code,
              expiresAt,
            })
          ),
          Effect.map(
            ({ created, expiresAt }): EmailDiscountValue => ({
              code: created.code,
              expiresAt: expiresAt.toString(),
            })
          )
        );

      const issue = Effect.fn("EmailDiscountValues.issue")(
        (reference: DiscountValueReference) =>
          transaction(
            Effect.succeed({ reference }).pipe(
              Effect.bind("preparation", ({ reference }) =>
                lockedPreparation(reference.preparationId)
              ),
              Effect.bind("existing", ({ reference }) =>
                findIssuance(reference)
              ),
              Effect.bind("replayed", replayedValue),
              Effect.flatMap(({ replayed, ...request }) =>
                Option.match(replayed, {
                  onSome: Effect.succeed,
                  onNone: () => issueNew(request),
                })
              )
            )
          )
      );

      const recover = Effect.fn("EmailDiscountValues.recover")(
        (reference: DiscountValueReference) =>
          findIssuance(reference).pipe(Effect.map(Option.flatMap(recordedCode)))
      );

      const disableRecordedCode = (row: EmailDiscountIssuanceRow) =>
        Option.match(Option.fromNullishOr(row.code), {
          onNone: () => Effect.void,
          onSome: (code) =>
            disableDiscountCode(canonicalPromotionCodeSchema.make(code)).pipe(
              Effect.asVoid
            ),
        });

      /** Requests cleanup, disables any issued code, then closes the issuance. */
      const disableIssuance = (row: EmailDiscountIssuanceRow) =>
        Match.value(row.state).pipe(
          Match.when("disabled", () => Effect.void),
          Match.when("issued", () =>
            updateIssuance(row, { state: "cleanup-required" }).pipe(
              Effect.andThen(disableRecordedCode(row)),
              Effect.andThen(updateIssuance(row, { state: "disabled" })),
              Effect.asVoid
            )
          ),
          Match.orElse(() =>
            disableRecordedCode(row).pipe(
              Effect.andThen(updateIssuance(row, { state: "disabled" })),
              Effect.asVoid
            )
          )
        );

      /**
       * This issuer commits a code with its ledger result, so it never leaves
       * `issuing` or `issuance-uncertain` rows; any such row is reported and
       * left untouched rather than guessed at.
       */
      const disableIssuances = (preparationId: EmailPreparationId) =>
        db
          .select()
          .from(emailDiscountIssuances)
          .where(eq(emailDiscountIssuances.preparationId, preparationId))
          .for("update")
          .pipe(
            Effect.map((issuances) => ({
              cleanable: issuances.filter((row) => !isUnresolved(row)),
              unresolved: issuances.filter(isUnresolved),
            })),
            Effect.tap(({ cleanable }) =>
              Effect.forEach(cleanable, disableIssuance)
            ),
            Effect.map(
              ({ cleanable, unresolved }): EmailDiscountCleanup => ({
                _tag: "Disabled",
                disabled: cleanable.map((row) => row.valueName),
                uncertain: unresolved.map((row) => row.valueName),
              })
            )
          );

      const disableUnsent = Effect.fn("EmailDiscountValues.disableUnsent")(
        (preparationId: EmailPreparationId) =>
          transaction(
            lockedPreparation(preparationId).pipe(
              Effect.flatMap(({ deliveryOutcome }) =>
                Match.value(deliveryOutcome).pipe(
                  Match.when("definitively-unsent", () =>
                    disableIssuances(preparationId)
                  ),
                  Match.orElse((kept) =>
                    Effect.succeed<EmailDiscountCleanup>({
                      _tag: "Kept",
                      deliveryOutcome: kept,
                    })
                  )
                )
              )
            )
          )
      );

      return { issue, recover, disableUnsent };
    })
  );
}
