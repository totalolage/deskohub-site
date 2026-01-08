import { m } from "@/features/i18n";
import { LocalizedNextComponent } from "@/features/localization/localized-next-component";
import { MenuPage } from "@/features/menu";
import { metadata } from "@/shared/utils/metadata";

export const generateMetadata = metadata({
  title: m["menu.pageTitle"](),
  description: m["menu.pageDescription"](),
});

export default LocalizedNextComponent.build(MenuPage);
