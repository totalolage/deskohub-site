import { Context, Effect, Layer } from "effect";
import type {
  EmailBatchResult,
  EmailMessage,
  EmailSendResult,
} from "../types/email.types";
import {
  type EmailBatchOptions,
  EmailConfigTag,
  type EmailProvider,
  type EmailSendError,
} from "./capabilities";
import { EmailDeliveryObserver } from "./email-delivery-observer";
import {
  type EmailChainContext,
  emailFailureLogFacts,
  sendBatchThroughChain,
  sendThroughChain,
} from "./email-provider-chain";
import {
  type EmailStream,
  EmailProviders,
  emailCategoryOf,
  emailStreamOf,
} from "./email-providers";
import { addressesOnlyTestRecipients } from "./email-routing";
import { ConsoleEmailProvider } from "./providers/console-provider";

export {
  type EmailBatchOptions,
  EmailConfigTag,
  type EmailProvider,
  type EmailSendError,
  EmailServiceError,
} from "./capabilities";

export interface EmailService {
  readonly send: (
    message: EmailMessage
  ) => Effect.Effect<EmailSendResult, EmailSendError>;
  /**
   * Sends up to 100 messages, each through its stream's provider chain. A
   * retry after an unknown outcome is the caller's: it replays the identical
   * batch under the same idempotency key, and only it knows whether an
   * earlier request may have been accepted. Results follow the message
   * order; a message no provider accepted comes back as an
   * `EmailSendFailure`. The call fails as a whole only when the first
   * provider failed the whole batch and no other provider tried it.
   */
  readonly sendBatch: (
    messages: readonly EmailMessage[],
    options: EmailBatchOptions
  ) => Effect.Effect<readonly EmailBatchResult[], EmailSendError>;
}

export class EmailServiceTag extends Context.Service<
  EmailServiceTag,
  EmailService
>()("EmailService") {
  /**
   * Sends each message through its stream's `EmailProviders` chain; a
   * stream with an empty chain sends through Console.
   */
  static Default = Layer.effect(
    this,
    Effect.suspend(() => makeEmailService({ testRecipientsToConsole: false }))
  );

  /**
   * Like `Default`, and mail addressed only to `EMAIL_TEST_DOMAIN`
   * recipients goes to Console, so automated runs never reach a provider.
   */
  static RecipientRouted = Layer.effect(
    this,
    Effect.suspend(() => makeEmailService({ testRecipientsToConsole: true }))
  );
}

/** Log only non-PII send facts; recipients and rendered bodies stay out. */
const emailSendLogFacts = (message: {
  html?: string;
  text?: string;
  tags?: string[];
}) => ({
  category: emailCategoryOf(message),
  hasHtml: !!message.html,
  hasText: !!message.text,
});

type EmailRoute = "console" | EmailStream;

const routeOrder: readonly EmailRoute[] = [
  "console",
  "transactional",
  "marketing",
];

const consoleChain: ReadonlyArray<EmailProvider> = [ConsoleEmailProvider];

