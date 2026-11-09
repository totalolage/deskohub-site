import { Effect, Layer } from "effect";
import {
  EmailDeliveryIdSchema,
  type EmailMessage,
  type EmailSendResult,
} from "../types/email.types";
import {
  type EmailProvider,
  type EmailSendError,
  EmailServiceError,
} from "./capabilities";
import { EmailProviders } from "./email-providers";
import { NetworkError } from "./network-error";

/**
 * How the provider answers a fresh request. Accepted keys always replay.
 * `refuse` is a message-level refusal that stops a provider chain;
 * `unavailable` is a provider-level refusal (a quota or throttling 429) that
 * moves the message to the next provider.
 */
export type EmailProviderFakeResponse =
  | "accept"
  | "accept-lost"
  | "refuse"
  | "unavailable"
  | "accept-hang"
  | "hang";

export interface EmailProviderFakeOptions {
  /** The provider name results carry; `resend` by default. */
  readonly name?: string;
  /**
   * Without attachment support, a message with attachments is refused at
   * the message level before any request, as a real provider reports it.
   */
  readonly sendsAttachments?: boolean;
}

/**
 * Idempotent delivery with injectable refusal, response loss, and
 * interruption. `layer` provides it as the only provider of both streams;
 * compose several fakes into `EmailProviders` to test a chain.
 */
export const makeEmailProviderFake = ({
  name = "resend",
  sendsAttachments = true,
}: EmailProviderFakeOptions = {}) => {
  const accepted = {
    send: new Map<
      string,
      { payload: string; results: readonly EmailSendResult[] }
    >(),
    sendBatch: new Map<
      string,
      { payload: string; results: readonly EmailSendResult[] }
    >(),
  };
  const requests: { readonly key: string; readonly to: string[] }[] = [];
  const mailed: string[] = [];
  const subjects: { readonly to: string; readonly subject: string }[] = [];
  let respond: (key: string) => EmailProviderFakeResponse = () => "accept";
  let reached: () => void = () => {};
  let beforeRequest: () => Promise<void> = () => Promise.resolve();
  const fakeId = crypto.randomUUID();
  let nextId = 0;

  const recipientsOf = (messages: readonly EmailMessage[]) =>
    messages.flatMap((message) => [message.to].flat().map((to) => to.email));

  const refuseAttachments = (messages: readonly EmailMessage[]) =>
    !sendsAttachments && messages.some((message) => message.attachments?.length)
      ? Effect.fail(
          new EmailServiceError(
            "Provider cannot send attachments",
            undefined,
            name,
            { failureKind: "message", code: "attachments-unsupported" }
          )
        )
      : Effect.void;

  const request = (
    operation: keyof typeof accepted,
    messages: readonly EmailMessage[],
    key?: string
  ) =>
    refuseAttachments(messages).pipe(
      Effect.andThen(Effect.promise(() => beforeRequest())),
      Effect.andThen(
        Effect.suspend(
          (): Effect.Effect<readonly EmailSendResult[], EmailSendError> => {
            // A direct unkeyed send is a fresh delivery each time it executes.
            const requestKey = key ?? crypto.randomUUID();
            requests.push({ key: requestKey, to: recipientsOf(messages) });
            reached();
            const earlier = accepted[operation].get(requestKey);
            const response = earlier ? "accept" : respond(requestKey);
            if (response === "refuse") {
              return Effect.fail(
                new EmailServiceError(
                  "Invalid email request",
                  undefined,
                  name,
                  {
                    failureKind: "message",
                    code: "http-422",
                  }
                )
              );
            }
            if (response === "unavailable") {
              return Effect.fail(
                new EmailServiceError("Provider unavailable", undefined, name, {
                  failureKind: "provider",
                  code: "http-429",
                })
              );
            }
            if (response === "hang") return Effect.never;
            const payload = JSON.stringify(messages);
            if (earlier && earlier.payload !== payload) {
              return Effect.fail(
                new NetworkError({ message: "invalid_idempotent_request" })
              );
            }
            const results =
              earlier?.results ??
              messages.map(
                (): EmailSendResult => ({
                  id: EmailDeliveryIdSchema.make(
                    `${name}-fake-${fakeId}-${++nextId}`
                  ),
                  status: "sent",
                  provider: name,
                  timestamp: new Date(),
                })
              );
            if (!earlier) {
              accepted[operation].set(requestKey, { payload, results });
              mailed.push(...recipientsOf(messages));
              for (const message of messages) {
                for (const to of [message.to].flat()) {
                  subjects.push({ to: to.email, subject: message.subject });
                }
              }
            }
            if (response === "accept-hang") return Effect.never;
            if (response === "accept-lost") {
              return Effect.fail(
                new NetworkError({ message: "response lost" })
              );
            }
            return Effect.succeed(results);
          }
        )
      )
    );

  const provider: EmailProvider = {
    name,
    send: (message) =>
      request("send", [message], message.idempotencyKey).pipe(
        Effect.map((results) => results[0]!)
      ),
    sendBatch: (messages, options) =>
      request("sendBatch", messages, options.idempotencyKey),
  };

  return {
    provider,
    layer: Layer.succeed(EmailProviders, {
      transactional: [provider],
      marketing: [provider],
      marketingCategories: new Set<string>(),
    }),
    /** Every request, replays included, in order. */
    requests: () => [...requests],
    /** Every To address accepted for delivery. */
    mailed: () => [...mailed],
    subjects: () => [...subjects],
    respondWith: (next: (key: string) => EmailProviderFakeResponse) => {
      respond = next;
    },
    beforeEachRequest: (check: () => Promise<void>) => {
      beforeRequest = check;
    },
    nextRequest: () =>
      new Promise<void>((resolve) => {
        reached = () => {
          reached = () => {};
          resolve();
        };
      }),
  };
};
