import { createHash, randomUUID } from "node:crypto";
import {
  type ExternalAPIError,
  type NetworkError,
  type NexiCardContract,
  type NexiContractId,
  NexiContractIdSchema,
  type NexiCorrelationId,
  type NexiOrder,
  type NexiOrderId,
  NexiOrderIdSchema,
  NexiService,
} from "@deskohub/nexi";
// Build-time module evaluation (Next "Collecting page data") runs before the
// app instrumentation installs the global Temporal, so this module binds the
// polyfill explicitly instead of relying on the global.
import { Temporal as TemporalPolyfill } from "@js-temporal/polyfill";
import { Context, Data, Effect, Layer, Match, Result } from "effect";
import type { SqlError } from "effect/unstable/sql/SqlError";
import type { CustomerCardEnrollmentRow } from "@/db/schema";
import { appendVercelPreviewProtectionBypass } from "@/features/checkout/backend/checkout/vercel-preview-protection-bypass";
import { getNexiCurrencyOverride } from "@/features/checkout/backend/payment/nexi-currency";
import type { Locale } from "@/features/i18n";
import { WorkspaceNexiLayer } from "@/shared/backend/config/nexi.config";
import {
  getWorkspaceRuntimeCallbackOrigin,
  type WorkspaceUrlConfigError,
} from "@/shared/backend/config/workspace-url.config";
import type {
  SavedCardEnrollmentOutcome,
  SavedCardView,
} from "../../contracts";
import type {
  CustomerAccountId,
  LinkedCustomerAccount,
} from "../../customer-account";
import {
  type CustomerAccountAccessError,
  customerAccountIdSchema,
} from "../../customer-account";
import { requireAccountActivity } from "../customer-account-activity";
import { CustomerAccountLinkRepository } from "../customer-account-link.repository";
import {
  SavedCardContractRepository,
  type SavedCardContractRepositoryError,
} from "./saved-card-contract.repository";
import { getSavedCardCustomerReference } from "./saved-card-customer-reference";

const enrollmentFreshness = TemporalPolyfill.Duration.from({ minutes: 30 });

/** Upper bound for provider reconciliations triggered by one listing. */
const pendingReconciliationBound = 8;

const sha256Hex = (value: string) =>
  createHash("sha256").update(value).digest("hex");

const generateEnrollmentOrderId = (): NexiOrderId =>
  NexiOrderIdSchema.make(
    `dhcard${randomUUID().replaceAll("-", "").slice(0, 12)}`
  );

const generateEnrollmentContractId = (): NexiContractId => {
  const random = BigInt(`0x${randomUUID().replaceAll("-", "")}`)
    .toString(36)
    .padStart(25, "0");
  return NexiContractIdSchema.make(`dh${random.slice(0, 12)}`);
};

const generateCorrelationId = (): NexiCorrelationId =>
  randomUUID() as NexiCorrelationId;

export class SavedCardError extends Data.TaggedError("SavedCardError")<{
  readonly code: "unavailable" | "card_failed";
  readonly cause?: unknown;
}> {}

export type SavedCardEnrollmentStartResult = {
  readonly status: "redirect";
  readonly hostedPage: string;
};

export type SavedCardRemovalResult =
  | { readonly status: "removed" }
  | { readonly status: "retry" };

export type SavedCardEnrollmentScope = {
  readonly accountId: CustomerAccountId;
  readonly orderId: NexiOrderId;
};

