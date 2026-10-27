import { describe, expect, test } from "bun:test";
import { Option } from "effect";
import bytes from "next/dist/compiled/bytes";
import { m } from "@/features/administration/i18n";
import nextConfig from "@/next.config.mjs";
import {
  campaignImageMaxBytes,
  campaignImageMaxMegabytes,
  campaignImageUploadIssue,
} from "./campaign-image-upload";

const locale = "en-US";

const image = (size: number, type = "image/png") =>
  new File([new Uint8Array(size)], "campaign.png", { type });

describe("campaignImageUploadIssue", () => {
  test("lets the largest accepted image's upload fit in a Server Action body", async () => {
    const limit = bytes.parse(
      nextConfig.experimental?.serverActions?.bodySizeLimit ?? "1mb"
    );
    const form = new FormData();
    form.set("file", image(campaignImageMaxBytes));
    const body = await new Response(form).arrayBuffer();

    expect(body.byteLength).toBeLessThanOrEqual(limit ?? 0);
  });

  test("accepts the largest image", () => {
    expect(
      campaignImageUploadIssue(image(campaignImageMaxBytes), locale)
    ).toEqual(Option.none());
  });

  test("refuses a larger image, naming the limit", () => {
    expect(
      campaignImageUploadIssue(image(campaignImageMaxBytes + 1), locale)
    ).toEqual(
      Option.some(
        m.emailCampaignsImageUploadTooLarge(
          { maxMegabytes: campaignImageMaxMegabytes },
          { locale }
        )
      )
    );
  });

  test("refuses an empty file and an unsupported type", () => {
    expect(campaignImageUploadIssue(image(0), locale)).toEqual(
      Option.some(m.emailCampaignsImageUploadMissing({}, { locale }))
    );
    expect(campaignImageUploadIssue(image(3, "image/svg+xml"), locale)).toEqual(
      Option.some(m.emailCampaignsImageUploadUnsupportedType({}, { locale }))
    );
  });
});
