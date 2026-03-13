import HorizontalLogo from "@/features/shared/logo/horizontal";
import Logo from "@/features/shared/logo/logo";

const SIZE = 64;

export default function LogoPage() {
  return (
    <div className="flex flex-col  bg-gray-500 min-h-screen gap-8">
      <div className="flex gap-4 items-center justify-center">
        <Logo styling={{ color: "dark", variant: "small" }} width={SIZE} />
        <Logo styling={{ color: "dark", variant: "color" }} width={SIZE} />
        <Logo styling={{ color: "dark", variant: "cutout" }} width={SIZE} />
        <Logo styling={{ color: "dark", variant: "fancy" }} width={SIZE} />
        <Logo styling={{ color: "dark", variant: "plain" }} width={SIZE} />

        <Logo styling={{ color: "light", variant: "small" }} width={SIZE} />
        <Logo styling={{ color: "light", variant: "color" }} width={SIZE} />
        <Logo styling={{ color: "light", variant: "cutout" }} width={SIZE} />
        <Logo styling={{ color: "light", variant: "fancy" }} width={SIZE} />
        <Logo styling={{ color: "light", variant: "plain" }} width={SIZE} />
      </div>
      <div className="flex flex-wrap gap-4 items-center justify-center">
        <HorizontalLogo
          styling={{ color: "dark", variant: "color" }}
          className="rounded-lg bg-navy-blue"
        />
        <HorizontalLogo
          styling={{ color: "dark", variant: "cutout" }}
          className="rounded-lg bg-navy-blue"
        />
        <HorizontalLogo
          styling={{ color: "dark", variant: "fancy" }}
          className="rounded-lg bg-navy-blue"
        />
        <HorizontalLogo
          styling={{ color: "dark", variant: "plain" }}
          className="rounded-lg bg-navy-blue"
        />
        <HorizontalLogo
          styling={{ color: "light", variant: "color" }}
          className="rounded-lg bg-silver"
        />
        <HorizontalLogo
          styling={{ color: "light", variant: "cutout" }}
          className="rounded-lg bg-silver"
        />
        <HorizontalLogo
          styling={{ color: "light", variant: "fancy" }}
          className="rounded-lg bg-silver"
        />
        <HorizontalLogo
          styling={{ color: "light", variant: "plain" }}
          className="rounded-lg bg-silver"
        />
      </div>
    </div>
  );
}
