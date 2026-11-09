import { describe, expect, test } from "bun:test";
import { customerAvatarMaxUploadBytes } from "@deskohub/workspace-customer-api";
import { Effect, Option } from "effect";
import type { PickedImage } from "../../../customer-api/device-capabilities";
import { acceptAvatarFile, avatarMediaTypeOf } from "./avatar-file";

const picked = (overrides: Partial<PickedImage> = {}): PickedImage => ({
  uri: "file:///cache/ImagePicker/sample.jpg",
  name: "sample.jpg",
  mimeType: "image/jpeg",
  size: 1024,
  ...overrides,
});

const check = (image: PickedImage) =>
  Effect.runPromise(Effect.result(acceptAvatarFile(image)));

describe("avatar media type", () => {
  test("takes the type the picker reported", () => {
    expect(avatarMediaTypeOf(picked({ mimeType: "image/WEBP" }))).toEqual(
      Option.some("image/webp")
    );
  });

  test.each([
    ["photo.JPG", "image/jpeg"],
    ["photo.jpeg", "image/jpeg"],
    ["photo.png", "image/png"],
    ["photo.webp", "image/webp"],
  ])(
    "infers %s from its extension when the picker reports none",
    (name, type) => {
      expect(avatarMediaTypeOf(picked({ name, mimeType: undefined }))).toEqual(
        Option.some(type)
      );
    }
  );

  test("falls back to the URI's extension for a name without one", () => {
    expect(
      avatarMediaTypeOf(
        picked({
          name: "avatar",
          uri: "file:///cache/picked.png?token=1",
          mimeType: undefined,
        })
      )
    ).toEqual(Option.some("image/png"));
  });

  test("knows none for an unknown extension", () => {
    expect(
      avatarMediaTypeOf(
        picked({
          name: "photo.heic",
          uri: "file:///x.heic",
          mimeType: undefined,
        })
      )
    ).toEqual(Option.none());
  });
});

describe("accepting a picked avatar", () => {
  test("accepts a JPEG, PNG or WebP within the size limit", async () => {
    for (const mimeType of ["image/jpeg", "image/png", "image/webp"]) {
      expect(await check(picked({ mimeType }))).toMatchObject({
        _tag: "Success",
        success: { mediaType: mimeType },
      });
    }
  });

  test("accepts an image of exactly the limit", async () => {
    expect(
      await check(picked({ size: customerAvatarMaxUploadBytes }))
    ).toMatchObject({ _tag: "Success" });
  });

  test("refuses an image one byte over the limit", async () => {
    expect(
      await check(picked({ size: customerAvatarMaxUploadBytes + 1 }))
    ).toMatchObject({
      _tag: "Failure",
      failure: { _tag: "CustomerAvatarRejected", reason: "file-too-large" },
    });
  });

  test("leaves an image of unknown size to the Workspace", async () => {
    expect(await check(picked({ size: undefined }))).toMatchObject({
      _tag: "Success",
    });
  });

  test("refuses another media type, reported or inferred", async () => {
    for (const image of [
      picked({ mimeType: "image/heic" }),
      picked({ name: "photo.gif", uri: "file:///x.gif", mimeType: undefined }),
    ]) {
      expect(await check(image)).toMatchObject({
        _tag: "Failure",
        failure: { reason: "unsupported-format" },
      });
    }
  });
});
