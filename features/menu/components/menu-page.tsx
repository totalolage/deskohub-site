import { MenuDrinksSection } from "./menu-drinks-section";
import { MenuFoodSection } from "./menu-food-section";
import { MenuFooterNote } from "./menu-footer-note";
import { MenuHero } from "./menu-hero";
import { MenuOpeningHours } from "./menu-opening-hours";
import { MenuPDFDownload } from "./menu-pdf-download";

export function MenuPage() {
  return (
    <div className="bg-black">
      <MenuHero />

      <div className="max-w-4xl mx-auto px-6 py-16">
        <MenuPDFDownload />
        <MenuOpeningHours />
        <MenuFoodSection />
        <MenuDrinksSection />
        <MenuFooterNote />
      </div>
    </div>
  );
}
