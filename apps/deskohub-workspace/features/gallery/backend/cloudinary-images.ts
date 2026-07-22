import {
  normalizeExpression,
  type UnnormalizedLogicalExpression,
} from "@deskohub/cloudinary";
import { getGalleryImages } from "@deskohub/cloudinary/server";
import type { CloudinaryTag } from "../types/cloudinary-tag";

export interface GetCloudinaryImagesOptions {
  readonly tags: UnnormalizedLogicalExpression<CloudinaryTag>;
  readonly maxResults?: number;
}

export const getCloudinaryImages = ({
  tags,
  maxResults = 60,
}: GetCloudinaryImagesOptions) =>
  getGalleryImages(normalizeExpression(tags), { maxResults });
