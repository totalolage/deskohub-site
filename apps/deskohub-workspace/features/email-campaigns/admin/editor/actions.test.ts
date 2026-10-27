import "@/shared/testing/workspace-test-env";

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { Context, Effect, Layer } from "effect";
import { m } from "@/features/administration/i18n";
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

const upload = mock((_file: File) =>
  Effect.succeed({ url: "https://images.deskohub.test/campaign.png" })
);

class StubCampaignImageService extends Context.Service<
  StubCampaignImageService,
  { readonly upload: typeof upload }
>()("@test/CampaignImageService") {}

mock.module(
  "@/features/email-campaigns/backend/campaign-image.service",
  () => ({
    CampaignImageService: Object.assign(StubCampaignImageService, {
      Live: Layer.succeed(StubCampaignImageService, { upload }),
    }),
  })
);

const { uploadCampaignImage } = await import("./actions");

const locale = "en-US";

const uploadForm = (file?: File) => {
  const form = new FormData();
  if (file) form.set("file", file);
  return form;
};

const image = () =>
  new File([new Uint8Array([1, 2, 3])], "campaign.png", { type: "image/png" });

beforeEach(() => {
  access.set("administrator");
  upload.mockClear();
});

describe("uploadCampaignImage", () => {
  test("uploads an administrator's image", async () => {
    const result = await uploadCampaignImage(uploadForm(image()));

    expect(result?.data).toEqual({
      url: "https://images.deskohub.test/campaign.png",
    });
    expect(upload).toHaveBeenCalledTimes(1);
  });

  test("tells an administrator why a file can't be uploaded", async () => {
    const result = await uploadCampaignImage(uploadForm());

    expect(result?.serverError).toBe(
      m.emailCampaignsImageUploadMissing({}, { locale })
    );
    expect(upload).not.toHaveBeenCalled();
  });

  test.each(["signed-out", "not-administrator"] as const)(
    "refuses a %s caller before reading the file",
    async (caller) => {
      access.set(caller);

      const result = await uploadCampaignImage(uploadForm());

      expect(result?.serverError).toBe(
        m.emailCampaignsImageUploadFailed({}, { locale })
      );
      expect(upload).not.toHaveBeenCalled();
    }
  );
});
