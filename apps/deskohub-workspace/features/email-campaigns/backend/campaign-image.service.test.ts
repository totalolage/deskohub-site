import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  CloudinaryService,
  makeCloudinaryRuntimeConfigLayer,
} from "@deskohub/cloudinary/server";
import { Effect, Layer } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import { env } from "@/env";
import {
  CampaignImageService,
  campaignImageTransformation,
} from "./campaign-image.service";

const apiSecret = "synthetic-api-secret";

const campaignImages = CampaignImageService.Default.pipe(
  Layer.provide(CloudinaryService.Default),
  Layer.provide(
    Layer.mergeAll(
      makeCloudinaryRuntimeConfigLayer({
        cloudName: "synthetic-cloud",
        apiKey: "synthetic-api-key",
        apiSecret,
      }),
      FetchHttpClient.layer
    )
  )
);

const authorizeUpload = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const images = yield* CampaignImageService;
      return yield* images.authorizeUpload;
    }).pipe(Effect.provide(campaignImages))
  );

/** Cloudinary's signature: the sorted fields, then the secret, as SHA-1. */
const expectedSignature = (signed: Readonly<Record<string, string>>) =>
  createHash("sha1")
    .update(
      Object.keys(signed)
        .sort()
        .map((name) => `${name}=${signed[name]}`)
        .join("&") + apiSecret
    )
    .digest("hex");

describe("CampaignImageService.authorizeUpload", () => {
  test("signs the campaign folder, a fresh public ID and the transformation", async () => {
    const { url, fields, publicId } = await authorizeUpload();
    const { api_key, signature, ...signed } = fields;

    expect(url).toBe(
      "https://api.cloudinary.com/v1_1/synthetic-cloud/image/upload"
    );
    expect(api_key).toBe("synthetic-api-key");
    expect(signed).toEqual({
      allowed_formats: "gif,jpg,png",
      folder: `email-campaigns/${env.VERCEL_ENV}`,
      format: "png",
      overwrite: "false",
      public_id: expect.stringMatching(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
      ),
      timestamp: expect.stringMatching(/^\d+$/),
      transformation: campaignImageTransformation,
    });
    expect(signature).toBe(expectedSignature(signed));
    expect(publicId).toBe(`${signed.folder}/${signed.public_id}`);
  });

  test("stores images at most twice the body column wide, upright and without metadata", () => {
    expect(campaignImageTransformation).toBe(
      "c_limit,fl_force_strip.lossy,q_85,w_1068"
    );
  });

  test("gives every upload its own public ID", async () => {
    const [first, second] = await Promise.all([
      authorizeUpload(),
      authorizeUpload(),
    ]);

    expect(first.publicId).not.toBe(second.publicId);
  });
});
