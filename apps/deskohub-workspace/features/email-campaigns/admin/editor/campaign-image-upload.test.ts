import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { Effect, Exit, Option } from "effect";
import type { CampaignImageUploadAuthorization } from "../../backend/campaign-image.service";

mock.module("@/features/email-campaigns/admin/editor/actions", () => ({
  authorizeCampaignImageUpload: mock(),
}));

const {
  campaignImageUploadLimits,
  needsShrinkingBeforeUpload,
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

describe("needsShrinkingBeforeUpload", () => {
  const { maxBytes, maxPixels } = campaignImageUploadLimits;

  test("leaves an image within the account's limits to Cloudinary", () => {
    expect(
      needsShrinkingBeforeUpload(
        maxBytes,
        Option.some({ width: 5000, height: maxPixels / 5000 })
      )
    ).toBe(false);
  });

  test("shrinks a file above the byte limit, even one the browser can't read", () => {
    expect(
      needsShrinkingBeforeUpload(
        maxBytes + 1,
        Option.some({ width: 800, height: 600 })
      )
    ).toBe(true);
    expect(needsShrinkingBeforeUpload(maxBytes + 1, Option.none())).toBe(true);
  });

  test("shrinks a picture above the pixel limit", () => {
    expect(
      needsShrinkingBeforeUpload(
        1024,
        Option.some({ width: 5001, height: maxPixels / 5000 })
      )
    ).toBe(true);
  });

  test("leaves a small picture the browser can't read to Cloudinary", () => {
    expect(needsShrinkingBeforeUpload(1024, Option.none())).toBe(false);
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
