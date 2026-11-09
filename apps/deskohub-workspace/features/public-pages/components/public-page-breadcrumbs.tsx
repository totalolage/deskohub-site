import { prefixPathnameWithLocale } from "@deskohub/i18n/pathname";
import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { getWorkspaceAlternates, type Locale, m } from "@/features/i18n";
import { StructuredData } from "@/shared/components/structured-data";
import { cn } from "@/shared/utils";
import { getBreadcrumbListStructuredData } from "@/shared/utils/structured-data";
import type { PublicPagePathname } from "../public-pages";

/** A page on the trail by its unprefixed pathname and short name. */
export type PublicPageBreadcrumb = {
  readonly pathname: PublicPagePathname;
  readonly name: string;
};

/**
 * The trail from the home page down to the current page, which is the last
 * crumb: visible links up the hierarchy and the matching `BreadcrumbList`.
 */
export function PublicPageBreadcrumbs({
  className,
  crumbs,
  locale,
  tone = "light",
}: {
  readonly className?: string;
  /** The pages below the home page, ending with the current page. */
  readonly crumbs: ReadonlyArray<PublicPageBreadcrumb>;
  readonly locale: Locale;
  /** `light` suits light backgrounds, `inverse` dark ones. */
  readonly tone?: "light" | "inverse";
}) {
  const trail: ReadonlyArray<PublicPageBreadcrumb> = [
    { pathname: "/", name: m.breadcrumbHome({}, { locale }) },
    ...crumbs,
  ];

  return (
    <nav
      aria-label={m.breadcrumbLabel({}, { locale })}
      className={cn(
        "font-mono text-[0.6875rem] uppercase tracking-[0.1em]",
        { light: "text-navy-blue/64", inverse: "text-silver/72" }[tone],
        className
      )}
    >
      <StructuredData
        data={getBreadcrumbListStructuredData(
          trail.map(({ name, pathname }) => ({
            name,
            url: getWorkspaceAlternates(locale, pathname).canonical,
          }))
        )}
      />
      <ol className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {trail.map(({ name, pathname }, index) => {
          const current = index === trail.length - 1;

          return (
            <li className="flex items-center gap-2" key={pathname}>
              {index > 0 && (
                <ChevronRight
                  aria-hidden="true"
                  className={cn(
                    "size-3 shrink-0",
                    {
                      light: "text-burned-orange-ink",
                      inverse: "text-burned-orange",
                    }[tone]
                  )}
                />
              )}
              {current ? (
                <span aria-current="page">{name}</span>
              ) : (
                <Link
                  className={cn(
                    "underline decoration-current/30 underline-offset-4 transition-colors focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4",
                    {
                      light:
                        "hover:text-burned-orange-ink focus-visible:outline-burned-orange",
                      inverse:
                        "hover:text-sunset-yellow focus-visible:outline-sunset-yellow",
                    }[tone]
                  )}
                  href={prefixPathnameWithLocale(pathname, locale)}
                >
                  {name}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
