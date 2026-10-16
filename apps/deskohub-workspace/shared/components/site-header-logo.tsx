import { HorizontalLogo, Logo } from "@/shared/components/logo";
import { cn } from "@/shared/utils";

// The horizontal logo keeps its full layout width under `scale-80`, so phones
// get the compact mark to leave room for the header controls. When the logo
// shares the bar with the desktop navigation, narrow desktops scale it further
// from its left edge.
export function SiteHeaderLogo({
  sharesBarWithNavigation = false,
}: {
  readonly sharesBarWithNavigation?: boolean;
}) {
  return (
    <>
      <span className="block sm:hidden">
        <Logo
          styling={{ color: "dark", variant: "color" }}
          alt=""
          height={48}
        />
      </span>
      <span className="hidden sm:block">
        {/* The negative margins return the width the scale leaves empty. */}
        <HorizontalLogo
          styling={{ color: "dark", variant: "color" }}
          className={cn(
            "scale-80",
            sharesBarWithNavigation &&
              "-mr-6.5 xl:max-2xl:-mr-20 xl:max-2xl:origin-left xl:max-2xl:scale-70"
          )}
        />
      </span>
    </>
  );
}
