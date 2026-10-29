import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { Effect, Exit, Option } from "effect";
import type { CampaignImageUploadAuthorization } from "../../backend/campaign-image.service";

mock.module("@/features/email-campaigns/admin/editor/actions", () => ({
  authorizeCampaignImageUpload: mock(),
}));

const {
  campaignImagePreparation,
  campaignImageUploadLimits,
  sendCampaignImage,
} = await import("./campaign-image-upload");

const authorization: CampaignImageUploadAuthorization = {
  url: "https://api.cloudinary.test/v1_1/cloud/image/upload",
  fields: {
    folder: "email-campaigns/preview",
    public_id: "4f1c0b9e",
    signature: "fake-upload-signature",
  },
  publicId: "email-campaigns/preview/4f1c0b9e",
};

const storedImage = {
  public_id: authorization.publicId,
  secure_url:
    "https://res.cloudinary.com/cloud/image/upload/v1/email-campaigns/preview/4f1c0b9e.jpg",
  width: 1068,
};

const fetchSpy = spyOn(globalThis, "fetch");
afterEach(() => fetchSpy.mockReset());

type CloudinaryAnswer =
  | Partial<Record<keyof typeof storedImage, string | number>>
  | { readonly error: { readonly message: string } };

const answer = (status: number, body: CloudinaryAnswer) =>
  fetchSpy.mockResolvedValue(Response.json(body, { status }));

const send = (file = new Blob([new Uint8Array(3)], { type: "image/png" })) =>
  Effect.runPromiseExit(sendCampaignImage({ image: file, authorization }));

const failureTag = (exit: Exit.Exit<unknown, { readonly _tag: string }>) =>
  Exit.isFailure(exit)
    ? exit.cause.reasons.flatMap((reason) =>
        reason._tag === "Fail" ? [reason.error._tag] : []
      )
    : [];

describe("campaignImagePreparation", () => {
  const { maxBytes, maxPixels, maxAnimationPixels } = campaignImageUploadLimits;
  const sized = (width: number, height: number) =>
    Option.some({ width, height });

  test("leaves an image within the account's limits to Cloudinary", () => {
    expect(
      campaignImagePreparation({
        bytes: maxBytes,
        size: sized(5000, maxPixels / 5000),
        frames: 1,
      })
    ).toBe("upload");
  });

  test("shrinks a still file above the byte limit, even one the browser can't read", () => {
    expect(
      campaignImagePreparation({
        bytes: maxBytes + 1,
        size: sized(800, 600),
        frames: 1,
      })
    ).toBe("shrink");
    expect(
      campaignImagePreparation({
        bytes: maxBytes + 1,
        size: Option.none(),
        frames: 1,
      })
    ).toBe("shrink");
  });

  test("shrinks a still picture above the pixel limit", () => {
    expect(
      campaignImagePreparation({
        bytes: 1024,
        size: sized(5001, maxPixels / 5000),
        frames: 1,
      })
    ).toBe("shrink");
  });

  test("leaves a small picture the browser can't read to Cloudinary", () => {
    expect(
      campaignImagePreparation({ bytes: 1024, size: Option.none(), frames: 1 })
    ).toBe("upload");
  });

  test("leaves an animation within the limits to Cloudinary", () => {
    expect(
      campaignImagePreparation({
        bytes: maxBytes,
        size: sized(1000, 1000),
        frames: maxAnimationPixels / 1_000_000,
      })
    ).toBe("upload");
  });

  test("refuses an animation above the byte limit instead of shrinking it", () => {
    expect(
      campaignImagePreparation({
        bytes: maxBytes + 1,
        size: sized(400, 300),
        frames: 2,
      })
    ).toBe("refuse");
    expect(
      campaignImagePreparation({
        bytes: maxBytes + 1,
        size: Option.none(),
        frames: 2,
      })
    ).toBe("refuse");
  });

  test("refuses an animation whose frames together exceed the pixel limit", () => {
    expect(
      campaignImagePreparation({
        bytes: 1024,
        size: sized(1000, 1000),
        frames: maxAnimationPixels / 1_000_000 + 1,
      })
    ).toBe("refuse");
  });
});

describe("sendCampaignImage", () => {
  test("posts the signed fields and the file straight to Cloudinary", async () => {
    answer(200, storedImage);
    const file = new Blob([new Uint8Array(3)], { type: "image/png" });

    const exit = await send(file);

    expect(exit).toEqual(
      Exit.succeed({ url: storedImage.secure_url, width: 1068 })
    );
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] ?? [];
    expect(url).toBe(authorization.url);
    expect(init?.method).toBe("POST");
    const form = init?.body;
    if (!(form instanceof FormData)) throw new Error("No form was posted");
    expect(
      Object.fromEntries(
        [...form.entries()].filter(([name]) => name !== "file")
      )
    ).toEqual(authorization.fields);
    const sent = form.get("file");
    expect(sent instanceof Blob && sent.size).toBe(3);
  });

  test("reports a file Cloudinary refuses as unreadable", async () => {
    answer(400, { error: { message: "Invalid image file" } });

    expect(failureTag(await send())).toEqual(["CampaignImageRejectedError"]);
  });

  test("reports any other refusal as a failed upload", async () => {
    answer(503, { error: { message: "Service unavailable" } });

    expect(failureTag(await send())).toEqual(["CampaignImageUploadError"]);
  });

  test("reports an unreachable Cloudinary as a failed upload", async () => {
    fetchSpy.mockRejectedValue(new TypeError("Failed to fetch"));

    expect(failureTag(await send())).toEqual(["CampaignImageUploadError"]);
  });

  test.each([
    ["another public ID", { public_id: "email-campaigns/preview/other" }],
    ["a width no image has", { width: 0 }],
    ["no URL", { secure_url: undefined }],
  ])("refuses an answer with %s", async (_, change) => {
    answer(200, { ...storedImage, ...change });

    expect(failureTag(await send())).toEqual(["CampaignImageUploadError"]);
  });
});
