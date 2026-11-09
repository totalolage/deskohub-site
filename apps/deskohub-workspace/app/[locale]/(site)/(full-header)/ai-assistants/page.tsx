import { AiAssistantsPage } from "@/features/ai-assistants/components/ai-assistants-page";
import { runWithRequestLocale } from "@/features/i18n/server/request-locale";
import { publicPageMetadata } from "@/features/public-pages/backend/public-page-route.server";

export const generateMetadata = publicPageMetadata("/ai-assistants");

export default async function LocalizedAiAssistantsPage() {
  return runWithRequestLocale((locale) => <AiAssistantsPage locale={locale} />);
}
