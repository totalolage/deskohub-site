import "@/shared/testing/workspace-test-env";

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { Context, Effect, Layer } from "effect";
import { mockAdministratorAccess } from "@/features/administrators/server/administrator-access.test-utils";

const access = mockAdministratorAccess("campaign-image-upload");

mock.module("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, getAll: () => [] }),
  headers: async () =>
    new Headers({ referer: "https://deskohub.test/en-US/admin" }),
}));
mock.module("next/server", () => ({
  after: () => undefined,
  connection: () => Promise.resolve(),
}));
mock.module("next/root-params", () => ({
  locale: () => Promise.resolve("en-US"),
}));
mock.module("@/instrumentation", () => ({
  postHogLoggerProvider: {
    forceFlush: () => Promise.resolve(),
    getLogger: () => ({ emit: () => undefined }),
  },
}));

const authorization = {
  url: "https://api.cloudinary.test/v1_1/cloud/image/upload",
  fields: { signature: "fake-upload-signature" },
  publicId: "email-campaigns/preview/4f1c0b9e",
};
const authorizations = mock(() => authorization);
const authorizeUpload = Effect.sync(authorizations);

class StubCampaignImageService extends Context.Service<
  StubCampaignImageService,
  { readonly authorizeUpload: typeof authorizeUpload }
>()("@test/CampaignImageService") {}

mock.module(
  "@/features/email-campaigns/backend/campaign-image.service",
  () => ({
    CampaignImageService: Object.assign(StubCampaignImageService, {
      Live: Layer.succeed(StubCampaignImageService, { authorizeUpload }),
    }),
  })
);

const { authorizeCampaignImageUpload } = await import("./actions");

beforeEach(() => {
  access.set("administrator");
  authorizations.mockClear();
});

describe("authorizeCampaignImageUpload", () => {
  test("authorizes an administrator's upload", async () => {
    const result = await authorizeCampaignImageUpload();

    expect(result?.data).toEqual(authorization);
    expect(authorizations).toHaveBeenCalledTimes(1);
  });

  test.each(["signed-out", "not-administrator"] as const)(
    "refuses a %s caller without signing anything",
    async (caller) => {
      access.set(caller);

      const result = await authorizeCampaignImageUpload();

      expect(result?.data).toBeUndefined();
      expect(result?.serverError).toEqual(expect.any(String));
      expect(authorizations).not.toHaveBeenCalled();
    }
  );
});
