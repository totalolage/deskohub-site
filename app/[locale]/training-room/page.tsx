import {
  TrainingCTA,
  TrainingFeatures,
  TrainingHero,
  TrainingPackages,
} from "@/features/training";
import { galleryFlag } from "@/flags";
import { m, setLocale } from "@/i18n";
import { metadata } from "@/shared/utils/metadata";
import type { RouteProps_locale } from "../route";

export const generateMetadata = metadata({
  title: m["training.pageTitle"](),
  description: m["training.pageDescription"](),
});

export default async function TrainingRoomPage({ params }: RouteProps_locale) {
  const { locale } = await params;
  setLocale(locale, { reload: false });
  const showGallery = await galleryFlag();

  return (
    <>
      <TrainingHero showGalleryButton={showGallery} />
      <TrainingFeatures />
      <TrainingPackages />
      <TrainingCTA />
    </>
  );
}