interface ISavedCardService {
  /**
   * Creates an enrollment under the account advisory lock: an authoritative
   * activity recheck, the provider session creation, and the enrollment row
   * insert are one serialized unit against deletion's marker write, so an
   * enrollment can never slip past a completed deletion.
   */
  readonly startEnrollment: (
    account: LinkedCustomerAccount,
    locale: Locale
  ) => Effect.Effect<
    SavedCardEnrollmentStartResult,
    | SavedCardError
    | WorkspaceUrlConfigError
    | CustomerAccountAccessError
    | SavedCardContractRepositoryError
  >;
  /**
   * Browser-return verification: session-authenticated (the route resolves the
   * account id) and ownership-checked — another account's orderId is
   * indistinguishable from an unknown one.
   */
  readonly verifyEnrollment: (
    scope: SavedCardEnrollmentScope
  ) => Effect.Effect<
    SavedCardEnrollmentOutcome,
    SavedCardError | SavedCardContractRepositoryError
  >;
  /**
   * Provider-webhook reconciliation: the presented notification security token
   * is mandatory and its digest must match before any processing; absent or
   * mismatched tokens yield "not_found" with zero mutations and zero provider
   * calls.
   */
  readonly reconcileEnrollmentByOrderId: (
    orderId: NexiOrderId,
    presentedSecurityToken: string | undefined
  ) => Effect.Effect<
    SavedCardEnrollmentOutcome,
    SavedCardError | SavedCardContractRepositoryError
  >;
  readonly cancelEnrollment: (
    scope: SavedCardEnrollmentScope
  ) => Effect.Effect<
    SavedCardEnrollmentOutcome,
    SavedCardError | SavedCardContractRepositoryError
  >;
  readonly listCards: (
    account: LinkedCustomerAccount
  ) => Effect.Effect<
    readonly SavedCardView[],
    SavedCardError | SavedCardContractRepositoryError
  >;
  readonly removeCard: (
    account: LinkedCustomerAccount,
    contractId: NexiContractId
  ) => Effect.Effect<
    SavedCardRemovalResult,
    SavedCardError | SavedCardContractRepositoryError
  >;
  readonly deactivateAllForDeletion: (
    accountId: CustomerAccountId
  ) => Effect.Effect<void, SavedCardError | SavedCardContractRepositoryError>;
}

const toNexiLocale = (locale: Locale) => locale;

const getVerificationAmount = "0";

const authorizedVerificationResult = "AUTHORIZED";

const cancelledVerificationResults = new Set([
  "CANCELED",
  "CANCELLED",
  "VOIDED",
]);

const failedVerificationResults = new Set([
  "DECLINED",
  "DENIED",
  "DENIED_BY_RISK",
  "THREEDS_FAILED",
  "FAILED",
  "EXPIRED",
  "TIMEOUT",
  "TIMED_OUT",
]);

const isRetryableProviderFailure = (
  cause: ExternalAPIError | NetworkError
): boolean =>
  Match.value(cause).pipe(
    Match.tag("NetworkError", () => true),
    Match.tag("ExternalAPIError", (apiError) => {
      if (apiError.statusCode === undefined) return true;
      if (apiError.statusCode >= 500) return true;
      // Ambiguous transport-level statuses stay retryable.
      return [408, 409, 425, 429].includes(apiError.statusCode);
    }),
    Match.exhaustive
  );

const toSavedCardError = (cause: ExternalAPIError | NetworkError) =>
  new SavedCardError({
    code: isRetryableProviderFailure(cause) ? "unavailable" : "card_failed",
    cause,
  });

export class SavedCardService extends Context.Service<
  SavedCardService,
  ISavedCardService
>()("@deskohub-workspace/account/SavedCardService") {
  static Default = makeSavedCardServiceLayer(this);

  static Live = this.Default.pipe(
    Layer.provide(
      Layer.mergeAll(
        WorkspaceNexiLayer,
        CustomerAccountLinkRepository.Live,
        SavedCardContractRepository.Live
      )
    )
  );
}

const getSavedCardCallbackUrl = (
  path: string
): Effect.Effect<string, WorkspaceUrlConfigError> =>
  Effect.gen(function* () {
    const origin = yield* getWorkspaceRuntimeCallbackOrigin;
    const url = new URL(path, origin);
    appendVercelPreviewProtectionBypass(url);
    return url.toString();
  });

const getSavedCardEnrollmentUrls = (
  locale: Locale,
  orderId: NexiOrderId
): Effect.Effect<
  { resultUrl: string; cancelUrl: string; notificationUrl: string },
  WorkspaceUrlConfigError
> =>
  Effect.all({
    resultUrl: getSavedCardCallbackUrl(
      `/${locale}/account/billing/cards/return/${orderId}`
    ),
    cancelUrl: getSavedCardCallbackUrl(
      `/${locale}/account/billing/cards/cancel/${orderId}`
    ),
    notificationUrl: getSavedCardCallbackUrl("/api/webhooks/nexi/cards"),
  });

