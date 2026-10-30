import { Effect, Layer } from "effect";
import {
  EmailDeliveryIdSchema,
  type EmailMessage,
  type EmailSendResult,
} from "../types/email.types";
import {
  type EmailProvider,
  EmailProviderTag,
  type EmailSendError,
  EmailServiceError,
} from "./capabilities";
import { NetworkError } from "./network-error";

/** How the provider answers a fresh request. Accepted keys always replay. */
export type EmailProviderFakeResponse =
  | "accept"
  | "accept-lost"
  | "refuse"
  | "accept-hang"
  | "hang";

/** Idempotent delivery with injectable refusal, response loss, and interruption. */
export const makeEmailProviderFake = () => {
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

  const request = (
    operation: keyof typeof accepted,
    messages: readonly EmailMessage[],
    key?: string
  ) =>
    Effect.promise(() => beforeRequest()).pipe(
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
                new EmailServiceError("Invalid email request")
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
                    `resend-fake-${fakeId}-${++nextId}`
                  ),
                  status: "sent",
                  provider: "resend",
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
    name: "resend",
    send: (message) =>
      request("send", [message], message.idempotencyKey).pipe(
        Effect.map((results) => results[0]!)
      ),
    sendBatch: (messages, options) =>
      request("sendBatch", messages, options.idempotencyKey),
  };

  return {
    provider,
    layer: Layer.succeed(EmailProviderTag, provider),
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
