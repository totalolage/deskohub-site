import { Context, Duration, Effect, Layer, Match, Schedule } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import type { ExternalAPIError, NetworkError } from "../errors";
import type {
  CreateHostedPaymentPageRequest,
  OrderResponse,
} from "../generated/effect.gen";
import type {
  CreateHostedPaymentPageInput,
  Locale,
  PaymentOutcomeStatus,
  PaymentVerificationResult,
  VerifyPaymentOutcomeInput,
} from "../types";
import { NexiGeneratedClient } from "./api";

const DEFAULT_PAYMENT_SERVICE = "CARDS";
const DEFAULT_CAPTURE_TYPE = "IMPLICIT";
const DEFAULT_ACTION_TYPE = "PAY";
const AUTHORIZATION_OPERATION_TYPE = "AUTHORIZATION";
const CAPTURE_OPERATION_TYPE = "CAPTURE";
const TERMINAL_OPERATION_TYPES = new Set(["VOID", "REFUND", "CANCEL"]);
const EXECUTED_OPERATION_RESULT = "EXECUTED";

const localeToNexiLanguage: Record<Locale, "CZE" | "ENG"> = {
  "cs-CZ": "CZE",
  "en-US": "ENG",
};

const failureOperationResults = new Set([
  "DECLINED",
  "DENIED_BY_RISK",
  "DENIED",
  "THREEDS_FAILED",
  "FAILED",
  "CANCELED",
]);
const laterTerminalOperationResults = new Set(["VOIDED", "REFUNDED"]);

const isRetryableNexiError = (error: ExternalAPIError | NetworkError) =>
  Match.value(error).pipe(
    Match.tag("NetworkError", () => true),
    Match.tag("ExternalAPIError", (apiError) =>
      Boolean(apiError.statusCode && apiError.statusCode >= 500)
    ),
    Match.orElse(() => false)
  );

const retryPolicy = {
  schedule: Schedule.exponential("100 millis").pipe(
    Schedule.jittered,
    Schedule.while<ExternalAPIError | NetworkError, Duration.Duration>(
      ({ input }) => isRetryableNexiError(input)
    ),
    Schedule.both(Schedule.recurs(3)),
    Schedule.tapOutput(([delay, attempt]) =>
      Effect.logWarning(`Nexi retry attempt #${attempt + 1}`, {
        attemptNumber: attempt + 1,
        delayMs: Duration.toMillis(delay),
        maxRetries: 3,
      })
    )
  ),
};

const getPaymentOutcomeLogAnnotations = (input: VerifyPaymentOutcomeInput) => ({
  orderId: input.orderId,
  correlationId: input.correlationId,
  amount: input.amount,
  currency: input.currency,
});

const makeNexiService = Effect.gen(function* () {
  const nexiClient = yield* NexiGeneratedClient;

  const createHostedPaymentPage = Effect.fn("createHostedPaymentPage")(
    function* (input: CreateHostedPaymentPageInput) {
      const request: CreateHostedPaymentPageRequest = {
        order: {
          orderId: input.orderId,
          amount: input.amount,
          currency: input.currency,
        },
        paymentSession: {
          amount: input.amount,
          language: localeToNexiLanguage[input.locale],
          resultUrl: input.resultUrl,
          cancelUrl: input.cancelUrl,
          notificationUrl: input.notificationUrl,
          paymentService: DEFAULT_PAYMENT_SERVICE,
          captureType: DEFAULT_CAPTURE_TYPE,
          actionType: DEFAULT_ACTION_TYPE,
        },
      };

      yield* Effect.logInfo("Nexi hosted payment page request started");

      const response = yield* nexiClient
        .createHostedPaymentPage({
          correlationId: input.correlationId,
          payload: request,
        })
        .pipe(
          Effect.tapError(() =>
            Effect.logError("Nexi hosted payment page request failed", {
              outcome: "unavailable_or_ambiguous",
            })
          )
        );

      const result = {
        orderId: response.orderId ?? input.orderId,
        hostedPage: response.hostedPage,
        securityToken: response.securityToken,
      };

      yield* Effect.logInfo("Nexi hosted payment page request completed");

      return result;
    },
    (effect) => effect.pipe(Effect.scoped)
  );

  const verifyPaymentOutcome = Effect.fn("verifyPaymentOutcome")(
    function* (input: VerifyPaymentOutcomeInput) {
      yield* Effect.logInfo("Nexi order lookup started");

      const order = yield* nexiClient
        .getOrder({
          correlationId: input.correlationId,
          orderId: input.orderId,
        })
        .pipe(
          Effect.retry(retryPolicy),
          Effect.tapError(() =>
            Effect.logError("Nexi order lookup failed", {
              outcome: "unavailable",
            })
          )
        );

      const evidence = resolvePaymentOutcomeEvidence(input, order);

      yield* Effect.logDebug("Nexi payment outcome status resolved", {
        mismatches: evidence.mismatches,
        providerStatus: evidence.providerStatus,
        status: evidence.status,
      });

      const result = {
        status: evidence.status,
        provider: {
          orderId: evidence.providerOrderId,
          operationId: evidence.providerOperationId,
          operationType: evidence.providerOperationType,
          amount: evidence.providerAmount?.amount,
          currency: evidence.providerAmount?.currency,
          orderStatus: evidence.providerStatus,
          captureExecuted: evidence.captureExecuted,
        },
        mismatches: evidence.mismatches,
      };

      yield* Effect.annotateLogsScoped({
        verificationResult: {
          status: result.status,
          mismatches: result.mismatches,
          hasProviderOperation: Boolean(result.provider.operationId),
        },
      });
      yield* Effect.logInfo("Nexi payment outcome verification completed");

      return result;
    },
    (effect, input) =>
      effect.pipe(
        Effect.annotateLogs(getPaymentOutcomeLogAnnotations(input)),
        Effect.scoped
      )
  );

  return {
    createHostedPaymentPage,
    verifyPaymentOutcome,
  };
});

