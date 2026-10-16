import { HorizontalLogo, Logo } from "@/shared/components/logo";

// The horizontal logo keeps its full layout width under `scale-80`, so phones
// get the compact mark to leave room for the header controls.
export function SiteHeaderLogo() {
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
        {/* The negative margin returns the width scale-80 leaves empty. */}
        <HorizontalLogo
          styling={{ color: "dark", variant: "color" }}
          className="-mr-6.5 scale-80"
        />
      </span>
    </>
  );
}
