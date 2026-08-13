import {
  Context,
  DateTime,
  Duration,
  Effect,
  Layer,
  Match,
  Option,
  Schedule,
  Schema,
} from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import { ExternalAPIError, type NetworkError } from "../errors";
import type {
  CreateHostedPaymentPageRequest,
  Operation,
  OrderStatus,
} from "../generated/effect.gen";
import type {
  CreateHostedPaymentPageInput,
  GetNexiOperationInput,
  GetNexiOrderInput,
  ListNexiOperationsInput,
  ListNexiOrdersInput,
  Locale,
  NexiOperation,
  NexiOrder,
  PaymentOutcomeStatus,
  PaymentVerificationResult,
  VerifyPaymentOutcomeInput,
} from "../types";
import { NexiOperationIdSchema, NexiOrderIdSchema } from "../types";
import { NexiGeneratedClient } from "./api";

const DEFAULT_PAYMENT_SERVICE = "CARDS";
const DEFAULT_CAPTURE_TYPE = "IMPLICIT";
const DEFAULT_ACTION_TYPE = "PAY";
const AUTHORIZATION_OPERATION_TYPE = "AUTHORIZATION";
const CAPTURE_OPERATION_TYPE = "CAPTURE";
const EXECUTED_OPERATION_RESULT = "EXECUTED";

const decodeProviderIdentifier = <A>(
  schema: Schema.Decoder<A>,
  operation: string
) =>
  Effect.fn(operation)((value: unknown) =>
    Schema.decodeUnknownEffect(schema)(value).pipe(
      Effect.mapError(
        (cause) =>
          new ExternalAPIError({
            service: "Nexi",
            operation,
            message: "Nexi returned a malformed identifier.",
            cause,
          })
      )
    )
  );

const decodeNexiOrderId = decodeProviderIdentifier(
  NexiOrderIdSchema,
  "NexiService.decodeOrderId"
);
const decodeNexiOperationId = decodeProviderIdentifier(
  NexiOperationIdSchema,
  "NexiService.decodeOperationId"
);

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

const getHostedPaymentPageLogAnnotations = (
  input: CreateHostedPaymentPageInput
) => ({
  orderId: input.orderId,
  correlationId: input.correlationId,
  amount: input.amount,
  currency: input.currency,
  locale: input.locale,
  hasCustomerId: Boolean(input.customer?.id),
  hasCustomerEmail: Boolean(input.customer?.email),
  hasCustomerPhone: Boolean(input.customer?.mobilePhone),
});

