import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { ReactElement, ReactNode } from "react";
import { renderToReadableStream } from "react-dom/server";

let releaseConnection: () => void = () => {};
let connectionGate = Promise.resolve();
let galleryAssets: readonly unknown[] = [];

mock.module("next/root-params", () => ({
  locale: () => Promise.resolve("cs-CZ"),
}));
mock.module("next/server", () => ({
  connection: () => connectionGate,
}));
mock.module("@/features/gallery/backend/get-cloudinary-images.server", () => ({
  getCloudinaryImages: () => Promise.resolve(galleryAssets),
}));
mock.module("@/features/gallery/components/workspace-gallery-album", () => ({
  WorkspaceGalleryAlbum: ({
    photos,
  }: {
    photos: readonly { alt: string; caption?: string }[];
  }) => (
    <ul>
      {photos.map((photo) => (
        <li key={photo.alt}>
          {photo.alt}|{photo.caption}
        </li>
      ))}
    </ul>
  ),
}));
mock.module("@/features/gallery/components/gallery-error-boundary", () => ({
  GalleryErrorBoundary: ({ children }: { children: ReactNode }) => children,
}));

const renderGallery = async () => {
  const { default: GalleryPage } = await import("./page");
  const stream = await renderToReadableStream(
    (await GalleryPage()) as ReactElement
  );
  return stream;
};

describe("gallery route", () => {
  beforeEach(() => {
    connectionGate = Promise.resolve();
    galleryAssets = [];
  });

  test("renders the loading shell in the request locale", async () => {
    const { m } = await import("@/features/i18n");
    connectionGate = new Promise((resolve) => {
      releaseConnection = resolve;
    });

    const stream = await renderGallery();
    const reader = stream.getReader();
    const { value } = await reader.read();
    const shell = new TextDecoder().decode(value);
    releaseConnection();
    await reader.cancel();

    expect(shell).toContain(m.gallerySrTitle({}, { locale: "cs-CZ" }));
    expect(shell).not.toContain(m.gallerySrTitle({}, { locale: "en-US" }));
  });

  test("renders the empty gallery state in the request locale", async () => {
    const { m } = await import("@/features/i18n");

    const stream = await renderGallery();
    await stream.allReady;
    const markup = await new Response(stream).text();

    expect(markup).toContain(m.galleryEmptyNoPhotos({}, { locale: "cs-CZ" }));
  });

  test("renders Cloudinary photo text in the request locale", async () => {
    galleryAssets = [
      {
        context: {
          custom: {
            alt: "Default alt",
            "alt-cs-CZ": "Český popis",
            caption: "Default caption",
            "caption-cs-CZ": "Český titulek",
          },
        },
        height: 1200,
        public_id: "gallery-one",
        secure_url: "https://example.test/gallery-one.jpg",
        width: 1600,
      },
    ];

    const stream = await renderGallery();
    await stream.allReady;
    const markup = await new Response(stream).text();

    expect(markup).toContain("Český popis");
    expect(markup).toContain("Český titulek");
    expect(markup).not.toContain("Default alt");
  });
});
