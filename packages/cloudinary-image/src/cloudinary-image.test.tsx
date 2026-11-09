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

/** The rendered image's attributes, and whether it asked the browser to preload. */
const renderImage = (element: React.ReactElement) => {
  const markup = renderToStaticMarkup(element);
  const img = markup.match(/<img\s([^>]*)\/>/)?.[1] ?? "";
  const attributes = Object.fromEntries(
    [...img.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, name, value]) => [
      name,
      value,
    ])
  );
  return {
    attributes,
    preloaded: markup.includes('<link rel="preload"'),
    styles: (attributes.style ?? "").split(";"),
  };
};

describe("CloudinaryImage variants", () => {
  beforeAll(() => {
    process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME ??= "demo";
  });

  test("renders a gallery image at a fixed cropped size by default", () => {
    const { attributes, preloaded, styles } = renderImage(
      <CloudinaryImage alt="" source={asset} />
    );

    expect(attributes).toMatchObject({
      width: "600",
      height: "600",
      "data-nimg": "1",
      loading: "lazy",
      class: "w-full h-full object-cover",
    });
    expect(attributes.sizes).toBeUndefined();
    expect(attributes.src).toContain(`c_fill`);
    expect(attributes.src).toContain(publicId);
    expect(styles).toEqual(
      expect.arrayContaining(["background-size:cover", "object-fit:cover"])
    );
    expect(preloaded).toBe(false);
  });

  test("fills and preloads a hero image across the viewport", () => {
    const { attributes, preloaded } = renderImage(
      <CloudinaryImage alt="" source={publicId} variant="hero" />
    );

    expect(attributes).toMatchObject({
      "data-nimg": "fill",
      sizes: "100vw",
      class: "brightness-50 absolute inset-0 z-0 object-cover",
    });
    expect(attributes.width).toBeUndefined();
    expect(preloaded).toBe(true);
  });

  test("limits a full image to fit inside its box", () => {
    const { attributes, styles } = renderImage(
      <CloudinaryImage
        alt=""
        className="rounded"
        source={publicId}
        style={{ objectFit: "fill" }}
        variant="full"
      />
    );

    expect(attributes).toMatchObject({
      width: "1920",
      height: "1080",
      class: "object-contain rounded",
    });
    expect(attributes.src).toContain("c_limit");
    expect(styles).toEqual(
      expect.arrayContaining(["background-size:contain", "object-fit:fill"])
    );
  });

  test("renders a thumbnail at its variant size", () => {
    const { attributes } = renderImage(
      <CloudinaryImage alt="" source={publicId} variant="thumbnail" />
    );

    expect(attributes).toMatchObject({ width: "400", height: "400" });
  });

  test("fills when a custom size fills either dimension, keeping explicit sizes", () => {
    const fillHeight = renderImage(
      <CloudinaryImage
        alt=""
        size={{ width: 300, height: "fill" }}
        source={publicId}
      />
    );
    const fillWidth = renderImage(
      <CloudinaryImage
        alt=""
        size={{ width: "fill", height: 300 }}
        sizes="50vw"
        source={publicId}
      />
    );

    expect(fillHeight.attributes).toMatchObject({
      "data-nimg": "fill",
      sizes: "100vw",
    });
    expect(fillWidth.attributes).toMatchObject({
      "data-nimg": "fill",
      sizes: "50vw",
    });
  });

  test("uses a custom fixed size and passes explicit sizes through", () => {
    const { attributes } = renderImage(
      <CloudinaryImage
        alt=""
        size={{ width: 320, height: 240 }}
        sizes="(min-width: 768px) 50vw, 100vw"
        source={publicId}
        variant="hero"
      />
    );

    expect(attributes).toMatchObject({
      width: "320",
      height: "240",
      sizes: "(min-width: 768px) 50vw, 100vw",
    });
  });

  test("prefers preload, then priority, then the variant's preload", () => {
    const preloadedBy = (props: { preload?: boolean; priority?: boolean }) =>
      renderImage(
        <CloudinaryImage alt="" source={publicId} variant="hero" {...props} />
      ).preloaded;

    expect(preloadedBy({ preload: false, priority: true })).toBe(false);
    expect(preloadedBy({ priority: false })).toBe(false);
    expect(preloadedBy({})).toBe(true);
    expect(
      renderImage(<CloudinaryImage alt="" priority source={publicId} />)
        .preloaded
    ).toBe(true);
  });

  test("shows a blurred placeholder only when given blur data", () => {
    const blurred = renderImage(
      <CloudinaryImage
        alt=""
        blurDataURL="data:image/png;base64,AA"
        source={publicId}
      />
    );
    const plain = renderImage(<CloudinaryImage alt="" source={publicId} />);

    expect(blurred.attributes.style).toContain("data:image/png;base64,AA");
    expect(plain.attributes.style).not.toContain("background-image");
  });
});
