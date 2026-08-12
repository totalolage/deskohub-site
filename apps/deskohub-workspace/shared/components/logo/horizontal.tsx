import { cn } from "@/shared/utils";
import type { LogoStyling } from "./logo";
import Logo from "./logo";

type LogoStylingWithoutSmall = {
  color: LogoStyling["color"];
  variant: Exclude<LogoStyling["variant"], "small">;
};

export default function HorizontalLogo({
  styling,
  className,
}: {
  styling: LogoStylingWithoutSmall;
  className?: string;
}) {
  return (
    <div className={cn("flex justify-center gap-4 py-3 px-4", className)}>
      <Logo styling={styling} alt="" height={64} />
      <div
        className={cn("flex flex-col justify-center text-left", {
          "text-silver": styling.color === "dark",
          "text-navy-blue": styling.color === "light",
        })}
      >
        <div className="font-heading font-stretch-expanded text-3xl tracking-wide">
          Deskohub
        </div>
        <p className="font-subheading tracking-wide leading-none">Workspace</p>
      </div>
    </div>
  );
}
