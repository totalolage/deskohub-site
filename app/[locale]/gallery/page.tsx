import type { Metadata } from "next";
import { GalleryEvents, GalleryHero, GallerySpaces } from "@/features/gallery";
import { m, setLocale } from "@/i18n";
import type { RouteProps_locale } from "../route";

export async function generateMetadata({
  params,
}: RouteProps_locale): Promise<Metadata> {
  setLocale((await params).locale);

  return {
    title: m["gallery.pageTitle"](),
    description: m["gallery.pageDescription"](),
  };
}

export default async function GalleryPage({ params }: RouteProps_locale) {
  setLocale((await params).locale);

  return (
    <>
      <GalleryHero />
      <GallerySpaces />
      <GalleryEvents />
    </>
  );
}

