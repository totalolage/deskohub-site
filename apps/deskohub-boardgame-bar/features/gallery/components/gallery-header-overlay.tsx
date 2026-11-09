import type { CloudinaryAsset } from "@deskohub/cloudinary";
import { cn } from "@/shared/utils";

/** The carousel's title and description band. */
export function GalleryHeaderText({
  title,
  description,
}: {
  title?: string;
  description?: string;
}) {
  return (
    <div className="flex-shrink-0 p-8 text-white bg-black/60 pointer-events-auto">
      <div className="max-w-7xl mx-auto">
        {title && (
          <h1 className="text-4xl md:text-5xl font-bold mb-2 drop-shadow-lg">
            {title}
          </h1>
        )}
        {description && (
          <p className="text-lg md:text-xl opacity-90 drop-shadow-lg">
            {description}
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * Previous and next buttons around one dot per slide. The arrows sit at the
 * top beside the text band, or vertically centered without one.
 */
export function GalleryHeaderControls({
  images,
  currentIndex,
  haveText,
  onPrevious,
  onNext,
  onSelect,
}: {
  images: readonly CloudinaryAsset[];
  currentIndex: number;
  haveText: boolean;
  onPrevious: () => void;
  onNext: () => void;
  onSelect: (index: number) => void;
}) {
  const arrowAlignment = haveText ? "self-start" : "self-center";

  return (
    <div className="flex-1 flex flex-row p-4 justify-between bg-gradient-to-t from-black/60 to-transparent pointer-events-auto">
      {/* Left: Previous Button */}
      <div className={cn("flex justify-start", arrowAlignment)}>
        <button
          type="button"
          onClick={onPrevious}
          className="bg-black/30 hover:bg-black/50 text-white p-3 rounded-full transition-all backdrop-blur-sm"
          aria-label="Previous image"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
      </div>

      {/* Middle: Dot Indicators */}
      <div className="flex self-end gap-2">
        {images.map((image, index) => (
          <button
            type="button"
            key={image.public_id}
            onClick={() => onSelect(index)}
            className={cn(
              "h-2 rounded-full transition-all",
              index === currentIndex
                ? "w-8 bg-white"
                : "w-2 bg-white/50 hover:bg-white/70"
            )}
            aria-label={`Go to slide ${index + 1}`}
          />
        ))}
      </div>

      {/* Right: Next Button */}
      <div className={cn("flex justify-end", arrowAlignment)}>
        <button
          type="button"
          onClick={onNext}
          className="bg-black/30 hover:bg-black/50 text-white p-3 rounded-full transition-all backdrop-blur-sm"
          aria-label="Next image"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      </div>
    </div>
  );
}