const NexiFetchHttpClientLive = FetchHttpClient.layer.pipe(
  Layer.provide(
    Layer.succeed(FetchHttpClient.RequestInit, {
      redirect: "error",
    })
  )
);

export class NexiService extends Context.Service<
  NexiService,
  Effect.Success<typeof makeNexiService>
>()("NexiService") {
  static DefaultWithoutDependencies = Layer.effect(this, makeNexiService);
  static Default = this.DefaultWithoutDependencies.pipe(
    Layer.provide(NexiGeneratedClient.Live),
    Layer.provide(NexiFetchHttpClientLive)
  );
}

const isFailureStatus = (status: string | undefined) =>
  status ? failureOperationResults.has(status.toUpperCase()) : false;

const isPaymentOperationType = (operationType: string | undefined) => {
  const normalized = operationType?.toUpperCase();
  return (
    normalized === AUTHORIZATION_OPERATION_TYPE ||
    normalized === CAPTURE_OPERATION_TYPE
  );
};

const resolvePaymentOutcomeEvidence = (
  input: VerifyPaymentOutcomeInput,
  order: OrderResponse
) => {
  const providerOrder = order.orderStatus?.order;
  const paymentOperations = order.operations ?? [];
  const operation =
    paymentOperations.length === 1 ? paymentOperations[0] : null;
  const providerAmount =
    getRepresentativeOperationAmount(operation ?? undefined) ??
    providerOrder ??
    order.amount;
  const providerOrderId =
    providerOrder?.orderId ?? order.orderId ?? input.orderId;
  const providerStatus = operation?.operationResult;
  const mismatches: Array<PaymentVerificationResult["mismatches"][number]> = [];

  addEvidenceMismatch(
    mismatches,
    "orderId",
    [
      providerOrder?.orderId,
      order.orderId,
      ...paymentOperations.map((item) => item.orderId),
    ],
    input.orderId
  );
  addEvidenceMismatch(
    mismatches,
    "amount",
    [
      providerOrder?.amount,
      order.amount?.amount,
      order.orderStatus?.authorizedAmount,
      order.orderStatus?.capturedAmount,
      ...paymentOperations.flatMap((item) => [
        item.amount?.amount,
        item.operationAmount,
      ]),
    ],
    input.amount
  );
  addEvidenceMismatch(
    mismatches,
    "currency",
    [
      providerOrder?.currency,
      order.amount?.currency,
      ...paymentOperations.flatMap((item) => [
        item.amount?.currency,
        item.operationCurrency,
      ]),
    ],
    input.currency
  );

  const securityTokens = [
    order.securityToken,
    ...paymentOperations.map((item) => item.securityToken),
  ].filter((value): value is string => value !== undefined);
  if (
    new Set(securityTokens).size > 1 ||
    (input.securityToken !== undefined &&
      securityTokens.some((value) => value !== input.securityToken))
  ) {
    mismatches.push("securityToken");
  }

  const operationType = operation?.operationType?.toUpperCase();
  const operationResult = operation?.operationResult?.toUpperCase();
  const lastOperationType = order.orderStatus?.lastOperationType?.toUpperCase();
  const operationIsIncomplete =
    paymentOperations.length > 0 &&
    paymentOperations.some(
      (item) =>
        !isPaymentOperationType(item.operationType) ||
        item.operationResult === undefined
    );
  const operationTypeDiverges =
    operationType !== undefined &&
    lastOperationType !== undefined &&
    operationType !== lastOperationType;
  const laterTerminalEvidence =
    TERMINAL_OPERATION_TYPES.has(operationType ?? "") ||
    TERMINAL_OPERATION_TYPES.has(lastOperationType ?? "") ||
    laterTerminalOperationResults.has(operationResult ?? "");
  if (
    paymentOperations.length > 1 ||
    operationIsIncomplete ||
    operationTypeDiverges ||
    laterTerminalEvidence
  ) {
    mismatches.push("operationEvidence");
  }

  const status: PaymentOutcomeStatus = (() => {
    if (mismatches.length > 0) return "manual_review";
    if (operationResult === EXECUTED_OPERATION_RESULT) {
      return "success";
    }
    if (isFailureStatus(operationResult)) {
      return "failure";
    }
    return "pending";
  })();

  return {
    status,
    mismatches,
    providerOrderId,
    providerOperationId: operation?.operationId,
    providerOperationType: operation?.operationType,
    providerAmount,
    providerStatus,
    captureExecuted:
      status === "success" &&
      operation?.operationType === CAPTURE_OPERATION_TYPE,
  };
};

const addEvidenceMismatch = (
  mismatches: Array<PaymentVerificationResult["mismatches"][number]>,
  mismatch: PaymentVerificationResult["mismatches"][number],
  evidence: ReadonlyArray<string | undefined>,
  expected: string | undefined
) => {
  const present = evidence.filter(
    (value): value is string => value !== undefined
  );
  if (
    present.length === 0 ||
    expected === undefined ||
    present.some((value) => value !== expected)
  ) {
    mismatches.push(mismatch);
  }
};

const getRepresentativeOperationAmount = (
  operation:
    | {
        readonly amount?: {
          readonly amount?: string;
          readonly currency?: string;
        };
        readonly operationAmount?: string;
        readonly operationCurrency?: string;
      }
    | undefined
) => {
  if (!operation) return undefined;
  if (operation.amount) return operation.amount;
  if (!operation.operationAmount) return undefined;

  return {
    amount: operation.operationAmount,
    currency: operation.operationCurrency,
  };
};