const isFreshEnrollment = (createdAt: Temporal.Instant) =>
  Temporal.Instant.compare(
    createdAt,
    Temporal.Now.instant().subtract(enrollmentFreshness)
  ) > 0;

const asInstant = (value: Temporal.Instant | Date): Temporal.Instant =>
  value instanceof Date
    ? Temporal.Instant.fromEpochMilliseconds(value.getTime())
    : value;

/** Row columns carry plain strings; domain input is branded. */
const toAccountId = (value: string) => customerAccountIdSchema.make(value);

const outcomeForState = (
  state: CustomerCardEnrollmentRow["state"]
): SavedCardEnrollmentOutcome => state;

type ProviderOrderVerdict =
  | { readonly kind: "unknown" }
  | { readonly kind: "authorized" }
  | { readonly kind: "terminal"; readonly terminal: "cancelled" | "failed" }
  | { readonly kind: "indeterminate" };

/**
 * The provider-side resolution of an enrollment, deliberately distinct from
 * the local row state: a locally cancelled or superseded enrollment whose
 * provider session is still unresolved is NOT terminal, and deletion must
 * treat it as blocking.
 */
/** Maps a lock-boundary SqlError onto the retryable saved-card error. */
const toLockUnavailable = (cause: SqlError) =>
  new SavedCardError({ code: "unavailable", cause });

const evaluateProviderOrder = (order: NexiOrder): ProviderOrderVerdict => {
  const authorized = order.operations.find(
    (operation) =>
      operation.operationType === "CARD_VERIFICATION" &&
      operation.operationResult?.toUpperCase() ===
        authorizedVerificationResult &&
      operation.amount === getVerificationAmount &&
      (operation.orderId ?? order.orderId) === order.orderId
  );
  if (authorized) return { kind: "authorized" };

  for (const operation of order.operations) {
    if (operation.operationType !== "CARD_VERIFICATION") continue;
    const result = operation.operationResult?.toUpperCase();
    if (result && cancelledVerificationResults.has(result)) {
      return { kind: "terminal", terminal: "cancelled" };
    }
    if (result && failedVerificationResults.has(result)) {
      return { kind: "terminal", terminal: "failed" };
    }
  }
  return { kind: "indeterminate" };
};

