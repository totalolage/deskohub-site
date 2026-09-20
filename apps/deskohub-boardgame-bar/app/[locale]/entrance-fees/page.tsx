import { EntranceFeesHero, EntranceFeesTiers } from "@/features/entrance-fees";
import { m, setLocale } from "@/features/i18n";
import { metadata } from "@/shared/utils/metadata";
import type { RouteProps_locale } from "../route";

export const generateMetadata = metadata({
  title: m["entranceFees.pageTitle"](),
  description: m["entranceFees.pageDescription"](),
});

export default async function EntranceFeesPage({ params }: RouteProps_locale) {
  const { locale } = await params;
  setLocale(locale, { reload: false });

  return (
    <div className="min-h-screen bg-black">
      <EntranceFeesHero />
      <EntranceFeesTiers />
    </div>
  );
}
