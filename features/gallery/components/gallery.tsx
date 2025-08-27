import type { UnnormalizedLogicalExpression } from "@/shared/utils/normalize-tag-expression";
import { getCloudinaryImages } from "../actions/get-cloudinary-images";
import type { CloudinaryTag } from "../types/cloudinary-tag";
import { CloudinaryImage } from "./cloudinary-image";
import { GalleryGrid } from "./gallery-grid";

interface GalleryProps {
  tags?: UnnormalizedLogicalExpression<CloudinaryTag>;
  variant?: "grid" | "minimal";
  columns?: {
    sm?: number;
    md?: number;
    lg?: number;
    xl?: number;
  };
  maxImages?: number;
  enableLightbox?: boolean;
  className?: string;
}

/**
 * Gallery component for displaying Cloudinary images
 * Fetches images by tags and renders them in different layouts
 */
export async function Gallery({
  tags,
  variant = "grid",
  columns = { sm: 2, md: 3, lg: 4 },
  maxImages = 50,
  enableLightbox = true,
  className = "",
}: GalleryProps) {
  const images = await getCloudinaryImages({
    tags,
    maxResults: maxImages,
  });

  if (variant === "minimal") {
    // Simple 3-column circle layout without lightbox
    return (
      <div className={`grid grid-cols-1 md:grid-cols-3 gap-8 ${className}`}>
        {images.slice(0, 3).map((image) => (
          <div
            key={image.public_id}
            className="rounded-full overflow-hidden aspect-square"
          >
            <CloudinaryImage asset={image} variant="gallery" />
          </div>
        ))}
      </div>
    );
  }

  // Full grid layout with optional lightbox
  return (
    <GalleryGrid
      images={images}
      columns={columns}
      enableLightbox={enableLightbox}
    />
  );
}

// Re-export CloudinaryImage for convenience
export { CloudinaryImage } from "./cloudinary-image";
