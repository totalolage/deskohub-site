import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import {
  blurDataURL,
  cloudinaryAsset,
  installPalmovconImageFakes,
} from "./palmovcon-images.test-utils";

let fakes: Awaited<ReturnType<typeof installPalmovconImageFakes>>["fakes"];
let restoreFetch: () => void;
let loadBlurDataURL: typeof import("./event-images").loadBlurDataURL;
let loadScheduleEventImages: typeof import("./event-images").loadScheduleEventImages;

beforeAll(async () => {
  ({ fakes, restoreFetch } = await installPalmovconImageFakes());
  ({ loadBlurDataURL, loadScheduleEventImages } = await import(
    "./event-images"
  ));
});

beforeEach(() => {
  fakes.available.clear();
  fakes.blurFailures.clear();
});

afterAll(() => restoreFetch());

describe("loadBlurDataURL", () => {
  test("loads the image's blur placeholder", async () => {
    expect(await loadBlurDataURL(cloudinaryAsset("event"))).toBe(blurDataURL);
  });

  test("has no placeholder for a missing image", async () => {
    expect(await loadBlurDataURL(undefined)).toBeUndefined();
  });

  test("has no placeholder when it fails to load", async () => {
    fakes.blurFailures.add("event");

    expect(await loadBlurDataURL(cloudinaryAsset("event"))).toBeUndefined();
  });
});

describe("loadScheduleEventImages", () => {
  test("loads the desktop image and its mobile variant with placeholders", async () => {
    fakes.available.add("event").add("event-mobile");
    fakes.blurFailures.add("event-mobile");

    expect(await loadScheduleEventImages("event")).toEqual({
      image: {
        desktop: cloudinaryAsset("event"),
        mobile: cloudinaryAsset("event-mobile"),
      },
      blurDataURL: { desktop: blurDataURL, mobile: undefined },
    });
  });

  test("leaves out images Cloudinary does not have", async () => {
    fakes.available.add("event-mobile");

    expect(await loadScheduleEventImages("event")).toEqual({
      image: { desktop: undefined, mobile: cloudinaryAsset("event-mobile") },
      blurDataURL: { desktop: undefined, mobile: blurDataURL },
    });
  });
});
