import {
  TrainingCTA,
  TrainingFeatures,
  TrainingHero,
  TrainingPackages,
} from "@/features/training";
import { m, setLocale } from "@/i18n";
import type { RouteProps_locale } from "../route";

export async function generateMetadata({
  params,
}: Readonly<RouteProps_locale>) {
  setLocale((await params).locale);
  return {
    title: m["training.pageTitle"](),
    description: m["training.pageDescription"](),
  };
}

export default async function TrainingRoomPage({ params }: RouteProps_locale) {
  setLocale((await params).locale);

  return (
    <>
      <TrainingHero />
      <TrainingFeatures />
      <TrainingPackages />
      <TrainingCTA />
    </>
  );
}
