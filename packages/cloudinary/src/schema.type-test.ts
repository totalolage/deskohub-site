import { createCloudinaryCacheTags } from "./cache-tags";
import type { CloudinaryPublicId } from "./schema";
import type { ICloudinaryService } from "./service";

declare const publicId: CloudinaryPublicId;
declare const service: ICloudinaryService;

const stringValue: string = publicId;

void service.getByPublicId(publicId);

// @ts-expect-error Raw strings must be decoded before crossing the service boundary.
void service.getByPublicId("gallery/image");

const cacheTags = createCloudinaryCacheTags({ namespace: "cloudinary" });

void cacheTags.image(publicId);
void cacheTags.getTags(publicId);

// @ts-expect-error Cache identity APIs require a decoded Cloudinary public ID.
void cacheTags.image("gallery/image");

// @ts-expect-error Raw strings are not Cloudinary public IDs.
const rawPublicId: CloudinaryPublicId = "gallery/image";

void [rawPublicId, stringValue];
