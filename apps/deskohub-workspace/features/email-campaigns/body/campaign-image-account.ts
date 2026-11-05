import { Config, Effect, Option } from "effect";

/**
 * The Cloudinary account campaign images must come from, read from config
 * when a body is decoded. Scripts and CLI contracts run without it, and their
 * image-free bodies still decode. Server-only: browser bundles can't carry
 * the config provider.
 */
export const campaignImageCloudName = Config.option(
  Config.string("NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME")
).pipe(Effect.orDie);

/** Campaign body images live under this folder, one subfolder per environment. */
const campaignImageFolderRoot = "email-campaigns";

/** The Cloudinary folder the campaign editor uploads body images to. */
export const campaignImageFolder = (environment: string): string =>
  `${campaignImageFolderRoot}/${environment}`;

/** A version segment, which Cloudinary puts ahead of the public ID. */
const deliveryVersionPattern = /^v\d+$/;

/** Cloudinary delivers the URL plainly: no credentials, query or fragment. */
const isPlainCloudinaryDelivery = (url: URL | null): url is URL =>
  url?.origin === "https://res.cloudinary.com" &&
  url.username === "" &&
  url.password === "" &&
  url.search === "" &&
  url.hash === "";

/** A delivery URL's path: its account, types, and public ID without version. */
const deliveryPath = (url: URL) => {
  const [cloudName, resourceType, deliveryType, ...rest] = url.pathname
    .split("/")
    .slice(1);
  const publicIdPath = deliveryVersionPattern.test(rest[0] ?? "")
    ? rest.slice(1)
    : rest;
  return { cloudName, resourceType, deliveryType, publicIdPath };
};

/** The public ID names a file directly in an environment's campaign folder. */
const isCampaignImagePublicId = (
  publicIdPath: ReadonlyArray<string>
): boolean => {
  const [root, environment, name] = publicIdPath;
  return (
    publicIdPath.length === 3 &&
    root === campaignImageFolderRoot &&
    Boolean(environment) &&
    Boolean(name)
  );
};

/**
 * Whether the image was uploaded through the campaign editor: Cloudinary
 * delivers it, untransformed, from the account `imageCloudName` as stored in
 * a campaign image folder. Any environment's folder counts, so content
 * copied from production into a preview keeps its images.
 */
export const isUploadedCampaignImage = (
  source: string,
  imageCloudName: Option.Option<string>
): boolean => {
  const url = URL.parse(source);
  if (!isPlainCloudinaryDelivery(url)) {
    return false;
  }
  const { cloudName, resourceType, deliveryType, publicIdPath } =
    deliveryPath(url);
  return (
    Option.exists(imageCloudName, (name) => name === cloudName) &&
    resourceType === "image" &&
    deliveryType === "upload" &&
    isCampaignImagePublicId(publicIdPath)
  );
};