const makeNexiService = Effect.gen(function* () {
  const nexiClient = yield* NexiGeneratedClient;

  const createHostedPaymentPage = Effect.fn("createHostedPaymentPage")(
    function* (input: CreateHostedPaymentPageInput) {
      yield* Effect.annotateLogsScoped(
        getHostedPaymentPageLogAnnotations(input)
      );

      const request: CreateHostedPaymentPageRequest = {
        order: {
          orderId: input.orderId,
          amount: input.amount,
          currency: input.currency,
          ...(input.customer && {
            customerId: input.customer.id,
            customerInfo: {
              cardHolderName: input.customer.name,
              cardHolderEmail: input.customer.email,
              ...(input.customer.mobilePhone && {
                mobilePhoneCountryCode:
                  input.customer.mobilePhone.countryCallingCode,
                mobilePhone: input.customer.mobilePhone.nationalNumber,
              }),
            },
          }),
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
          Effect.retry(retryPolicy),
          Effect.tapError((error) =>
            Effect.logError("Nexi hosted payment page request failed", {
              error,
            })
          )
        );

      yield* Effect.annotateLogsScoped({
        providerOrderId: response.orderId ?? input.orderId,
      });

      const orderId = response.orderId
        ? yield* decodeNexiOrderId(response.orderId)
        : input.orderId;
      const result = {
        orderId,
        hostedPage: response.hostedPage,
        securityToken: response.securityToken,
      };

      yield* Effect.logInfo("Nexi hosted payment page request completed");

      return result;
    },
    (effect, input) =>
      effect.pipe(
        Effect.annotateLogs(getHostedPaymentPageLogAnnotations(input)),
        Effect.scoped
      )
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
          Effect.tapError((error) =>
            Effect.logError("Nexi order lookup failed", { error })
          )
        );

      yield* Effect.logDebug("Nexi order lookup result", {
        operationCount: order.operations?.length ?? 0,
        orderId: order.orderStatus?.order.orderId ?? order.orderId,
      });

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
      const resolvedProviderOrderId = providerOrderId
        ? yield* decodeNexiOrderId(providerOrderId)
        : input.orderId;
      const resolvedProviderOperationId = providerOperationId
        ? yield* decodeNexiOperationId(providerOperationId)
        : undefined;

      yield* Effect.logDebug("Nexi selected payment operations", {
        executedOperationId: executedPaymentOperation?.operationId,
        executedOperationResult: executedPaymentOperation?.operationResult,
        executedOperationType: executedPaymentOperation?.operationType,
        failedOperationId: failedOperation?.operationId,
        failedOperationResult: failedOperation?.operationResult,
        failedOperationType: failedOperation?.operationType,
      });

      const mismatches: Array<PaymentVerificationResult["mismatches"][number]> =
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

      yield* Effect.logDebug("Nexi payment outcome status resolved", {
        mismatches,
        providerStatus,
        status,
      });

      const result = {
        status,
        provider: {
          orderId: resolvedProviderOrderId,
          operationId: resolvedProviderOperationId,
          operationCount: operations.length,
          amount: providerAmount?.amount,
          currency: providerAmount?.currency,
          authorizedAmount: order.orderStatus?.authorizedAmount,
          capturedAmount: order.orderStatus?.capturedAmount,
          orderStatus: providerStatus,
          captureExecuted: Boolean(executedPaymentOperation),
        },
        mismatches,
      };

      yield* Effect.annotateLogsScoped({ result });
      yield* Effect.logInfo("Nexi payment outcome verification completed");

      return result;
    },
    (effect, input) =>
      effect.pipe(
        Effect.annotateLogs(getPaymentOutcomeLogAnnotations(input)),
        Effect.scoped
      )
  );

  const getOrder = Effect.fn("NexiService.getOrder")(
    function* (input: GetNexiOrderInput) {
      yield* Effect.logInfo("Nexi order details lookup started", {
        orderId: input.orderId,
      });
      const response = yield* nexiClient
        .getOrder(input)
        .pipe(Effect.retry(retryPolicy));
      const providerOrder = response.orderStatus?.order;
      const rawOrderId = providerOrder?.orderId ?? response.orderId;
      const orderId = rawOrderId
        ? yield* decodeNexiOrderId(rawOrderId)
        : input.orderId;
      const operations = yield* Effect.forEach(
        response.operations ?? [],
        (operation) => toNexiOperation(operation, orderId)
      );
      const amount = response.amount ?? providerOrder;
      const result: NexiOrder = {
        orderId,
        ...(amount?.amount && { amount: amount.amount }),
        ...(amount?.currency && { currency: amount.currency }),
        ...(response.orderStatus?.authorizedAmount && {
          authorizedAmount: response.orderStatus.authorizedAmount,
        }),
        ...(response.orderStatus?.capturedAmount && {
          capturedAmount: response.orderStatus.capturedAmount,
        }),
        ...(response.orderStatus?.lastOperationTime && {
          lastOperationTime: normalizeNexiTimestamp(
            response.orderStatus.lastOperationTime
          ),
        }),
        ...(response.orderStatus?.lastOperationType && {
          lastOperationType: response.orderStatus.lastOperationType,
        }),
        operations,
      };
      yield* Effect.logInfo("Nexi order details lookup completed", {
        operationCount: operations.length,
        orderId,
      });
      return result;
    },
    (effect, input) =>
      effect.pipe(
        Effect.annotateLogs({
          correlationId: input.correlationId,
          orderId: input.orderId,
        })
      )
  );

  const listOrders = Effect.fn("NexiService.listOrders")(
    function* (input: ListNexiOrdersInput) {
      const response = yield* nexiClient
        .listOrders(input)
        .pipe(Effect.retry(retryPolicy));
      return yield* Effect.forEach(response.orders ?? [], toNexiOrderStatus);
    },
    (effect, input) =>
      effect.pipe(Effect.annotateLogs({ correlationId: input.correlationId }))
  );

  const getOperation = Effect.fn("NexiService.getOperation")(
    function* (input: GetNexiOperationInput) {
      const response = yield* nexiClient
        .getOperation(input)
        .pipe(Effect.retry(retryPolicy));
      return yield* toNexiOperation(response);
    },
    (effect, input) =>
      effect.pipe(
        Effect.annotateLogs({
          correlationId: input.correlationId,
          operationId: input.operationId,
        })
      )
  );

  const listOperations = Effect.fn("NexiService.listOperations")(
    function* (input: ListNexiOperationsInput) {
      const response = yield* nexiClient
        .listOperations(input)
        .pipe(Effect.retry(retryPolicy));
      return yield* Effect.forEach(response.operations ?? [], (operation) =>
        toNexiOperation(operation)
      );
    },
    (effect, input) =>
      effect.pipe(Effect.annotateLogs({ correlationId: input.correlationId }))
  );

  return {
    createHostedPaymentPage,
    getOperation,
    getOrder,
    listOperations,
    listOrders,
    verifyPaymentOutcome,
  };
});

