import { m } from "@/i18n";
import { foodMenu } from "../menu-data";
import { MenuSectionComponent } from "./menu-section";

export function MenuFoodSection() {
  return (
    <div className="mb-16">
      <h1 className="text-4xl font-bold text-center text-white mb-12">
        🍽️ {m["menu.sections.food"]()}
      </h1>
      {foodMenu.map((section) => (
        <MenuSectionComponent key={section.title} section={section} />
      ))}
    </div>
  );
}
