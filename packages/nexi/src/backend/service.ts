import { Effect, Schedule } from "effect";
import type { ExternalAPIError, NetworkError } from "../errors";
import type { CreateHostedPaymentPageRequest } from "../generated/types.gen";
import type {
  CreateHostedPaymentPageInput,
  PaymentOutcomeStatus,
  PaymentVerificationResult,
  VerifyPaymentOutcomeInput,
} from "../types";
import { NexiApi } from "./api";

const DEFAULT_PAYMENT_SERVICE = "CARDS";
const DEFAULT_CAPTURE_TYPE = "IMPLICIT";
const DEFAULT_CURRENCY = "CZK";
const CAPTURE_OPERATION_TYPE = "CAPTURE";
const EXECUTED_OPERATION_RESULT = "EXECUTED";

const localeToNexiLanguage = {
  "cs-CZ": "CZE",
  "en-US": "ENG",
} as const;

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

const retryPolicy = Schedule.exponential("100 millis").pipe(
  Schedule.jittered,
  Schedule.intersect(Schedule.recurs(3)),
  Schedule.whileInput<ExternalAPIError | NetworkError>((error) => {
    if (error._tag === "NetworkError") return true;

    if (
      error._tag === "ExternalAPIError" &&
      error.statusCode &&
      error.statusCode >= 500
    ) {
      return true;
    }

    return false;
  })
);

export class NexiService extends Effect.Service<NexiService>()("NexiService", {
  effect: Effect.gen(function* () {
    const api = yield* NexiApi;

    const createHostedPaymentPage = Effect.fn("createHostedPaymentPage")(
      function* (input: CreateHostedPaymentPageInput) {
        const currency = input.currency ?? DEFAULT_CURRENCY;
        const request: CreateHostedPaymentPageRequest = {
          order: {
            orderId: input.orderId,
            amount: {
              amount: input.amount,
              currency,
            },
          },
          paymentSession: {
            amount: {
              amount: input.amount,
              currency,
            },
            language: localeToNexiLanguage[input.locale],
            resultUrl: input.resultUrl,
            cancelUrl: input.cancelUrl,
            notificationUrl: input.notificationUrl,
          },
          paymentService: DEFAULT_PAYMENT_SERVICE,
          captureType: DEFAULT_CAPTURE_TYPE,
        };

        const response = yield* api
          .createHostedPaymentPage({ body: request })
          .pipe(Effect.retry(retryPolicy));

        return {
          orderId: response.orderId ?? input.orderId,
          hostedPage: response.hostedPage,
          securityToken: response.securityToken,
        };
      }
    );

    const verifyPaymentOutcome = Effect.fn("verifyPaymentOutcome")(function* (
      input: VerifyPaymentOutcomeInput
    ) {
      const expectedCurrency = input.currency ?? DEFAULT_CURRENCY;
      const order = yield* api
        .getOrder({ path: { orderId: input.orderId } })
        .pipe(Effect.retry(retryPolicy));

      const captureOperation = order.operations?.find(
        (operation) =>
          operation.operationType === CAPTURE_OPERATION_TYPE &&
          operation.operationResult === EXECUTED_OPERATION_RESULT
      );
      const failedOperation = order.operations?.find((operation) =>
        isFailureStatus(operation.operationResult)
      );
      const providerAmount = captureOperation?.amount ?? order.amount;
      const providerSecurityToken =
        captureOperation?.securityToken ?? order.securityToken;
      const mismatches: PaymentVerificationResult["mismatches"] = [
        ...(order.orderId !== input.orderId ? ["orderId" as const] : []),
        ...(providerAmount?.amount !== input.amount ? ["amount" as const] : []),
        ...(providerAmount?.currency !== expectedCurrency
          ? ["currency" as const]
          : []),
        ...(providerSecurityToken !== input.securityToken
          ? ["securityToken" as const]
          : []),
      ];

      const status: PaymentOutcomeStatus = (() => {
        if (mismatches.length > 0) return "failure";
        if (captureOperation) return "success";
        if (failedOperation || isFailureStatus(order.orderStatus)) {
          return "failure";
        }
        return "pending";
      })();

      return {
        status,
        provider: {
          orderId: order.orderId,
          amount: providerAmount?.amount,
          currency: providerAmount?.currency,
          orderStatus: order.orderStatus,
          captureExecuted: Boolean(captureOperation),
        },
        mismatches,
      };
    });

    return {
      createHostedPaymentPage,
      verifyPaymentOutcome,
    };
  }),
}) {}

const isFailureStatus = (status: string | undefined) =>
  status ? failureOperationResults.has(status.toUpperCase()) : false;
