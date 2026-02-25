import type { Metadata, ResolvingMetadata } from "next";
import { headers } from "next/headers";
import type { RouteProps_locale } from "@/app/[locale]/route";
import { getAllLocalizedPaths } from "@/features/i18n/utils/locale-url";
import { PATHNAME_HEADER } from "@/shared/utils/constants";

export function metadata({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return async function generateMetadata(
    _params: RouteProps_locale,
    _parent: ResolvingMetadata
  ): Promise<Metadata> {
    const path = (await headers()).get(PATHNAME_HEADER);

    return {
      title: { default: title, template: `%s | ${title}` },
      description,
      alternates: path
        ? {
            canonical: path,
            languages: Object.fromEntries(getAllLocalizedPaths(path).entries()),
          }
        : undefined,
    };
  };
}
