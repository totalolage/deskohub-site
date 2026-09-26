import { createHash, randomUUID } from "node:crypto";
import {
  type ExternalAPIError,
  type NetworkError,
  type NexiCardContract,
  type NexiContractId,
  NexiContractIdSchema,
  type NexiCorrelationId,
  type NexiCustomerId,
  type NexiOrder,
  type NexiOrderId,
  NexiOrderIdSchema,
  NexiService,
} from "@deskohub/nexi";
import { Context, Data, Effect, Layer, Match } from "effect";
import type { CustomerCardEnrollmentState } from "@/db/schema";
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
import { customerAccountIdSchema } from "../../customer-account";
import {
  SavedCardContractRepository,
  type SavedCardContractRepositoryError,
} from "./saved-card-contract.repository";
import { getSavedCardCustomerReference } from "./saved-card-customer-reference";

const enrollmentFreshness = Temporal.Duration.from({ minutes: 30 });

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

interface ISavedCardService {
  readonly startEnrollment: (
    account: LinkedCustomerAccount,
    locale: Locale
  ) => Effect.Effect<
    SavedCardEnrollmentStartResult,
    SavedCardError | WorkspaceUrlConfigError | SavedCardContractRepositoryError
  >;
  readonly verifyEnrollment: (
    orderId: NexiOrderId,
    presentedSecurityToken?: string
  ) => Effect.Effect<
    SavedCardEnrollmentOutcome,
    SavedCardError | SavedCardContractRepositoryError
  >;
  readonly cancelEnrollment: (
    orderId: NexiOrderId
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
      Layer.mergeAll(WorkspaceNexiLayer, SavedCardContractRepository.Live)
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

const findAuthorizedCardVerification = (order: NexiOrder) =>
  order.operations.find(
    (operation) =>
      operation.operationType === "CARD_VERIFICATION" &&
      operation.operationResult?.toUpperCase() ===
        authorizedVerificationResult &&
      operation.amount === getVerificationAmount &&
      (operation.orderId ?? order.orderId) === order.orderId
  );

const findTerminalCardVerification = (
  order: NexiOrder
): "cancelled" | "failed" | undefined => {
  for (const operation of order.operations) {
    if (operation.operationType !== "CARD_VERIFICATION") continue;
    const result = operation.operationResult?.toUpperCase();
    if (result && cancelledVerificationResults.has(result)) return "cancelled";
    if (result && failedVerificationResults.has(result)) return "failed";
  }
  return undefined;
};

function makeSavedCardServiceLayer(service: typeof SavedCardService) {
  return Layer.effect(
    service,
    Effect.gen(function* () {
      const nexi = yield* NexiService;
      const repository = yield* SavedCardContractRepository;

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

          // A stale pending enrollment from an abandoned session must not block
          // a new attempt: it is superseded, a fresh one may reuse its slot.
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
              contractEnrollment: { contractId, contractType: "CIT" },
              actionType: "VERIFY",
            })
            .pipe(
              Effect.catch((cause: ExternalAPIError | NetworkError) =>
                handleEnrollmentCreateFailure(cause, orderId, account.accountId)
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
        }
      );

      const confirmEnrollment = Effect.fn("SavedCardService.confirmEnrollment")(
        function* (enrollment: {
          orderId: NexiOrderId;
          customerAccountId: CustomerAccountId;
          providerCustomerId: NexiCustomerId;
          providerContractId: NexiContractId;
        }) {
          const correlationId = generateCorrelationId();
          const contracts = yield* nexi
            .listCustomerContracts({
              customerId: enrollment.providerCustomerId,
              correlationId,
            })
            .pipe(Effect.mapError(toSavedCardError));
          const providerEntry = contracts.find(
            (contract) => contract.contractId === enrollment.providerContractId
          );
          // The provider list is the confirmation authority: without the
          // contract there, verification stays pending and can be retried.
          if (!providerEntry) return "pending" as const;

          yield* repository.upsertActiveContract({
            customerAccountId: enrollment.customerAccountId,
            providerCustomerId: enrollment.providerCustomerId,
            providerContractId: enrollment.providerContractId,
            displayCircuit: providerEntry.circuit,
            displaySuffix: providerEntry.maskedInstrumentSuffix,
          });
          yield* repository.transitionEnrollment({
            orderId: enrollment.orderId,
            customerAccountId: enrollment.customerAccountId,
            state: "confirmed",
          });
          return "confirmed" as const;
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

      const verifyEnrollment = Effect.fn("SavedCardService.verifyEnrollment")(
        function* (orderId: NexiOrderId, presentedSecurityToken?: string) {
          const enrollment = yield* repository.findEnrollmentByOrderId(orderId);
          // Unknown orders and presented-token mismatches collapse into the
          // same non-committal outcome so nothing about existing enrollments
          // can be probed.
          if (!enrollment) return "not_found";

          if (enrollment.state !== "pending") {
            return enrollment.state satisfies CustomerCardEnrollmentState as SavedCardEnrollmentOutcome;
          }

          if (
            presentedSecurityToken !== undefined &&
            sha256Hex(presentedSecurityToken) !== enrollment.securityTokenDigest
          ) {
            return "not_found";
          }

          const order = yield* nexi
            .getOrder({
              orderId: enrollment.orderId,
              correlationId: generateCorrelationId(),
            })
            .pipe(Effect.mapError(toSavedCardError));

          if (order.orderId !== enrollment.orderId) return "not_found";

          const authorized = findAuthorizedCardVerification(order);
          if (authorized) {
            return yield* confirmEnrollment({
              orderId: enrollment.orderId,
              customerAccountId: toAccountId(enrollment.customerAccountId),
              providerCustomerId: enrollment.providerCustomerId,
              providerContractId: enrollment.providerContractId,
            });
          }

          const terminal = findTerminalCardVerification(order);
          if (terminal) {
            return yield* failEnrollment(terminal)({
              orderId: enrollment.orderId,
              customerAccountId: toAccountId(enrollment.customerAccountId),
            });
          }

          return "pending";
        }
      );

      const cancelEnrollment = Effect.fn("SavedCardService.cancelEnrollment")(
        function* (orderId: NexiOrderId) {
          const verified = yield* verifyEnrollment(orderId);
          if (verified !== "pending") return verified;

          const enrollment = yield* repository.findEnrollmentByOrderId(orderId);
          if (enrollment?.state !== "pending") return "not_found";

          return yield* failEnrollment("cancelled")({
            orderId: enrollment.orderId,
            customerAccountId: toAccountId(enrollment.customerAccountId),
          });
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
        const [localRows, providerContracts] = yield* Effect.all([
          repository.listActiveContracts(account.accountId),
          listProviderContracts(account.accountId),
        ]);

        const providerById = new Map(
          providerContracts.map((contract) => [contract.contractId, contract])
        );

        const views: SavedCardView[] = [];
        for (const row of localRows) {
          const providerEntry = providerById.get(row.providerContractId);
          if (!providerEntry) {
            // The provider no longer returns the contract: the local row is
            // stale and must disappear from the customer's view.
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
        const localRows = yield* repository.listActiveContracts(accountId);
        const providerContracts = yield* listProviderContracts(accountId);

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
        cancelEnrollment,
        listCards,
        removeCard,
        deactivateAllForDeletion,
      } satisfies ISavedCardService;
    })
  );
}
