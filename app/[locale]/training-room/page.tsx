import {
  TrainingCTA,
  TrainingFeatures,
  TrainingHero,
  TrainingPackages,
} from "@/features/training";
import { m, setLocale } from "@/i18n";
import type { RouteProps_locale } from "../route";
import { metadata } from "@/shared/utils/metadata";

export const generateMetadata = metadata({
  title: m["training.pageTitle"](),
  description: m["training.pageDescription"](),
})

export default async function TrainingRoomPage({ params }: RouteProps_locale) {
  const { locale } = await params;
  setLocale(locale, { reload: false });

  return (
    <>
      <TrainingHero />
      <TrainingFeatures />
      <TrainingPackages />
      <TrainingCTA />
    </>
  );
}
