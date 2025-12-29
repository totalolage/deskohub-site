import { m } from "@/features/i18n";
import { MenuPage } from "@/features/menu";
import { LocalizedPage } from "@/shared/pages/localized";
import { metadata } from "@/shared/utils/metadata";

export const generateMetadata = metadata({
  title: m["menu.pageTitle"](),
  description: m["menu.pageDescription"](),
});

export default LocalizedPage.build(MenuPage);
