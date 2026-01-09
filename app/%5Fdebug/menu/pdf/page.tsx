import { NotFound } from "@mcrovero/effect-nextjs/Navigation";
import { Effect } from "effect";
import { baseLocale } from "@/features/i18n";
import { MenuService } from "@/features/menu";
import { MenuPdfDebugView } from "@/features/menu/components/menu-debug";
import { BasePage } from "@/shared/base-page";

export default BasePage.build(
  Effect.fn("MenuPdfDebugPage")(
    function* MenuPage() {
      const { productsAndCategories } = yield* MenuService;
      const { categories, products } = yield* productsAndCategories;
      return (
        <MenuPdfDebugView
          locale={baseLocale}
          categories={categories}
          products={products}
        />
      );
    },
    (effect) =>
      effect.pipe(
        Effect.annotateLogs({
          page: "MenuPdfDebugPage",
        }),
        Effect.provide(MenuService.Default),
        Effect.orElse(() => NotFound)
      )
  )
);
