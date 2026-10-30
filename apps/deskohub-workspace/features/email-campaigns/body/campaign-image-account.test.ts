import { describe, expect, test } from "bun:test";
import { Option } from "effect";
import {
  campaignImageFolder,
  isUploadedCampaignImage,
} from "./campaign-image-account";

const cloudName = Option.some("synthetic-cloud");
const delivery = "https://res.cloudinary.com/synthetic-cloud/image/upload";

describe("isUploadedCampaignImage", () => {
  test("accepts an image the editor uploaded, in any environment's folder", () => {
    for (const source of [
      `${delivery}/v1730000000/${campaignImageFolder("preview")}/4f1c0b9e.jpg`,
      `${delivery}/v1/${campaignImageFolder("production")}/4f1c0b9e.gif`,
      `${delivery}/${campaignImageFolder("development")}/4f1c0b9e.png`,
    ]) {
      expect(isUploadedCampaignImage(source, cloudName)).toBe(true);
    }
  });

  test("refuses an image stored or delivered any other way", () => {
    for (const source of [
      `${delivery}/v1/campaigns/autumn.jpg`,
      `${delivery}/v1/${campaignImageFolder("preview")}/nested/a.jpg`,
      `${delivery}/v1/email-campaigns/a.jpg`,
      `${delivery}/c_fill,w_10/v1/${campaignImageFolder("preview")}/a.jpg`,
      `${delivery}/v1/${campaignImageFolder("preview")}/a.jpg?tracking=1`,
      `https://res.cloudinary.com/another-cloud/image/upload/v1/${campaignImageFolder("preview")}/a.jpg`,
      `https://res.cloudinary.com/synthetic-cloud/image/fetch/v1/${campaignImageFolder("preview")}/a.jpg`,
      `http://res.cloudinary.com/synthetic-cloud/image/upload/v1/${campaignImageFolder("preview")}/a.jpg`,
      `https://images.example/synthetic-cloud/image/upload/v1/${campaignImageFolder("preview")}/a.jpg`,
      `https://res.cloudinary.com:8443/synthetic-cloud/image/upload/v1/${campaignImageFolder("preview")}/a.jpg`,
      `https://user:secret@res.cloudinary.com/synthetic-cloud/image/upload/v1/${campaignImageFolder("preview")}/a.jpg`,
      "not a URL",
    ]) {
      expect(isUploadedCampaignImage(source, cloudName)).toBe(false);
    }
  });

  test("accepts no image without a configured account", () => {
    expect(
      isUploadedCampaignImage(
        `${delivery}/v1/${campaignImageFolder("preview")}/a.jpg`,
        Option.none()
      )
    ).toBe(false);
  });
});
