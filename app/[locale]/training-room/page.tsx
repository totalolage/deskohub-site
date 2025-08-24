import {
  TrainingCTA,
  TrainingFeatures,
  TrainingHero,
  TrainingPackages,
} from "@/features/training";
import { m, setLocale } from "@/i18n";
import { siteConstants } from "@/shared/utils/constants";
import { metadata } from "@/shared/utils/metadata";
import type { RouteProps_locale } from "../route";

export const generateMetadata = metadata({
  title: m["training.pageTitle"](),
  description: m["training.pageDescription"](),
});

export default async function TrainingRoomPage({ params }: RouteProps_locale) {
  const { locale } = await params;
  setLocale(locale, { reload: false });
  const showGallery = siteConstants.featureFlags.gallery;

  return (
    <>
      <TrainingHero showGalleryButton={showGallery} />
      <TrainingFeatures />
      <TrainingPackages />
      <TrainingCTA />
    </>
  );
}