const makeEmailService = (options: {
  readonly testRecipientsToConsole: boolean;
}) =>
  Effect.gen(function* () {
    const providers = yield* EmailProviders;
    const config = yield* EmailConfigTag;
    const observer = yield* EmailDeliveryObserver;

    const streamOf = (message: EmailMessage) =>
      emailStreamOf(message, providers.marketingCategories);
    const context: EmailChainContext = { streamOf, observer };

    const routeOf = (message: EmailMessage): EmailRoute => {
      if (
        options.testRecipientsToConsole &&
        addressesOnlyTestRecipients(message)
      ) {
        return "console";
      }
      const stream = streamOf(message);
      return providers[stream].length > 0 ? stream : "console";
    };
    const chainOf = (route: EmailRoute) =>
      route === "console" ? consoleChain : providers[route];
    const providerNames = (route: EmailRoute) =>
      chainOf(route).map((provider) => provider.name);

    const withDefaultSender = (message: EmailMessage): EmailMessage => ({
      ...message,
      from: message.from || config.defaultFrom,
    });

    const service: EmailService = {
      send: Effect.fn("email.send")(
        function* (message: EmailMessage) {
          const finalMessage = yield* withDeliveryIdempotencyKey(
            withDefaultSender(message)
          );
          const route = routeOf(finalMessage);
          yield* Effect.logInfo("Email send started", {
            providers: providerNames(route),
          });

          return yield* sendThroughChain(
            chainOf(route),
            finalMessage,
            context
          ).pipe(
            Effect.tap((sendResult) =>
              Effect.logInfo("Email sent successfully", {
                id: sendResult.id,
                provider: sendResult.provider,
              })
            ),
            Effect.tapError((error) =>
              Effect.logError("Email send failed", {
                ...emailFailureLogFacts(error),
                provider:
                  error._tag === "EmailServiceError"
                    ? error.provider
                    : undefined,
              })
            )
          );
        },
        (effect, message) =>
          effect.pipe(Effect.annotateLogs(emailSendLogFacts(message)))
      ),

      sendBatch: Effect.fn("email.sendBatch")(
        function* (
          messages: readonly EmailMessage[],
          batchOptions: EmailBatchOptions
        ) {
          const finalMessages = messages.map(withDefaultSender);
          const routes = finalMessages.map(routeOf);
          const groups = routeOrder
            .map((route) => ({
              route,
              indices: routes.flatMap((routed, index) =>
                routed === route ? [index] : []
              ),
            }))
            .filter(({ indices }) => indices.length > 0);
          // Two chains in one batch must not share one provider key.
          const chainGroups = groups.filter(({ route }) => route !== "console");
          const keyOf = (route: EmailRoute) =>
            chainGroups.length > 1
              ? `${batchOptions.idempotencyKey}:${route}`
              : batchOptions.idempotencyKey;

          yield* Effect.logInfo("Email batch send started", {
            size: messages.length,
            providers: groups.map(({ route }) => providerNames(route)),
          });

          const results: EmailBatchResult[] = [];
          for (const { route, indices } of groups) {
            const groupResults = yield* sendBatchThroughChain(
              chainOf(route),
              indices.map((index) => finalMessages[index]!),
              { ...batchOptions, idempotencyKey: keyOf(route) },
              context
            );
            for (const [position, index] of indices.entries()) {
              results[index] = groupResults[position]!;
            }
          }

          yield* Effect.logInfo("Email batch sent", {
            size: results.length,
            failed: results.filter((result) => result.status === "failed")
              .length,
          });
          return results;
        },
        (effect, messages) =>
          effect.pipe(
            Effect.tapError((error) =>
              Effect.logError(
                "Email batch send failed",
                emailFailureLogFacts(error)
              )
            ),
            Effect.annotateLogs({
              category: emailCategoryOf(messages[0] ?? {}),
            })
          )
      ),
    };

    return service;
  });

/**
 * One logical delivery keeps one idempotency key across a provider's
 * transport retries, so a provider that accepted a timed-out attempt does
 * not deliver it twice.
 */
const withDeliveryIdempotencyKey = (message: EmailMessage) =>
  Effect.sync(
    (): EmailMessage => ({
      ...message,
      idempotencyKey:
        message.idempotencyKey ??
        reservationDeliveryIdempotencyKey(message) ??
        `email-delivery-${crypto.randomUUID()}`,
    })
  );

/** A reservation delivery category is sent at most once per reservation. */
const reservationDeliveryIdempotencyKey = (message: EmailMessage) => {
  const workspaceReservationId = message.metadata?.workspaceReservationId;
  const category = emailCategoryOf(message);

  if (
    typeof workspaceReservationId !== "string" ||
    typeof category !== "string"
  ) {
    return undefined;
  }

  return `${category}-${workspaceReservationId}`;
};
