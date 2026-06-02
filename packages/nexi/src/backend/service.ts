import { Effect, Match, Schedule } from "effect";
import type { Writeable } from "zod/v3";
import type { ExternalAPIError, NetworkError } from "../errors";
import type { CreateHostedPaymentPageRequest } from "../generated/types.gen";
import type {
  CreateHostedPaymentPageInput,
  Locale,
  PaymentOutcomeStatus,
  PaymentVerificationResult,
  VerifyPaymentOutcomeInput,
} from "../types";
import { NexiApi } from "./api";

const DEFAULT_PAYMENT_SERVICE = "CARDS";
const DEFAULT_CAPTURE_TYPE = "IMPLICIT";
const DEFAULT_ACTION_TYPE = "PAY";
const AUTHORIZATION_OPERATION_TYPE = "AUTHORIZATION";
const CAPTURE_OPERATION_TYPE = "CAPTURE";
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
  "VOIDED",
  "REFUNDED",
]);

const isRetryableNexiError = (error: ExternalAPIError | NetworkError) =>
  Match.value(error).pipe(
    Match.tag("NetworkError", () => true),
    Match.tag("ExternalAPIError", (apiError) =>
      Boolean(apiError.statusCode && apiError.statusCode >= 500)
    ),
    Match.orElse(() => false)
  );

const retryPolicy = Schedule.exponential("100 millis").pipe(
  Schedule.jittered,
  Schedule.intersect(Schedule.recurs(3)),
  Schedule.whileInput<ExternalAPIError | NetworkError>(isRetryableNexiError)
);

const getPaymentOutcomeLogAnnotations = (input: VerifyPaymentOutcomeInput) => ({
  orderId: input.orderId,
  correlationId: input.correlationId,
  amount: input.amount,
  currency: input.currency,
});

export class NexiService extends Effect.Service<NexiService>()("NexiService", {
  effect: Effect.gen(function* () {
    const api = yield* NexiApi;

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

        const response = yield* api
          .createHostedPaymentPage({
            body: request,
            headers: { "Correlation-Id": input.correlationId },
          })
          .pipe(Effect.retry(retryPolicy));

        return {
          orderId: response.orderId ?? input.orderId,
          hostedPage: response.hostedPage,
          securityToken: response.securityToken,
        };
      },
      (effect, input) => effect.pipe(Effect.annotateLogs({ ...input }))
    );

    const verifyPaymentOutcome = Effect.fn("verifyPaymentOutcome")(
      function* (input: VerifyPaymentOutcomeInput) {
        const order = yield* api
          .getOrder({
            path: { orderId: input.orderId },
            headers: { "Correlation-Id": input.correlationId },
          })
          .pipe(Effect.retry(retryPolicy));

        const providerOrder = order.orderStatus?.order;
        const operations = order.operations ?? [];
        const executedPaymentOperation = operations.find(
          (operation) =>
            isPaymentOperationType(operation.operationType) &&
            operation.operationResult === EXECUTED_OPERATION_RESULT
        );
        const failedOperation = operations.find((operation) =>
          isFailureStatus(operation.operationResult)
        );
        const providerAmount =
          getOperationAmount(executedPaymentOperation) ?? providerOrder;
        const providerSecurityToken =
          executedPaymentOperation?.securityToken ?? order.securityToken;
        const providerOrderId = providerOrder?.orderId ?? order.orderId;
        const providerOperationId =
          executedPaymentOperation?.operationId ?? failedOperation?.operationId;
        const mismatches: Writeable<PaymentVerificationResult["mismatches"]> =
          [];
        if (providerOrderId !== input.orderId) mismatches.push("orderId");
        if (providerAmount?.amount !== input.amount) mismatches.push("amount");
        if (providerAmount?.currency !== input.currency)
          mismatches.push("currency");
        if (
          providerSecurityToken &&
          providerSecurityToken !== input.securityToken
        )
          mismatches.push("securityToken");

        const providerStatus =
          executedPaymentOperation?.operationResult ??
          failedOperation?.operationResult ??
          order.orderStatus?.lastOperationType;

        const status: PaymentOutcomeStatus = (() => {
          if (mismatches.length > 0) return "failure";
          if (executedPaymentOperation) return "success";
          if (failedOperation || isFailureStatus(providerStatus)) {
            return "failure";
          }
          return "pending";
        })();

        return {
          status,
          provider: {
            orderId: providerOrderId ?? input.orderId,
            operationId: providerOperationId,
            amount: providerAmount?.amount,
            currency: providerAmount?.currency,
            orderStatus: providerStatus,
            captureExecuted: Boolean(executedPaymentOperation),
          },
          mismatches,
        };
      },
      (effect, input) =>
        effect.pipe(Effect.annotateLogs(getPaymentOutcomeLogAnnotations(input)))
    );

    return {
      createHostedPaymentPage,
      verifyPaymentOutcome,
    };
  }),
}) {}

const isFailureStatus = (status: string | undefined) =>
  status ? failureOperationResults.has(status.toUpperCase()) : false;

const isPaymentOperationType = (operationType: string | undefined) =>
  operationType === AUTHORIZATION_OPERATION_TYPE ||
  operationType === CAPTURE_OPERATION_TYPE;

const getOperationAmount = (
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
