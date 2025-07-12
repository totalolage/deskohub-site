import { m } from "@/i18n";
import { drinkMenu } from "../menu-data";
import { MenuSectionComponent } from "./menu-section";

export function MenuDrinksSection() {
  return (
    <div>
      <h1 className="text-4xl font-bold text-center text-white mb-12">
        🥤 {m["menu.sections.drinks"]()}
      </h1>
      {drinkMenu.map((section) => (
        <MenuSectionComponent key={section.title} section={section} />
      ))}
    </div>
  );
}
