import { NextEffect } from "@deskohub/next-effect";
import { Effect } from "effect";
import { notFound } from "next/navigation";
import { baseLocale } from "@/features/i18n";
import { MenuData } from "@/features/menu";
import { MenuPdfDebugView } from "@/features/menu/components/menu-debug";

export default NextEffect.make().page(
  Effect.fn("MenuPdfDebugPage")(
    function* MenuPage() {
      const { categories, products } = yield* MenuData;
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
        Effect.provide(MenuData.Default),
        Effect.orElseSucceed(notFound)
      )
  )
);