export class NexiService extends Context.Service<
  NexiService,
  Effect.Success<typeof makeNexiService>
>()("NexiService") {
  static DefaultWithoutDependencies = Layer.effect(this, makeNexiService);
  static Default = this.DefaultWithoutDependencies.pipe(
    Layer.provide(NexiGeneratedClient.Live),
    Layer.provide(FetchHttpClient.layer)
  );
}

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

const toNexiOperation = (
  operation: Operation,
  fallbackOrderId?: NexiOrder["orderId"]
) =>
  Effect.gen(function* () {
    const amount = getOperationAmount(operation);
    const orderId = operation.orderId
      ? yield* decodeNexiOrderId(operation.orderId)
      : fallbackOrderId;
    const operationId = operation.operationId
      ? yield* decodeNexiOperationId(operation.operationId)
      : undefined;
    const cancelledOperationId = operation.cancelledOperationId
      ? yield* decodeNexiOperationId(operation.cancelledOperationId)
      : undefined;
    return {
      ...(orderId && { orderId }),
      ...(operationId && { operationId }),
      ...(operation.channel && { channel: operation.channel }),
      ...(operation.operationType && {
        operationType: operation.operationType,
      }),
      ...(operation.operationResult && {
        operationResult: operation.operationResult,
      }),
      ...(operation.operationTime && {
        operationTime: normalizeNexiTimestamp(operation.operationTime),
      }),
      ...(amount?.amount && { amount: amount.amount }),
      ...(amount?.currency && { currency: amount.currency }),
      ...(cancelledOperationId && { cancelledOperationId }),
    } satisfies NexiOperation;
  });

const toNexiOrderStatus = (status: OrderStatus) =>
  decodeNexiOrderId(status.order.orderId).pipe(
    Effect.map(
      (orderId): NexiOrder => ({
        orderId,
        amount: status.order.amount,
        currency: status.order.currency,
        ...(status.authorizedAmount && {
          authorizedAmount: status.authorizedAmount,
        }),
        ...(status.capturedAmount && {
          capturedAmount: status.capturedAmount,
        }),
        ...(status.lastOperationTime && {
          lastOperationTime: normalizeNexiTimestamp(status.lastOperationTime),
        }),
        ...(status.lastOperationType && {
          lastOperationType: status.lastOperationType,
        }),
        operations: [],
      })
    )
  );

// XPay read APIs can omit their documented offset and return Rome wall time.
const nexiLocalTimestampPattern =
  /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}$/;

const normalizeNexiTimestamp = (value: string) => {
  if (!nexiLocalTimestampPattern.test(value)) return value;

  return Option.match(
    DateTime.makeZoned(value.replace(" ", "T"), {
      timeZone: "Europe/Rome",
      adjustForTimeZone: true,
    }),
    {
      onNone: () => value,
      onSome: DateTime.formatIso,
    }
  );
};
