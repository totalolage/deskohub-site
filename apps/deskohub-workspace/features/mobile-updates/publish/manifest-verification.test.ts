import { describe, expect, test } from "bun:test";
import { createSign, generateKeyPairSync } from "node:crypto";
import { Effect } from "effect";
import { serializeDictionary } from "structured-headers";
import { encodeMultipartMixed } from "@/shared/utils/multipart-mixed";
import { verifyManifestReply } from "./manifest-verification";

const appKeys = generateKeyPairSync("rsa", { modulusLength: 2048 });
const otherKeys = generateKeyPairSync("rsa", { modulusLength: 2048 });

const publishedId = "0d0b4c39-8e5e-4a43-9b8c-6a2f2b7d9e11";

const manifest = (id: string) => ({
  part: "manifest",
  body: { id, createdAt: "2026-11-07T10:00:00.000Z", runtimeVersion: "rv" },
});
const directive = (type: string) => ({ part: "directive", body: { type } });

/** An update check reply, framed and signed the way the protocol frames it. */
const reply = (
  { part, body }: { readonly part: string; readonly body: object },
  signing: {
    readonly key?: typeof appKeys.privateKey;
    readonly keyid?: string;
  } = {}
) => {
  const { key = appKeys.privateKey, keyid = "main" } = signing;
  const text = JSON.stringify(body);
  const sig = createSign("RSA-SHA256").update(text, "utf8").sign(key, "base64");
  return encodeMultipartMixed([
    {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `form-data; name="${part}"`,
        "expo-signature": serializeDictionary({
          sig,
          keyid,
          alg: "rsa-v1_5-sha256",
        }),
      },
      body: text,
    },
    {
      headers: {
        "content-type": "application/json",
        "content-disposition": 'form-data; name="extensions"',
      },
      body: "{}",
    },
  ]);
};

const verify = (
  served: { readonly contentType: string; readonly body: string },
  expected: Parameters<typeof verifyManifestReply>[1]
) =>
  Effect.runPromise(
    Effect.result(verifyManifestReply(served, expected, appKeys.publicKey))
  );

describe("verifying a published update's manifest", () => {
  test("accepts the published manifest signed with the app's key", async () => {
    const result = await verify(reply(manifest(publishedId)), {
      type: "update",
      id: publishedId,
    });

    expect(result._tag).toBe("Success");
  });

  test("accepts the rollback directive signed with the app's key", async () => {
    const result = await verify(reply(directive("rollBackToEmbedded")), {
      type: "rollBackToEmbedded",
    });

    expect(result._tag).toBe("Success");
  });

  test.each([
    { case: "manifest", served: reply(manifest(publishedId)) },
    { case: "directive", served: reply(directive("noUpdateAvailable")) },
  ])(
    "accepts any $case signed with the app's key before publishing",
    async ({ served }) => {
      expect((await verify(served, { type: "any" }))._tag).toBe("Success");
    }
  );

  test("rejects any reply signed with another key before publishing", async () => {
    const result = await verify(
      reply(directive("noUpdateAvailable"), { key: otherKeys.privateKey }),
      { type: "any" }
    );

    expect(result).toMatchObject({
      _tag: "Failure",
      failure: { _tag: "ManifestReplyUnverified" },
    });
  });

  test.each([
    {
      case: "signed with another key",
      served: reply(manifest(publishedId), { key: otherKeys.privateKey }),
    },
    {
      case: "signed for another certificate",
      served: reply(manifest(publishedId), { keyid: "other" }),
    },
    {
      case: "another update's manifest",
      served: reply(manifest("7a1f6f0e-2c5d-4f7b-8e3a-1b2c3d4e5f60")),
    },
    {
      case: "a directive instead of the manifest",
      served: reply(directive("noUpdateAvailable")),
    },
  ])("rejects $case", async ({ served }) => {
    const result = await verify(served, { type: "update", id: publishedId });

    expect(result).toMatchObject({
      _tag: "Failure",
      failure: { _tag: "ManifestReplyUnverified" },
    });
  });

  test("rejects a reply without a signature", async () => {
    const { contentType, body } = reply(manifest(publishedId));
    const unsigned = body.replace(/expo-signature: .*\r\n/, "");

    const result = await verify(
      { contentType, body: unsigned },
      { type: "update", id: publishedId }
    );

    expect(result).toMatchObject({
      _tag: "Failure",
      failure: { _tag: "ManifestReplyUnverified" },
    });
  });

  test("rejects a manifest when a rollback was published", async () => {
    const result = await verify(reply(manifest(publishedId)), {
      type: "rollBackToEmbedded",
    });

    expect(result).toMatchObject({
      _tag: "Failure",
      failure: { _tag: "ManifestReplyUnverified" },
    });
  });
});
