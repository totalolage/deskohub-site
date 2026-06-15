import { m, setLocale } from "@/features/i18n";
import {
  TrainingCTA,
  TrainingFeatures,
  TrainingHero,
  TrainingPackages,
} from "@/features/training";
import { metadata } from "@/shared/utils/metadata";
import type { RouteProps_locale } from "../route";

export const generateMetadata = metadata({
  title: m["training.pageTitle"](),
  description: m["training.pageDescription"](),
});

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
