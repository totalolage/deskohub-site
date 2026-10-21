import type { Metadata } from "next";
import { AiAssistantsPage } from "@/features/ai-assistants/components/ai-assistants-page";
import { getWorkspaceAlternates, m } from "@/features/i18n";
import { runWithRequestLocale } from "@/features/i18n/server/request-locale";
import { workspaceSiteConstants } from "@/shared/utils";

const pathname = "/ai-assistants";

export async function generateMetadata(): Promise<Metadata> {
  return runWithRequestLocale((locale) => {
    const title = m.aiAssistantsMetadataTitle({}, { locale });
    const description = m.aiAssistantsMetadataDescription({}, { locale });
    const alternates = getWorkspaceAlternates(locale, pathname);

    return {
      title,
      description,
      alternates,
      openGraph: {
        title,
        description,
        url: alternates.canonical,
        siteName: workspaceSiteConstants.brand.name,
        locale,
        type: "website",
      },
    } satisfies Metadata;
  });
}

export default async function LocalizedAiAssistantsPage() {
  return runWithRequestLocale((locale) => <AiAssistantsPage locale={locale} />);
}
