import type { Metadata, ResolvingMetadata } from "next";
import { m } from "@/features/i18n";
import { runWithRequestLocale } from "@/features/i18n/server/request-locale";
import { createPublicPageMetadata } from "@/features/public-pages/page-metadata";
import { TeamPage } from "@/features/team";

const pathname = "/team";

export const instant = false;

export async function generateMetadata(
  _props: PageProps<"/[locale]/team">,
  parent: ResolvingMetadata
): Promise<Metadata> {
  return runWithRequestLocale((locale) =>
    createPublicPageMetadata(
      {
        locale,
        pathname: pathname,
        title: { absolute: m.teamMetadataTitle({}, { locale }) },
        description: m.teamMetadataDescription({}, { locale }),
      },
      parent
    )
  );
}

export default async function LocalizedTeamPage() {
  return runWithRequestLocale((locale) => <TeamPage locale={locale} />);
}
