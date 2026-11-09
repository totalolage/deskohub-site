import { createHash } from "node:crypto";
import { Effect, Result } from "effect";
import type {
  EmailBatchResult,
  EmailMessage,
  EmailSendResult,
} from "../types/email.types";
import {
  continuesEmailChain,
  type EmailBatchOptions,
  type EmailProvider,
  type EmailSendError,
} from "./capabilities";
import {
  type EmailDeliveryObserver,
  observeEmailDelivery,
} from "./email-delivery-observer";
import { type EmailStream, emailCategoryOf } from "./email-providers";
import { NetworkError } from "./network-error";

/** What a chain reports deliveries to. */
export interface EmailChainContext {
  readonly streamOf: (message: EmailMessage) => EmailStream;
  readonly observer: EmailDeliveryObserver;
}

/** Provider logs receive fixed codes and tags, never raw error messages. */
export const emailFailureLogFacts = (error: EmailSendError) => ({
  code:
    error._tag === "NetworkError"
      ? "email.send.transport-retryable"
      : "email.send.rejected",
  errorType: error._tag,
  errorCode: error.code,
  failureKind: error.failureKind,
});

const reportSent = (
  context: EmailChainContext,
  message: EmailMessage,
  result: EmailSendResult
) =>
  observeEmailDelivery(
    context.observer.onSent({
      provider: result.provider,
      deliveryId: result.id,
      stream: context.streamOf(message),
      category: emailCategoryOf(message),
      tags: message.tags ?? [],
      metadata: message.metadata,
      idempotencyKey: message.idempotencyKey,
      at: new Date(),
    })
  );

const reportFallback = (
  context: EmailChainContext,
  message: EmailMessage,
  failed: EmailProvider,
  next: EmailProvider,
  error: EmailSendError
) =>
  observeEmailDelivery(
    context.observer.onFallback({
      stream: context.streamOf(message),
      category: emailCategoryOf(message),
      failedProvider: failed.name,
      nextProvider: next.name,
      errorKind: error._tag,
      errorCode: error.code,
      at: new Date(),
    })
  );

/**
 * Sends one message through the chain: each provider tries it in turn while
 * the previous one failed at the provider level. Fails with the error that
 * ended the chain.
 */
export const sendThroughChain = (
  chain: ReadonlyArray<EmailProvider>,
  message: EmailMessage,
  context: EmailChainContext
): Effect.Effect<EmailSendResult, EmailSendError> => {
  const attempt = (
    index: number
  ): Effect.Effect<EmailSendResult, EmailSendError> => {
    const provider = chain[index]!;
    const next = chain[index + 1];
    return provider.send(message).pipe(
      Effect.catch((error) =>
        next && continuesEmailChain(error)
          ? Effect.logWarning("Email provider failed; trying the next one", {
              ...emailFailureLogFacts(error),
              provider: provider.name,
              nextProvider: next.name,
            }).pipe(
              Effect.andThen(
                reportFallback(context, message, provider, next, error)
              ),
              Effect.andThen(attempt(index + 1))
            )
          : Effect.fail(error)
      )
    );
  };
  return attempt(0).pipe(
    Effect.tap((result) => reportSent(context, message, result))
  );
};

/**
 * The key a later provider sends a fallback subset under: the caller's key
 * for the whole batch, else one derived from the provider's place in the
 * chain and the subset, so a replay of the same subset reuses it.
 */
const fallbackIdempotencyKey = (
  options: EmailBatchOptions,
  providerIndex: number,
  indices: readonly number[],
  batchSize: number
) =>
  indices.length === batchSize
    ? options.idempotencyKey
    : `${options.idempotencyKey}:fallback:${createHash("sha256")
        .update(`${providerIndex}:${indices.join(",")}`)
        .digest("hex")
        .slice(0, 16)}`;

const unmatchedBatchAnswer = (provider: EmailProvider) =>
  new NetworkError({
    message: `${provider.name} answered a batch with a different number of results`,
    code: "batch-size-mismatch",
    failureKind: "unknown-outcome",
  });

/**
 * Sends a batch through the chain. The first provider gets every message
 * under the caller's key; each later provider gets the messages its
 * predecessor failed at the provider level. Results follow the message
 * order. The call fails as a whole only when the first provider failed the
 * whole batch and the chain ends there, as a single provider's batch always
 * did; once a message fell through, every failure comes back per message,
 * so a caller's replay of the batch never repeats a fallback that may have
 * delivered.
 */
export const sendBatchThroughChain = (
  chain: ReadonlyArray<EmailProvider>,
  messages: readonly EmailMessage[],
  options: EmailBatchOptions,
  context: EmailChainContext
): Effect.Effect<readonly EmailBatchResult[], EmailSendError> =>
  Effect.gen(function* () {
    const results: EmailBatchResult[] = [];
    let pending = messages.map((_, index) => index);

    for (const [providerIndex, provider] of chain.entries()) {
      if (pending.length === 0) break;
      const next = chain[providerIndex + 1];
      const outcome = yield* Effect.result(
        provider.sendBatch(
          pending.map((index) => messages[index]!),
          {
            idempotencyKey: fallbackIdempotencyKey(
              options,
              providerIndex,
              pending,
              messages.length
            ),
          }
        )
      );
      const answer = Result.isSuccess(outcome)
        ? outcome.success.length === pending.length
          ? Result.succeed(outcome.success)
          : Result.fail(unmatchedBatchAnswer(provider))
        : outcome;

      if (Result.isFailure(answer)) {
        yield* Effect.logWarning("Email provider failed the batch", {
          ...emailFailureLogFacts(answer.failure),
          provider: provider.name,
          size: pending.length,
        });
        if (
          providerIndex === 0 &&
          (!next || !continuesEmailChain(answer.failure))
        ) {
          return yield* answer.failure;
        }
      }

      const timestamp = new Date();
      const answered: readonly EmailBatchResult[] = Result.isSuccess(answer)
        ? answer.success
        : pending.map(
            (): EmailBatchResult => ({
              status: "failed",
              provider: provider.name,
              timestamp,
              error: answer.failure,
            })
          );

      const fallingThrough: number[] = [];
      for (const [position, index] of pending.entries()) {
        const result = answered[position]!;
        const message = messages[index]!;
        results[index] = result;
        if (result.status !== "failed") {
          yield* reportSent(context, message, result);
        } else if (next && continuesEmailChain(result.error)) {
          fallingThrough.push(index);
          yield* reportFallback(context, message, provider, next, result.error);
        }
      }
      if (next && fallingThrough.length > 0) {
        yield* Effect.logWarning(
          "Email batch messages move to the next provider",
          {
            provider: provider.name,
            nextProvider: next.name,
            size: fallingThrough.length,
          }
        );
      }
      pending = fallingThrough;
    }

    return results;
  });
