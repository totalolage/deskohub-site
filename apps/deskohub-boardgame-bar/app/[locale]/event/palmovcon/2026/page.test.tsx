import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  setSystemTime,
  test,
} from "bun:test";
import { CloudinaryImage } from "@deskohub/cloudinary-image";
import { LocalizedLink } from "@/features/i18n/components/localized-link";
import { findElementsOfType } from "@/shared/testing/react-element-tree";
import { siteConstants } from "@/shared/utils/constants";
import { PALMOVCON_PAGE_EXPIRES_AT } from "./page-availability";
import {
  blurDataURL,
  cloudinaryAsset,
  installPalmovconImageFakes,
} from "./palmovcon-images.test-utils";
import { getSchedule } from "./schedule";
import { ScheduleEventCard } from "./schedule-event-card";

let fakes: Awaited<ReturnType<typeof installPalmovconImageFakes>>["fakes"];
let restoreFetch: () => void;
let Palmovcon2026Page: typeof import("./page").default;

const initialTableReservations = siteConstants.featureFlags.tableReservations;

beforeAll(async () => {
  ({ fakes, restoreFetch } = await installPalmovconImageFakes());
  ({ default: Palmovcon2026Page } = await import("./page"));
});

beforeEach(() => {
  fakes.available.clear();
  fakes.blurFailures.clear();
  setSystemTime(new Date(PALMOVCON_PAGE_EXPIRES_AT - 60_000));
});

afterEach(() => {
  siteConstants.featureFlags.tableReservations = initialTableReservations;
});

afterAll(() => {
  setSystemTime();
  restoreFetch();
});

const renderPage = () =>
  Palmovcon2026Page({
    params: Promise.resolve({ locale: "cs-CZ" }),
  } as Parameters<typeof Palmovcon2026Page>[0]);

describe("Palmovcon2026Page", () => {
  test("is not found once the event is over", async () => {
    setSystemTime(new Date(PALMOVCON_PAGE_EXPIRES_AT));

    await expect(renderPage()).rejects.toMatchObject({
      digest: expect.stringContaining("404"),
    });
  });

  test("shows the hero image with its placeholder and a reservation link", async () => {
    siteConstants.featureFlags.tableReservations = true;
    fakes.available.add("palmovcon-2026-hero");

    const page = await renderPage();

    expect(
      findElementsOfType(page, CloudinaryImage).map(({ props }) => ({
        source: props.source,
        blurDataURL: props.blurDataURL,
      }))
    ).toEqual([
      { source: cloudinaryAsset("palmovcon-2026-hero"), blurDataURL },
    ]);
    expect(
      findElementsOfType(page, LocalizedLink).map(({ props }) => props.href)
    ).toEqual(["/reservation", "/reservation"]);
  });

  test("shows a text title without a hero image and no reservation links while reservations are off", async () => {
    siteConstants.featureFlags.tableReservations = false;

    const page = await renderPage();

    expect(findElementsOfType(page, CloudinaryImage)).toEqual([]);
    expect(findElementsOfType(page, "h1")).toHaveLength(2);
    expect(findElementsOfType(page, LocalizedLink)).toEqual([]);
  });

  test("shows the hero image without a placeholder when it fails to load", async () => {
    fakes.available.add("palmovcon-2026-hero");
    fakes.blurFailures.add("palmovcon-2026-hero");

    const [hero] = findElementsOfType(await renderPage(), CloudinaryImage);

    expect(hero?.props.blurDataURL).toBeUndefined();
  });

  test("lists every scheduled event with its images", async () => {
    const [firstEvent] = getSchedule();
    fakes.available.add(firstEvent?.imagePublicId as string);

    const cards = findElementsOfType(await renderPage(), ScheduleEventCard);

    expect(cards.map(({ props }) => props.item.title)).toEqual(
      getSchedule().map(({ title }) => title)
    );
    expect(cards[0]?.props.images).toEqual({
      image: {
        desktop: cloudinaryAsset(firstEvent?.imagePublicId as string),
        mobile: undefined,
      },
      blurDataURL: { desktop: blurDataURL, mobile: undefined },
    });
  });
});
