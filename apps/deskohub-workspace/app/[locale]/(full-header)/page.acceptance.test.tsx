import { afterAll, beforeAll, expect, mock, test } from "bun:test";
import { Effect, Layer } from "effect";
import { createElement, type ReactElement, type ReactNode } from "react";
import { renderToReadableStream } from "react-dom/server";
import type { CloudinaryAsset } from "@/features/gallery/backend/cloudinary.service";
import type { Locale } from "@/features/i18n";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

const syntheticPhotos = [
  {
    context: { custom: { alt: "Synthetic workspace photo 1" } },
    height: 1200,
    public_id: "synthetic-workspace-photo-1",
    secure_url:
      "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E",
    width: 1600,
  },
  {
    context: { custom: { alt: "Synthetic workspace photo 2" } },
    height: 1200,
    public_id: "synthetic-workspace-photo-2",
    secure_url:
      "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E",
    width: 1600,
  },
] as const satisfies readonly CloudinaryAsset[];
let requestLocale: Locale = "en-US";
let loadCarouselImages = async (): Promise<readonly CloudinaryAsset[]> =>
  syntheticPhotos;

function runWithRequestLocale<A>(resolve: (locale: Locale) => A) {
  return Promise.resolve(resolve(requestLocale));
}

function passthrough<A>(effect: A) {
  return effect;
}

mock.module("@/features/i18n/server/request-locale", () => ({
  runWithRequestLocale,
}));
mock.module(
  "@/features/meeting-room/backend/meeting-room-page-feature-flag",
  () => ({
    isMeetingRoomPageEnabled: async () => false,
  })
);
mock.module(
  "@/features/office/backend/office-reservation-feature-flag.service",
  () => ({
    OfficeReservationFeatureFlagService: { Live: Layer.empty },
  })
);
mock.module("@/features/landing-page/landing-page-sale-banner.server", () => ({
  getActiveLandingPageSaleBanner: () => Effect.succeed(undefined),
}));
mock.module("@/shared/backend/workspace-effect", () => ({
  runWorkspaceEffect: () => passthrough,
}));
mock.module("@/features/gallery/backend/get-cloudinary-images.server", () => ({
  getCloudinaryImages: () => loadCarouselImages(),
}));
const syntheticHeroImageUrl =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E";
mock.module("next/image", () => ({
  default: ({ alt }: { readonly alt: string }) =>
    createElement("img", { alt, src: syntheticHeroImageUrl }),
  getImageProps: ({ alt }: { readonly alt: string }) => ({
    props: { alt, src: syntheticHeroImageUrl },
  }),
}));
mock.module("next/link", () => ({
  default: ({
    children,
    href,
  }: {
    readonly children: ReactNode;
    readonly href: string;
  }) => createElement("a", { href }, children),
}));
mock.module("@deskohub/cloudinary-image", () => ({
  CloudinaryImage: ({
    alt,
    source,
  }: {
    readonly alt: string;
    readonly source: CloudinaryAsset;
  }) => createElement("img", { alt, src: source.secure_url }),
}));
mock.module("yet-another-react-lightbox", () => ({ default: () => null }));
mock.module("next/dynamic", () => ({
  default: () => () => null,
}));

const { default: LocalizedWorkspaceHomePage } = await import("./page");

beforeAll(() => {
  registerWorkspaceComponentTestEnv();
});

afterAll(async () => {
  await unregisterWorkspaceComponentTestEnv();
});

async function renderHomePage() {
  const element = (await LocalizedWorkspaceHomePage()) as ReactElement;
  const stream = await renderToReadableStream(element);
  const page = document.createElement("div");
  page.innerHTML = await new Response(stream).text();
  return page;
}

test("renders the public homepage sections without Team, FAQ, or teambuilding sections", async () => {
  requestLocale = "en-US";
  loadCarouselImages = async () => syntheticPhotos;
  const page = await renderHomePage();

  expect(
    page.querySelector('section[aria-labelledby="landing-page-heading"] h1')
      ?.textContent
  ).toBe("The first self-service workspace on Palmovka.");
  expect(
    page.querySelector(
      'section[aria-label="Deskohub Workspace photo carousel"] img[alt="Synthetic workspace photo 1"]'
    )
  ).toBeTruthy();
  expect(
    page.querySelector(
      'section[aria-label="Deskohub Workspace photo carousel"] img[alt="Synthetic workspace photo 2"]'
    )
  ).toBeTruthy();
  expect(page.querySelector("section#location-map h2")?.textContent).toBe(
    "Two minutes from Palmovka metro"
  );
  expect(page.querySelector("section#location-map address")?.textContent).toBe(
    "Turnovská 430/10, 180 00 Praha 8 - Libeň"
  );
  expect(
    page.querySelector('a[href="mailto:workspace@deskohub.cz"]')?.textContent
  ).toBe("workspace@deskohub.cz");
  const ids = Array.from(page.querySelectorAll<HTMLElement>("[id]"), (node) =>
    node.id.toLowerCase()
  );
  expect(ids.filter((id) => /team|faq|teambuild/.test(id))).toEqual([]);
  const headings = Array.from(page.querySelectorAll("h1, h2, h3"), (heading) =>
    heading.textContent?.trim()
  );
  expect(headings).not.toContain("Our team");
  expect(headings).not.toContain("Frequenty Asked Questions");
  expect(headings).not.toContain("FAQ");
  expect(headings).not.toContain("Workspace teambuilding");
});

test("hides the photo carousel and keeps the homepage when its images fail to load", async () => {
  requestLocale = "en-US";
  loadCarouselImages = () =>
    Promise.reject(new Error("Cloudinary search failed"));
  const page = await renderHomePage();

  expect(page.querySelector("#hero-gallery")).toBeNull();
  expect(
    page.querySelector(
      'section[aria-label="Deskohub Workspace photo carousel"]'
    )
  ).toBeNull();
  expect(
    page.querySelector('section[aria-labelledby="landing-page-heading"] h1')
      ?.textContent
  ).toBe("The first self-service workspace on Palmovka.");
  expect(page.querySelector("section#location-map h2")?.textContent).toBe(
    "Two minutes from Palmovka metro"
  );
  expect(
    page.querySelector('a[href="mailto:workspace@deskohub.cz"]')?.textContent
  ).toBe("workspace@deskohub.cz");
});

test("hides the photo carousel when Cloudinary serves no photos", async () => {
  requestLocale = "en-US";
  loadCarouselImages = async () => [];
  const page = await renderHomePage();

  expect(page.querySelector("#hero-gallery")).toBeNull();
  expect(
    page.querySelector('section[aria-labelledby="landing-page-heading"] h1')
      ?.textContent
  ).toBe("The first self-service workspace on Palmovka.");
});
