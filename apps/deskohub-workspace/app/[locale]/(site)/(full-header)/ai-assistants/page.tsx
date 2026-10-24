import type { Metadata, ResolvingMetadata } from "next";
import { AiAssistantsPage } from "@/features/ai-assistants/components/ai-assistants-page";
import { m } from "@/features/i18n";
import { runWithRequestLocale } from "@/features/i18n/server/request-locale";
import { createPublicPageMetadata } from "@/features/public-pages/page-metadata";

const pathname = "/ai-assistants";

export async function generateMetadata(
  _props: unknown,
  parent: ResolvingMetadata
): Promise<Metadata> {
  return runWithRequestLocale((locale) =>
    createPublicPageMetadata(
      {
        locale,
        pathname: pathname,
        title: { absolute: m.aiAssistantsMetadataTitle({}, { locale }) },
        description: m.aiAssistantsMetadataDescription({}, { locale }),
      },
      parent
    )
  );
}

export default async function LocalizedAiAssistantsPage() {
  return runWithRequestLocale((locale) => <AiAssistantsPage locale={locale} />);
}
