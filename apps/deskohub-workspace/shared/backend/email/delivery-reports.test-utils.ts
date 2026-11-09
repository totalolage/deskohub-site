import { mock } from "bun:test";
import { createHmac, randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { Tracer } from "effect";

/**
 * Other suites replace the `resend` module; webhook suites verify real
 * signatures, so they restore the real SDK.
 */
export const restoreRealResendModule = async () => {
  const realResendModule = await import(
    pathToFileURL(createRequire(import.meta.url).resolve("resend")).href
  );
  mock.module("resend", () => realResendModule);
};

/** A synthetic Svix signing secret. */
export const syntheticWebhookSecret = () =>
  `whsec_${randomBytes(24).toString("base64")}`;

const signPayload = (input: {
  readonly secret: string;
  readonly id: string;
  readonly timestamp: string;
  readonly payload: string;
}) => {
  const signingKey = Buffer.from(input.secret.replace(/^whsec_/, ""), "base64");
  return `v1,${createHmac("sha256", signingKey)
    .update(`${input.id}.${input.timestamp}.${input.payload}`)
    .digest("base64")}`;
};

/**
 * A Resend webhook request signed the way Svix signs it. `signature`
 * replaces the valid signature; `headers` replaces the Svix headers.
 */
export const signedResendWebhookRequest = (input: {
  readonly secret: string;
  readonly payload: string;
  readonly signature?: string;
  readonly headers?: Record<string, string>;
}) => {
  const id = `evt-${crypto.randomUUID()}`;
  const timestamp = Math.floor(Date.now() / 1000).toString();
  return {
    eventId: id,
    request: new Request(
      "https://workspace.deskohub.test/api/webhooks/resend",
      {
        method: "POST",
        headers: input.headers ?? {
          "content-type": "application/json",
          "svix-id": id,
          "svix-timestamp": timestamp,
          "svix-signature":
            input.signature ??
            signPayload({
              secret: input.secret,
              id,
              timestamp,
              payload: input.payload,
            }),
        },
        body: input.payload,
      }
    ),
  };
};

/** One Resend email event as the webhook payload carries it. */
export const resendEmailEvent = (input: {
  readonly type: string;
  readonly emailId?: string;
  readonly tags?:
    | readonly { readonly name: string; readonly value: string }[]
    | Record<string, string>;
  readonly createdAt?: string;
}) =>
  JSON.stringify({
    type: input.type,
    created_at: input.createdAt ?? "2026-01-01T12:05:00.000Z",
    data: {
      ...(input.emailId !== undefined && { email_id: input.emailId }),
      ...(input.tags !== undefined && { tags: input.tags }),
    },
  });

/** A tracer that records the name of every span it opens. */
export const spanNameRecorder = () => {
  const names: string[] = [];
  const tracer = Tracer.make({
    span: (options) => {
      names.push(options.name);
      return new Tracer.NativeSpan(options);
    },
  });
  return { tracer, names };
};
