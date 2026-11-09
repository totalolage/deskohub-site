import "@/shared/testing/workspace-test-env";

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { Context, Effect, Layer } from "effect";
import { mockAdministrationActionRequest } from "@/shared/testing/workspace-action-request.test-utils";

const { access } = await mockAdministrationActionRequest({
  administrator: "email-image-upload",
  referer: "https://deskohub.test/en-US/admin",
});

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

const { authorizeEmailImageUpload } = await import("./image-upload-actions");

beforeEach(() => {
  access.set("administrator");
  authorizations.mockClear();
});

describe("authorizeEmailImageUpload", () => {
  test("authorizes an administrator's upload", async () => {
    const result = await authorizeEmailImageUpload();

    expect(result?.data).toEqual(authorization);
    expect(authorizations).toHaveBeenCalledTimes(1);
  });

  test.each(["signed-out", "not-administrator"] as const)(
    "refuses a %s caller without signing anything",
    async (caller) => {
      access.set(caller);

      const result = await authorizeEmailImageUpload();

      expect(result?.data).toBeUndefined();
      expect(result?.serverError).toEqual(expect.any(String));
      expect(authorizations).not.toHaveBeenCalled();
    }
  );
});
