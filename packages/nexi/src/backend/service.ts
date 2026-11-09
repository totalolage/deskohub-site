import {
  Context,
  DateTime,
  Effect,
  Layer,
  Match,
  Option,
  Schema,
} from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import { ExternalAPIError, NetworkError } from "../errors";
import type {
  CreateHostedPaymentPageRequest,
  Operation,
  OrderResponse,
  OrderStatus,
} from "../generated/effect.gen";
import { isNexiRefundOperation } from "../refunds";
import type {
  CreateHostedPaymentPageInput,
  GetNexiOperationInput,
  GetNexiOrderInput,
  ListNexiOperationsInput,
  ListNexiOrdersInput,
  Locale,
  NexiOperation,
  NexiOrder,
  NexiOrderId,
  PaymentOutcomeStatus,
  PaymentVerificationResult,
  VerifyPaymentOutcomeInput,
} from "../types";
import { NexiOperationIdSchema, NexiOrderIdSchema } from "../types";
import { NexiGeneratedClient } from "./api";
import { nexiRetryPolicy } from "./request-policy";

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

const retryTransientNexiFailure =
  nexiRetryPolicy.retryWhile(isRetryableNexiError);

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

      // Never retried: Nexi documents no idempotency key for POST
      // /orders/hpp, and a timeout or 5xx can follow a committed creation.
      // The caller keeps such an attempt unresolved until reconciliation.
      const response = yield* nexiClient
        .createHostedPaymentPage({
          correlationId: input.correlationId,
          payload: request,
        })
        .pipe(
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

  /** The order lookup, retried, and bounded by the input's deadline if any. */
  const lookupPaymentOrder = (input: VerifyPaymentOutcomeInput) => {
    const lookup = nexiClient
      .getOrder({
        correlationId: input.correlationId,
        orderId: input.orderId,
      })
      .pipe(retryTransientNexiFailure);
    if (input.deadline === undefined) return lookup;

    return lookup.pipe(
      Effect.timeoutOrElse({
        duration: input.deadline,
        orElse: () =>
          Effect.fail(
            new NetworkError({
              message: "Nexi order lookup exceeded its deadline",
            })
          ),
      })
    );
  };

  const verifyPaymentOutcome = Effect.fn("verifyPaymentOutcome")(
    function* (input: VerifyPaymentOutcomeInput) {
      yield* Effect.logInfo("Nexi order lookup started");

      const order = yield* lookupPaymentOrder(input).pipe(
        Effect.tapError((error) =>
          Effect.logError("Nexi order lookup failed", { error })
        )
      );

      yield* Effect.logDebug(
        "Nexi order lookup result",
        describeOrderLookup(order)
      );

      const operations = order.operations ?? [];
      const paymentOperations = selectPaymentOperations(operations);
      const evidence = getProviderPaymentEvidence(order, paymentOperations);
      const resolvedProviderOrderId = yield* decodeOptionalOrderId(
        evidence.orderId,
        input.orderId
      );
      const resolvedProviderOperationId = yield* decodeOptionalOperationId(
        evidence.operationId
      );

      yield* Effect.logDebug(
        "Nexi selected payment operations",
        describePaymentOperations(paymentOperations)
      );

      const mismatches = getPaymentMismatches(input, evidence);
      const status = resolvePaymentOutcomeStatus({
        mismatches,
        paymentOperations,
        providerStatus: evidence.status,
      });

      yield* Effect.logDebug("Nexi payment outcome status resolved", {
        mismatches,
        providerStatus: evidence.status,
        status,
      });

      const result = {
        status,
        provider: toProviderPaymentFacts({
          order,
          operations,
          paymentOperations,
          evidence,
          orderId: resolvedProviderOrderId,
          operationId: resolvedProviderOperationId,
        }),
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
        .pipe(retryTransientNexiFailure);
      const orderId = yield* decodeOptionalOrderId(
        getProviderOrderId(response),
        input.orderId
      );
      const operations = yield* Effect.forEach(
        response.operations ?? [],
        (operation) => toNexiOperation(operation, orderId)
      );
      const result: NexiOrder = {
        orderId,
        ...toNexiAmountFields(response.amount ?? response.orderStatus?.order),
        ...toNexiOrderProgress(response.orderStatus ?? {}),
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
        .pipe(retryTransientNexiFailure);
      return yield* Effect.forEach(response.orders ?? [], toNexiOrderStatus);
    },
    (effect, input) =>
      effect.pipe(Effect.annotateLogs({ correlationId: input.correlationId }))
  );

  const getOperation = Effect.fn("NexiService.getOperation")(
    function* (input: GetNexiOperationInput) {
      const response = yield* nexiClient
        .getOperation(input)
        .pipe(retryTransientNexiFailure);
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
        .pipe(retryTransientNexiFailure);
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
  static Default = Layer.effect(this, makeNexiService);

  static Live = this.Default.pipe(
    Layer.provide(NexiGeneratedClient.Default),
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

/** The order ID Nexi reports, from its order status or the response. */
const getProviderOrderId = (order: OrderResponse) =>
  order.orderStatus?.order.orderId ?? order.orderId;

const decodeOptionalOrderId = <Fallback extends NexiOrderId | undefined>(
  orderId: string | undefined,
  fallbackOrderId: Fallback
) => (orderId ? decodeNexiOrderId(orderId) : Effect.succeed(fallbackOrderId));

const decodeOptionalOperationId = (operationId: string | undefined) =>
  operationId ? decodeNexiOperationId(operationId) : Effect.succeed(undefined);

const describeOrderLookup = (order: OrderResponse) => ({
  operationCount: order.operations?.length ?? 0,
  orderId: getProviderOrderId(order),
});

const isExecutedPaymentOperation = (operation: Operation) =>
  isPaymentOperationType(operation.operationType) &&
  operation.operationResult === EXECUTED_OPERATION_RESULT;

// A refund's result describes money going back, not the payment outcome: a
// back-office refund before settlement reports `VOIDED`, which must never
// read as a failed payment.
const isFailedPaymentOperation = (operation: Operation) =>
  !isNexiRefundOperation(operation) &&
  isFailureStatus(operation.operationResult);

/** The first executed payment operation and the first failed one. */
const selectPaymentOperations = (operations: readonly Operation[]) => ({
  executedPaymentOperation: operations.find(isExecutedPaymentOperation),
  failedOperation: operations.find(isFailedPaymentOperation),
});

type PaymentOperations = ReturnType<typeof selectPaymentOperations>;

const describePaymentOperations = ({
  executedPaymentOperation,
  failedOperation,
}: PaymentOperations) => ({
  executedOperationId: executedPaymentOperation?.operationId,
  executedOperationResult: executedPaymentOperation?.operationResult,
  executedOperationType: executedPaymentOperation?.operationType,
  failedOperationId: failedOperation?.operationId,
  failedOperationResult: failedOperation?.operationResult,
  failedOperationType: failedOperation?.operationType,
});

/** The executed payment's amount, else the order's. */
const getProviderPaymentAmount = (
  order: OrderResponse,
  { executedPaymentOperation }: PaymentOperations
) => getOperationAmount(executedPaymentOperation) ?? order.orderStatus?.order;

const getProviderSecurityToken = (
  order: OrderResponse,
  { executedPaymentOperation }: PaymentOperations
) => executedPaymentOperation?.securityToken ?? order.securityToken;

const getDecidingOperationId = ({
  executedPaymentOperation,
  failedOperation,
}: PaymentOperations) =>
  executedPaymentOperation?.operationId ?? failedOperation?.operationId;

/** The executed or failed operation's result, else the last operation type. */
const getProviderPaymentStatus = (
  order: OrderResponse,
  { executedPaymentOperation, failedOperation }: PaymentOperations
) =>
  executedPaymentOperation?.operationResult ??
  failedOperation?.operationResult ??
  order.orderStatus?.lastOperationType;

/** What Nexi reports about the payment, before identifier decoding. */
const getProviderPaymentEvidence = (
  order: OrderResponse,
  paymentOperations: PaymentOperations
) => ({
  amount: getProviderPaymentAmount(order, paymentOperations),
  securityToken: getProviderSecurityToken(order, paymentOperations),
  orderId: getProviderOrderId(order),
  operationId: getDecidingOperationId(paymentOperations),
  status: getProviderPaymentStatus(order, paymentOperations),
});

type ProviderPaymentEvidence = ReturnType<typeof getProviderPaymentEvidence>;

/** The submitted payment facts Nexi's evidence contradicts, in check order. */
const getPaymentMismatches = (
  input: VerifyPaymentOutcomeInput,
  evidence: ProviderPaymentEvidence
) => {
  const mismatches: Array<PaymentVerificationResult["mismatches"][number]> = [];
  if (evidence.orderId !== input.orderId) mismatches.push("orderId");
  if (evidence.amount?.amount !== input.amount) mismatches.push("amount");
  if (evidence.amount?.currency !== input.currency) mismatches.push("currency");
  if (evidence.securityToken && evidence.securityToken !== input.securityToken)
    mismatches.push("securityToken");
  return mismatches;
};

/**
 * Any mismatch fails the payment; otherwise an executed payment succeeds, a
 * failed operation or failure status fails it, and anything else is pending.
 */
const resolvePaymentOutcomeStatus = ({
  mismatches,
  paymentOperations: { executedPaymentOperation, failedOperation },
  providerStatus,
}: {
  readonly mismatches: PaymentVerificationResult["mismatches"];
  readonly paymentOperations: PaymentOperations;
  readonly providerStatus: string | undefined;
}): PaymentOutcomeStatus => {
  if (mismatches.length > 0) return "failure";
  if (executedPaymentOperation) return "success";
  if (failedOperation || isFailureStatus(providerStatus)) return "failure";
  return "pending";
};

const toProviderPaymentFacts = ({
  order,
  operations,
  paymentOperations,
  evidence,
  orderId,
  operationId,
}: {
  readonly order: OrderResponse;
  readonly operations: readonly Operation[];
  readonly paymentOperations: PaymentOperations;
  readonly evidence: ProviderPaymentEvidence;
  readonly orderId: NexiOrderId;
  readonly operationId: NexiOperation["operationId"];
}) => ({
  orderId,
  operationId,
  operationCount: operations.length,
  amount: evidence.amount?.amount,
  currency: evidence.amount?.currency,
  authorizedAmount: order.orderStatus?.authorizedAmount,
  capturedAmount: order.orderStatus?.capturedAmount,
  orderStatus: evidence.status,
  captureExecuted: Boolean(paymentOperations.executedPaymentOperation),
});

/** The amount and currency Nexi reported, omitting the absent ones. */
const toNexiAmountFields = (
  amount:
    | { readonly amount?: string; readonly currency?: string | undefined }
    | undefined
) => ({
  ...(amount?.amount && { amount: amount.amount }),
  ...(amount?.currency && { currency: amount.currency }),
});

/** The order's authorized and captured amounts and its last operation. */
const toNexiOrderProgress = (status: Omit<OrderStatus, "order">) => ({
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
});

/** The operation's channel, type, result, and normalized time. */
const toNexiOperationDetails = (operation: Operation) => ({
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
});

const decodeOperationReferences = Effect.fnUntraced(function* (
  operation: Operation,
  fallbackOrderId: NexiOrderId | undefined
) {
  const orderId = yield* decodeOptionalOrderId(
    operation.orderId,
    fallbackOrderId
  );
  const operationId = yield* decodeOptionalOperationId(operation.operationId);
  const cancelledOperationId = yield* decodeOptionalOperationId(
    operation.cancelledOperationId
  );
  return { orderId, operationId, cancelledOperationId };
});

const toNexiOperation = (
  operation: Operation,
  fallbackOrderId?: NexiOrder["orderId"]
) =>
  decodeOperationReferences(operation, fallbackOrderId).pipe(
    Effect.map(
      ({ orderId, operationId, cancelledOperationId }) =>
        ({
          ...(orderId && { orderId }),
          ...(operationId && { operationId }),
          ...toNexiOperationDetails(operation),
          ...toNexiAmountFields(getOperationAmount(operation)),
          ...(cancelledOperationId && { cancelledOperationId }),
        }) satisfies NexiOperation
    )
  );

const toNexiOrderStatus = (status: OrderStatus) =>
  decodeNexiOrderId(status.order.orderId).pipe(
    Effect.map(
      (orderId): NexiOrder => ({
        orderId,
        amount: status.order.amount,
        currency: status.order.currency,
        ...toNexiOrderProgress(status),
        operations: [],
      })
    )
  );

// XPay read APIs can omit their documented offset and return Rome wall time.
const nexiLocalTimestampPattern =
  /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/;

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
