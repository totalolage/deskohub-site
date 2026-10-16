import { HorizontalLogo, Logo } from "@/shared/components/logo";

// `zoom` shrinks the horizontal logo's layout box along with it, where a scale
// transform would keep reserving the full width, and the header row's padding
// stands in for the logo's own. Phones get the compact mark to leave room for
// the header controls.
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
        <HorizontalLogo
          styling={{ color: "dark", variant: "color" }}
          className="px-0 [zoom:0.8]"
        />
      </span>
    </>
  );
}
