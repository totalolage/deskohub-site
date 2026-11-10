import { createHmac, randomBytes } from "node:crypto";

/** A random signing secret in the Standard Webhooks `whsec_` format. */
export const standardWebhookSigningSecret = () =>
  `whsec_${randomBytes(24).toString("base64")}`;

/**
 * A POST request signed as a Standard Webhooks sender signs it: a `v1`
 * HMAC-SHA256 of `{id}.{timestamp}.{body}` under the secret's base64 key.
 * `headers` overrides or, with `undefined`, removes a signature header.
 */
export const signedStandardWebhookRequest = (input: {
  readonly url: string;
  readonly secret: string;
  readonly body: string;
  readonly id?: string;
  readonly signedAt?: Date;
  readonly headers?: Readonly<Record<string, string | undefined>>;
}) => {
  const id = input.id ?? `msg_${randomBytes(12).toString("hex")}`;
  const timestamp = Math.floor((input.signedAt ?? new Date()).getTime() / 1000);
  const key = Buffer.from(input.secret.replace(/^whsec_/, ""), "base64");
  const signature = createHmac("sha256", key)
    .update(`${id}.${timestamp}.${input.body}`)
    .digest("base64");

  const headers = Object.entries({
    "content-type": "application/json",
    "webhook-id": id,
    "webhook-timestamp": String(timestamp),
    "webhook-signature": `v1,${signature}`,
    ...input.headers,
  }).filter((entry): entry is [string, string] => entry[1] !== undefined);

  return new Request(input.url, {
    method: "POST",
    headers,
    body: input.body,
  });
};
