import { m, setLocale } from "@/features/i18n";
import { MenuPage } from "@/features/menu";
import { metadata } from "@/shared/utils/metadata";
import type { RouteProps_locale } from "../route";

export const generateMetadata = metadata({
  title: m["menu.pageTitle"](),
  description: m["menu.pageDescription"](),
});

export default async function Menu({ params }: RouteProps_locale) {
  const { locale } = await params;
  setLocale(locale, { reload: false });

  return <MenuPage />;
}
