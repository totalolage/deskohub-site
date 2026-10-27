import { Option } from "effect";
import { m } from "@/features/administration/i18n";
import type { Locale } from "@/features/i18n";
import { serverActionBodySizeLimitBytes } from "@/shared/utils/server-action-body-limit.js";

const bytesPerMegabyte = 1024 * 1024;

/** Room in the Server Action body for the multipart framing around the file. */
const uploadEnvelopeBytes = 64 * 1024;

/**
 * The largest body image whose upload still fits in a Server Action body. A
 * larger one would fail before the action could explain why. The editor
 * shrinks a larger image to this size before it uploads.
 */
export const campaignImageMaxBytes =
  serverActionBodySizeLimitBytes - uploadEnvelopeBytes;

/** The limit in megabytes, rounded down to a tenth so it never overstates. */
export const campaignImageMaxMegabytes =
  Math.floor((campaignImageMaxBytes / bytesPerMegabyte) * 10) / 10;

export const campaignImageMediaTypes = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
] as const;

/** Says how large a body image may be, in the admin's language. */
export const campaignImageTooLargeMessage = (locale: Locale): string =>
  m.emailCampaignsImageUploadTooLarge(
    {
      maxMegabytes: new Intl.NumberFormat(locale, {
        maximumFractionDigits: 1,
      }).format(campaignImageMaxMegabytes),
    },
    { locale }
  );

/**
 * Why a body image can't be uploaded, in the admin's language. The editor
 * checks before it uploads, and the upload action checks again.
 */
export const campaignImageUploadIssue = (
  file: File,
  locale: Locale
): Option.Option<string> => {
  if (file.size === 0) {
    return Option.some(m.emailCampaignsImageUploadMissing({}, { locale }));
  }
  if (!campaignImageMediaTypes.some((type) => type === file.type)) {
    return Option.some(
      m.emailCampaignsImageUploadUnsupportedType({}, { locale })
    );
  }
  if (file.size > campaignImageMaxBytes) {
    return Option.some(campaignImageTooLargeMessage(locale));
  }
  return Option.none();
};
