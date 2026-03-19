import type { CSSProperties } from "react";
import { m, type WorkspaceLocale } from "@/features/i18n";

const RIBBON_SQUARE_ROOT_OF_TWO = "1.41421356237";
type RibbonViewportStyle = CSSProperties & Record<`--${string}`, string>;

export const underConstructionRibbonViewportStyle = {
  "--under-construction-ribbon-sqrt2": RIBBON_SQUARE_ROOT_OF_TWO,
  "--under-construction-ribbon-corner-size": "14rem",
  "--under-construction-ribbon-band-height": "2.5rem",
  "--under-construction-ribbon-band-width":
    "calc(var(--under-construction-ribbon-corner-size) * var(--under-construction-ribbon-sqrt2) - var(--under-construction-ribbon-band-height))",
} satisfies RibbonViewportStyle;

type UnderConstructionRibbonProps = {
  locale: WorkspaceLocale;
};

export function UnderConstructionRibbon({
  locale,
}: UnderConstructionRibbonProps) {
  const ribbonLabel = m.statusUnderConstruction({}, { locale });

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed bottom-0 right-0 z-50 h-[var(--under-construction-ribbon-corner-size)] w-[var(--under-construction-ribbon-corner-size)]"
    >
      <div
        className="absolute flex h-[var(--under-construction-ribbon-band-height)] w-[var(--under-construction-ribbon-band-width)] rotate-[-45deg] items-center justify-center border-y border-navy-blue/20 after:bg-[linear-gradient(90deg,rgba(221,72,10,0.96),rgba(236,164,35,0.98),rgba(255,243,204,0.96))] px-5 text-center text-[0.72rem] font-semibold uppercase tracking-[0.18em] text-navy-blue shadow-[0_18px_38px_-22px_rgba(0,2,79,0.7)] sm:px-6 sm:text-[0.78rem] after:absolute after:-inset-x-12 after:top-0 after:h-full"
        style={{
          right:
            "calc((var(--under-construction-ribbon-corner-size) - var(--under-construction-ribbon-band-width)) / 2)",
          bottom:
            "calc((var(--under-construction-ribbon-corner-size) - var(--under-construction-ribbon-band-height)) / 2)",
        }}
      >
        <div className="flex items-center justify-center gap-2 whitespace-nowrap z-10">
          <span
            aria-hidden="true"
            className="text-sm leading-none sm:text-base"
          >
            🚧
          </span>
          <span>{ribbonLabel}</span>
        </div>
      </div>
    </div>
  );
}
