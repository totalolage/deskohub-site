import { cn } from "@/shared/utils";
import noiseTexture from "../images/noise-texture.png";

export const LandingPageBackgroundNoise = ({
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
