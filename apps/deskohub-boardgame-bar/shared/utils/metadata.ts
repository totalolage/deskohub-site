import { readPathnameHeader } from "@deskohub/i18n/next";
import type { Metadata, ResolvingMetadata } from "next";
import { headers } from "next/headers";
import type { RouteProps_locale } from "@/app/[locale]/route";
import { setLocale } from "@/features/i18n";
import { getAllLocalizedPaths } from "@/features/i18n/utils/locale-url";
import { PATHNAME_HEADER } from "@/shared/utils/constants";

type MetadataText = string | (() => string);

export function metadata({
  title,
  description,
}: {
  title: MetadataText;
  description: MetadataText;
}) {
  return async function generateMetadata(
    { params }: RouteProps_locale,
    _parent: ResolvingMetadata
  ): Promise<Metadata> {
    const path = readPathnameHeader(await headers(), PATHNAME_HEADER);
    const { locale } = await params;
    setLocale(locale, { reload: false });

    const resolvedTitle = typeof title === "function" ? title() : title;
    const resolvedDescription =
      typeof description === "function" ? description() : description;

    return {
      title: { default: resolvedTitle, template: `%s | ${resolvedTitle}` },
      description: resolvedDescription,
      alternates: path
        ? {
            canonical: path,
            languages: Object.fromEntries(getAllLocalizedPaths(path).entries()),
          }
        : undefined,
    };
  };
}
