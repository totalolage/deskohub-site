import { Effect } from "effect";
import { DotyposServiceLive, getMenuItems } from "@/features/dotypos";
import { siteConstants } from "@/shared/utils/constants";
import { MenuClient } from "./menu-client";
import { MenuHero } from "./menu-hero";

export async function MenuServer() {
  const showPdfDownload = siteConstants.featureFlags.menuPdfDownload;

  const program = getMenuItems().pipe(
    Effect.provide(DotyposServiceLive),
    Effect.tapError((error) =>
      Effect.logError("Failed to fetch menu data", error)
    )
  );

  const { products, categories } = await Effect.runPromise(program);

  return (
    <div className="bg-black">
      <MenuHero />
      <MenuClient
        products={products}
        categories={categories}
        showPdfDownload={showPdfDownload}
      />
    </div>
  );
}
