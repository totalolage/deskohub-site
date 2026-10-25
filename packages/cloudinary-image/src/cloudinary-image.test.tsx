import { beforeAll, describe, expect, test } from "bun:test";
import type { CloudinaryAsset } from "@deskohub/cloudinary";
import { renderToStaticMarkup } from "react-dom/server";
import { CloudinaryImage } from "./cloudinary-image";

const publicId = "workspace/DSC03267_TOP_qopcnq";

const asset = {
  context: { custom: { alt: "Metadata alt" } },
  height: 1200,
  public_id: publicId,
  secure_url: `https://res.cloudinary.com/demo/image/upload/${publicId}.jpg`,
  width: 1600,
} as CloudinaryAsset;

const renderedAlts = (markup: string) =>
  [...markup.matchAll(/\salt="([^"]*)"/g)].map(([, alt]) => alt);

const renderedAriaLabels = (markup: string) =>
  [...markup.matchAll(/\saria-label="([^"]*)"/g)].map(([, label]) => label);

describe("CloudinaryImage", () => {
  beforeAll(() => {
    process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME ??= "demo";
  });

  test.each([
    ["an asset", asset],
    ["a public ID", publicId],
  ])(
    "never renders the public ID of %s as its accessible name",
    (_, source) => {
      for (const alt of ["", "Meeting room with a long table"]) {
        const markup = renderToStaticMarkup(
          <CloudinaryImage alt={alt} source={source} />
        );

        expect(renderedAlts(markup)).toEqual([alt]);
        expect(renderedAriaLabels(markup)).not.toContain(publicId);
      }
    }
  );

  test("requires callers to pass alt", () => {
    // @ts-expect-error alt is required so no caller falls back to the public ID.
    const markup = renderToStaticMarkup(<CloudinaryImage source={asset} />);

    expect(renderedAlts(markup)).not.toContain(publicId);
  });
});