function makeSavedCardServiceLayer(service: typeof SavedCardService) {
  return Layer.effect(
    service,
    Effect.gen(function* () {
      const nexi = yield* NexiService;
      const repository = yield* SavedCardContractRepository;
      const links = yield* CustomerAccountLinkRepository;

      const handleEnrollmentCreateFailure = Effect.fn(
        "SavedCardService.handleEnrollmentCreateFailure"
      )(function* (
        cause: ExternalAPIError | NetworkError,
        orderId: NexiOrderId,
        customerAccountId: CustomerAccountId
      ) {
        const error = toSavedCardError(cause);
        // A definitive provider rejection closes the enrollment; an
        // ambiguous one stays pending so the customer can retry it.
        if (error.code === "card_failed") {
          yield* repository.transitionEnrollment({
            orderId,
            customerAccountId,
            state: "failed",
            failureCode: "enrollment.provider_rejected",
          });
        }
        return yield* Effect.fail(error);
      });

      const startEnrollment = Effect.fn("SavedCardService.startEnrollment")(
        function* (account: LinkedCustomerAccount, locale: Locale) {
          const providerCustomerId = getSavedCardCustomerReference(
            account.accountId
          );

          // Serialization invariant against account deletion: the account
          // advisory lock is held from an authoritative activity recheck
          // through provider session creation and the enrollment row insert.
          // Deletion's marker write takes the same lock, so exactly one
          // ordering is possible: either the marker lands first and the
          // recheck rejects the enrollment, or the whole enrollment (pending
          // row included) lands first and deletion's sweep reconciles it —
          // blocking while the session is provider-unresolved. A pending
          // enrollment can therefore never orphan a contract on a deleted
          // account. The lock transaction is deliberately write-free on its
          // dedicated client, matching how checkout holds it across its
          // provider call.
          const createEnrollmentSession = Effect.fn(
            "SavedCardService.createEnrollmentSession"
          )(function* () {
            // Authoritative recheck under the lock: a durable deletion
            // marker (or a removed auth row) rejects the enrollment here.
            yield* requireAccountActivity(links, account.accountId);

            // A stale pending enrollment from an abandoned session must not
            // block a new attempt: it is superseded, a fresh one may reuse
            // its slot. Supersession is a local intent only — provider-side
            // reconciliation can still recover a late success.
            const pending = yield* repository.findPendingEnrollment(
              account.accountId
            );
            const reusable =
              pending && isFreshEnrollment(asInstant(pending.createdAt))
                ? pending
                : null;
            if (pending && !reusable) {
              yield* repository.transitionEnrollment({
                orderId: pending.orderId,
                customerAccountId: account.accountId,
                state: "failed",
                failureCode: "enrollment.superseded",
              });
            }

            const orderId = reusable?.orderId ?? generateEnrollmentOrderId();
            const contractId =
              reusable?.providerContractId ?? generateEnrollmentContractId();
            const correlationId = generateCorrelationId();

            const { resultUrl, cancelUrl, notificationUrl } =
              yield* getSavedCardEnrollmentUrls(locale, orderId);

            const hostedPage = yield* nexi
              .createHostedPaymentPage({
                orderId,
                correlationId,
                amount: getVerificationAmount,
                currency: getNexiCurrencyOverride() ?? "CZK",
                locale: toNexiLocale(locale),
                resultUrl,
                cancelUrl,
                notificationUrl,
                // The enrollment is bound to this account's opaque provider
                // customer reference, so the created contract is listable and
                // deactivatable through the derived reference only.
                customerReference: providerCustomerId,
                contractEnrollment: { contractId, contractType: "CIT" },
                actionType: "VERIFY",
              })
              .pipe(
                Effect.catch((cause: ExternalAPIError | NetworkError) =>
                  handleEnrollmentCreateFailure(
                    cause,
                    orderId,
                    account.accountId
                  )
                )
              );

            const digest = sha256Hex(hostedPage.securityToken);
            if (reusable) {
              yield* repository.refreshEnrollmentSecurityTokenDigest({
                orderId,
                customerAccountId: account.accountId,
                securityTokenDigest: digest,
              });
            } else {
              yield* repository.createEnrollment({
                customerAccountId: account.accountId,
                orderId,
                providerCustomerId,
                providerContractId: contractId,
                securityTokenDigest: digest,
              });
            }

            return {
              status: "redirect" as const,
              hostedPage: hostedPage.hostedPage,
            };
          });

          return yield* links
            .withAccountLock(account.accountId, createEnrollmentSession())
            .pipe(Effect.catchTag("SqlError", toLockUnavailable));
        }
      );

      const failEnrollment =
        (kind: "cancelled" | "failed") =>
        (enrollment: {
          orderId: NexiOrderId;
          customerAccountId: CustomerAccountId;
        }) =>
          repository
            .transitionEnrollment({
              orderId: enrollment.orderId,
              customerAccountId: enrollment.customerAccountId,
              state: kind,
              failureCode: `enrollment.${kind}`,
            })
            .pipe(Effect.as(kind));

      /**
       * The single provider reconciliation used by browser verification,
       * webhook reconciliation, listing, and deletion cleanup. Late success
       * wins regardless of the local enrollment state: cancelled, failed, and
       * superseded rows recover when the provider shows the verification
       * actually completed with a CIT contract.
       */
      const reconcileEnrollment = Effect.fn(
        "SavedCardService.reconcileEnrollment"
      )(function* (enrollment: CustomerCardEnrollmentRow) {
        const order = yield* nexi
          .getOrder({
            orderId: enrollment.orderId,
            correlationId: generateCorrelationId(),
          })
          .pipe(Effect.mapError(toSavedCardError));

        if (order.orderId !== enrollment.orderId) {
          return { provider: "unresolved", outcome: "not_found" } as const;
        }

        const localOutcome = outcomeForState(enrollment.state);
        const verdict = evaluateProviderOrder(order);

        if (verdict.kind === "unknown") {
          return { provider: "unresolved", outcome: "not_found" } as const;
        }

        if (verdict.kind === "authorized") {
          const contracts = yield* nexi
            .listCustomerContracts({
              customerId: enrollment.providerCustomerId,
              correlationId: generateCorrelationId(),
            })
            .pipe(Effect.mapError(toSavedCardError));
          const providerEntry = contracts.find(
            (contract) =>
              contract.contractId === enrollment.providerContractId &&
              // Only a CIT contract is a confirmation: a CARD+MIT entry is
              // never confirmed into an active row nor displayed.
              contract.contractType === "CIT"
          );
          // The provider list is the confirmation authority: without the CIT
          // contract there, the verification is provider-UNRESOLVED — even
          // when the local row already reads cancelled, failed, or
          // superseded.
          if (!providerEntry) {
            return { provider: "unresolved", outcome: localOutcome } as const;
          }

          yield* repository.upsertActiveContract({
            customerAccountId: toAccountId(enrollment.customerAccountId),
            providerCustomerId: enrollment.providerCustomerId,
            providerContractId: enrollment.providerContractId,
            displayCircuit: providerEntry.circuit,
            displaySuffix: providerEntry.maskedInstrumentSuffix,
          });
          yield* repository.confirmEnrollmentFromAnyState({
            orderId: enrollment.orderId,
            customerAccountId: toAccountId(enrollment.customerAccountId),
          });
          return { provider: "confirmed", outcome: "confirmed" } as const;
        }

        if (verdict.kind === "terminal") {
          // Provider-terminal outcomes can never create a contract; a
          // still-pending enrollment records the provider outcome.
          if (enrollment.state === "pending") {
            yield* failEnrollment(verdict.terminal)({
              orderId: enrollment.orderId,
              customerAccountId: toAccountId(enrollment.customerAccountId),
            });
            return {
              provider: "terminal",
              outcome: verdict.terminal,
            } as const;
          }
          return { provider: "terminal", outcome: localOutcome } as const;
        }

        return { provider: "unresolved", outcome: localOutcome } as const;
      });

      const verifyEnrollment = Effect.fn("SavedCardService.verifyEnrollment")(
        function* (scope: SavedCardEnrollmentScope) {
          const enrollment = yield* repository.findEnrollmentByOrderId(
            scope.orderId
          );
          // Unknown orders and another account's orders collapse into the
          // same non-committal outcome so nothing about existing enrollments
          // can be probed across accounts.
          if (!enrollment || enrollment.customerAccountId !== scope.accountId) {
            return "not_found";
          }
          return (yield* reconcileEnrollment(enrollment)).outcome;
        }
      );

      const reconcileEnrollmentByOrderId = Effect.fn(
        "SavedCardService.reconcileEnrollmentByOrderId"
      )(function* (
        orderId: NexiOrderId,
        presentedSecurityToken: string | undefined
      ) {
        // The webhook token is mandatory: without one there is nothing to
        // authenticate the notification against, so nothing is loaded,
        // mutated, or fetched from the provider.
        const digest = presentedSecurityToken
          ? sha256Hex(presentedSecurityToken)
          : undefined;
        if (!digest) return "not_found";

        const enrollment = yield* repository.findEnrollmentByOrderId(orderId);
        // Unknown orders and digest mismatches collapse into the same
        // non-committal outcome, for every enrollment state.
        if (!enrollment || digest !== enrollment.securityTokenDigest) {
          return "not_found";
        }
        return (yield* reconcileEnrollment(enrollment)).outcome;
      });

      const cancelEnrollment = Effect.fn("SavedCardService.cancelEnrollment")(
        function* (scope: SavedCardEnrollmentScope) {
          const enrollment = yield* repository.findEnrollmentByOrderId(
            scope.orderId
          );
          if (!enrollment || enrollment.customerAccountId !== scope.accountId) {
            return "not_found";
          }

          const reconciled = yield* reconcileEnrollment(enrollment);
          if (reconciled.provider !== "unresolved") {
            return reconciled.outcome;
          }
          if (reconciled.outcome !== "pending") return reconciled.outcome;

          // Local intent only: reconciliation can still flip this row to
          // confirmed if the provider later shows a completed verification.
          yield* repository.transitionEnrollment({
            orderId: enrollment.orderId,
            customerAccountId: toAccountId(enrollment.customerAccountId),
            state: "cancelled",
            failureCode: "enrollment.cancelled",
          });
          return "cancelled";
        }
      );

      const listProviderContracts = (
        accountId: CustomerAccountId
      ): Effect.Effect<
        readonly NexiCardContract[],
        SavedCardError | SavedCardContractRepositoryError
      > =>
        nexi
          .listCustomerContracts({
            customerId: getSavedCardCustomerReference(accountId),
            correlationId: generateCorrelationId(),
          })
          .pipe(
            Effect.catchTag("ExternalAPIError", (cause) =>
              // A customer the provider does not know simply has no contracts.
              cause.statusCode === 404
                ? Effect.succeed([] as readonly NexiCardContract[])
                : Effect.fail(toSavedCardError(cause))
            ),
            Effect.catchTag("NetworkError", (cause) =>
              Effect.fail(toSavedCardError(cause))
            )
          );

      const listCards = Effect.fn("SavedCardService.listCards")(function* (
        account: LinkedCustomerAccount
      ) {
        // Provider-unresolved enrollments reconcile first, so a flow that
        // completed out-of-band (webhook lost, return visited before
        // contract visibility) becomes visible on this reload. Every
        // non-confirmed row is a candidate — cancelled, failed, and
        // superseded rows can still complete late. Rotation invariant: the
        // candidates are reconciled oldest-`updatedAt`-first (provider
        // contract id as the deterministic tie-breaker), each attempt
        // touches the row REGARDLESS of its outcome — a failing provider
        // call still fails this request closed, but the recorded attempt
        // makes the NEXT reload rotate past it — and the sweep is bounded,
        // so successive reloads rotate through the unresolved set without
        // starving any row.
        const unresolvedEnrollments = (yield* repository.listEnrollments(
          account.accountId
        ))
          .filter((row) => row.state !== "confirmed")
          .sort((a, b) => {
            const byUpdatedAt = Temporal.Instant.compare(
              asInstant(a.updatedAt),
              asInstant(b.updatedAt)
            );
            return (
              byUpdatedAt ||
              a.providerContractId.localeCompare(b.providerContractId)
            );
          })
          .slice(0, pendingReconciliationBound);
        for (const enrollment of unresolvedEnrollments) {
          const attempted = yield* Effect.result(
            reconcileEnrollment(enrollment)
          );
          yield* repository.touchEnrollment({
            orderId: enrollment.orderId,
            customerAccountId: toAccountId(enrollment.customerAccountId),
          });
          if (Result.isFailure(attempted)) {
            return yield* Effect.fail(attempted.failure);
          }
        }

        const [localRows, providerContracts] = yield* Effect.all([
          repository.listActiveContracts(account.accountId),
          listProviderContracts(account.accountId),
        ]);

        // Only CIT contracts are displayable saved cards.
        const providerById = new Map(
          providerContracts
            .filter((contract) => contract.contractType === "CIT")
            .map((contract) => [contract.contractId, contract])
        );

        const views: SavedCardView[] = [];
        for (const row of localRows) {
          const providerEntry = providerById.get(row.providerContractId);
          if (!providerEntry) {
            // The provider no longer returns the contract (or it is no longer
            // a CIT card): the local row is stale and must disappear from the
            // customer's view.
            yield* repository.markContractRemoved({
              customerAccountId: account.accountId,
              providerContractId: row.providerContractId,
            });
            continue;
          }
          views.push({
            contractId: row.providerContractId,
            ...(providerEntry.circuit && { circuit: providerEntry.circuit }),
            ...(providerEntry.maskedInstrumentSuffix && {
              suffix: providerEntry.maskedInstrumentSuffix,
            }),
          });
        }

        return views.sort((a, b) => a.contractId.localeCompare(b.contractId));
      });

      const removeCard = Effect.fn("SavedCardService.removeCard")(function* (
        account: LinkedCustomerAccount,
        contractId: NexiContractId
      ) {
        const row = yield* repository.findContract({
          customerAccountId: account.accountId,
          providerContractId: contractId,
        });
        if (row?.state !== "active") {
          return { status: "removed" as const };
        }

        const providerContracts = yield* listProviderContracts(
          account.accountId
        );
        if (
          !providerContracts.some((entry) => entry.contractId === contractId)
        ) {
          // The provider already dropped the contract: converge locally.
          yield* repository.markContractRemoved({
            customerAccountId: account.accountId,
            providerContractId: contractId,
          });
          return { status: "removed" as const };
        }

        return yield* nexi
          .deactivateContract({
            contractId,
            correlationId: generateCorrelationId(),
          })
          .pipe(
            // Already deactivated at the provider: converge locally.
            Effect.catchTag("ExternalAPIError", (cause) =>
              cause.statusCode === 404
                ? Effect.void
                : Effect.fail(toSavedCardError(cause))
            ),
            Effect.catchTag("NetworkError", (cause) =>
              Effect.fail(toSavedCardError(cause))
            ),
            Effect.andThen(
              repository.markContractRemoved({
                customerAccountId: account.accountId,
                providerContractId: contractId,
              })
            ),
            Effect.as({ status: "removed" as const })
          );
      });

      const deactivateAllForDeletion = Effect.fn(
        "SavedCardService.deactivateAllForDeletion"
      )(function* (accountId: CustomerAccountId) {
        // The durable deletion marker is already persisted when this runs, so
        // no new enrollment or listing activity can interleave. Enrollments
        // that have not provider-confirmed must reconcile first: ANY
        // provider-unresolved enrollment blocks the deletion retryably —
        // regardless of its local cancelled/failed/superseded state, because
        // its hosted session can still complete and create a contract. A
        // provider-terminal outcome can never create one, and a late success
        // registers its contract so the deactivation sweep below removes it.
        const enrollments = yield* repository.listEnrollments(accountId);
        for (const enrollment of enrollments) {
          if (enrollment.state === "confirmed") continue;
          const resolution = yield* reconcileEnrollment(enrollment);
          if (resolution.provider === "unresolved") {
            return yield* new SavedCardError({
              code: "unavailable",
              cause: "enrollment_still_unresolved",
            });
          }
        }

        const localRows = yield* repository.listActiveContracts(accountId);
        const providerContracts = yield* listProviderContracts(accountId);

        // Every CARD contract goes, regardless of contract type.
        const contractIds = [
          ...new Set([
            ...providerContracts.map((contract) => contract.contractId),
            ...localRows.map((row) => row.providerContractId),
          ]),
        ].sort((a, b) => a.localeCompare(b));

        for (const contractId of contractIds) {
          yield* nexi
            .deactivateContract({
              contractId,
              correlationId: generateCorrelationId(),
            })
            .pipe(
              // Already-deactivated contracts disappear from the provider
              // list, so a retry after a failure naturally resumes with the
              // remainder.
              Effect.catchTag("ExternalAPIError", (cause) =>
                cause.statusCode === 404
                  ? Effect.void
                  : Effect.fail(toSavedCardError(cause))
              ),
              Effect.catchTag("NetworkError", (cause) =>
                Effect.fail(toSavedCardError(cause))
              ),
              Effect.andThen(
                repository.markContractRemoved({
                  customerAccountId: accountId,
                  providerContractId: contractId,
                })
              )
            );
        }

        if (contractIds.length === 0) return;

        const remaining = yield* listProviderContracts(accountId);
        const remainingIds = new Set(
          remaining.map((contract) => contract.contractId)
        );
        if (contractIds.some((contractId) => remainingIds.has(contractId))) {
          return yield* new SavedCardError({
            code: "unavailable",
            cause: "contract_deactivation_unconfirmed",
          });
        }
      });

      return {
        startEnrollment,
        verifyEnrollment,
        reconcileEnrollmentByOrderId,
        cancelEnrollment,
        listCards,
        removeCard,
        deactivateAllForDeletion,
      } satisfies ISavedCardService;
    })
  );
}
