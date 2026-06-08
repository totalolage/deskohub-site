import { getCloudinaryImages } from "@/features/gallery/actions/get-cloudinary-images";
import { Container } from "@/shared/components/container";
import { cn } from "@/shared/utils";
import noiseTexture from "../images/noise-texture.png";
import { LandingPageHexagon } from "./landing-page-hexagon";
import { LandingPagePhotoCarousel } from "./landing-page-photo-carousel";

export const LandingPagePhotoCarouselBackgroundNoise = ({
  className,
}: {
  className?: string;
}) => (
  <div
    aria-hidden="true"
    className={cn(
      "pointer-events-none absolute inset-0 bg-repeat opacity-20",
      className
    )}
    style={{
      backgroundImage: `url(${noiseTexture.src})`,
      backgroundSize: "500px 500px",
    }}
  />
);

export function LandingPagePhotoCarouselSection() {
  const imagesPromise = getCloudinaryImages({
    tags: ["landing-carousel"],
    maxResults: 20,
  });

  return (
    <section
      id="hero-gallery"
      className={cn(
        "relative py-16 sm:py-20 lg:py-24",
        "mt-[calc(-0.5*var(--hero-bottom-section-height))]",
        "bg-[linear-gradient(var(--color-chilean-fire)_0%,transparent_100%),conic-gradient(from_225deg_at_30%_10%,#F57D00,#FF9222)] bg-bottom-left"
      )}
    >
      <LandingPagePhotoCarouselBackgroundNoise className="bg-top" />

      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute -left-10 top-1/2 h-36 w-40 -translate-y-1/2 text-navy-blue/30">
          <LandingPageHexagon />
        </div>
        <div className="absolute bottom-12 left-16 h-14 w-14 rotate-45 rounded-2xl bg-navy-blue" />
        <div className="absolute bottom-24 left-32 h-9 w-9 rotate-45 rounded-xl bg-navy-blue" />
        <div className="absolute right-24 top-12 h-18 w-18 rotate-45 rounded-[1.6rem] bg-black/10" />
        <div className="absolute bottom-8 right-0 h-32 w-64">
          <div className="absolute bottom-5 right-8 h-1 w-48 rotate-[-30deg] bg-navy-blue" />
          <div className="absolute bottom-14 right-16 h-1 w-32 rotate-[-30deg] bg-navy-blue" />
        </div>
      </div>

      <Container className="relative z-10">
        <LandingPagePhotoCarousel imagesPromise={imagesPromise} />
      </Container>
    </section>
  );
}
