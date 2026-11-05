import type { EmailDraft } from "@deskohub/workspace-admin-api";
import { Data, type Option } from "effect";
import { isCampaignImageSource } from "@/features/email-campaigns/body/campaign-body-rules";
import { isUploadedCampaignImage } from "@/features/email-campaigns/body/campaign-image-account";

/** One image an email shows, by the component that shows it. */
export type EmailImage = {
  readonly componentId: string;
  readonly source: string;
};

/** The images an email or draft shows, in body order. */
export const emailImages = (draft: EmailDraft): readonly EmailImage[] =>
  (draft.structure ?? []).flatMap((component) =>
    component._tag === "Image" && component.id && component.src
      ? [{ componentId: component.id, source: component.src }]
      : []
  );

/**
 * An image publication refuses: not uploaded through the email editor, and
 * not already shown by the email's previous publication.
 */
export class EmailImageNotAllowed extends Data.TaggedError(
  "EmailImageNotAllowed"
)<EmailImage> {}

/**
 * Images publication refuses. Every image must come from the Cloudinary
 * account `imageCloudName`. A new one must also be an untransformed editor
 * upload; one the email's previous publication already showed (`published`)
 * stays, so migrated and older content republishes unchanged. A saved draft
 * is never trusted: anyone who can save a draft could otherwise vouch for an
 * image.
 */
export const disallowedEmailImages = (
  draft: EmailDraft,
  imageCloudName: Option.Option<string>,
  published: ReadonlySet<string>
): readonly EmailImageNotAllowed[] =>
  emailImages(draft).flatMap((image) =>
    isCampaignImageSource(image.source, imageCloudName) &&
    (published.has(image.source) ||
      isUploadedCampaignImage(image.source, imageCloudName))
      ? []
      : [new EmailImageNotAllowed(image)]
  );
