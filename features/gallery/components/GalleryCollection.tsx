import { use } from "react";
import type { CloudinaryAsset } from "../backend/cloudinary.service";
import { GalleryGrid } from "./GalleryGrid";

interface GalleryCollectionProps {
  imagesPromise: Promise<readonly CloudinaryAsset[]>;
  title?: string;
  description?: string;
}

export function GalleryCollection({
  imagesPromise,
  title = "Galerie",
  description = "Prohlédněte si atmosféru našeho herního centra",
}: GalleryCollectionProps) {
  return (
    <section className="py-16 px-4">
      <div className="max-w-7xl mx-auto">
        <h2 className="text-4xl font-bold text-center mb-4">{title}</h2>
        <p className="text-gray-600 text-center mb-12 max-w-2xl mx-auto">
          {description}
        </p>
        <GalleryGrid images={use(imagesPromise)} />
      </div>
    </section>
  );
}
