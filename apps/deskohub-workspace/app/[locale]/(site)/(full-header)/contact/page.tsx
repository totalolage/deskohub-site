import type { Metadata, ResolvingMetadata } from "next";
import { ContactPage } from "@/features/contact";
import { m } from "@/features/i18n";
import { runWithRequestLocale } from "@/features/i18n/server/request-locale";
import { createPublicPageMetadata } from "@/features/public-pages/page-metadata";

export const instant = true;

export async function generateMetadata(
  _props: unknown,
  parent: ResolvingMetadata
): Promise<Metadata> {
  return runWithRequestLocale((locale) =>
    createPublicPageMetadata(
      {
        locale,
        pathname: "/contact",
        title: { absolute: m.contactMetadataTitle({}, { locale }) },
        description: m.contactMetadataDescription({}, { locale }),
      },
      parent
    )
  );
}

export default async function LocalizedWorkspaceContactPage() {
  return runWithRequestLocale((locale) => <ContactPage locale={locale} />);
}
