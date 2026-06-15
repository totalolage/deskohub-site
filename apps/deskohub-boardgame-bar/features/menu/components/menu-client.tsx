"use client";

import type { Category, Product } from "@deskohub/dotypos/generated";
import { siteConstants } from "@/shared/utils/constants";
import { MenuFooterNote } from "./menu-footer-note";
import { MenuOpeningHours } from "./menu-opening-hours";
import { MenuPDFDownload } from "./menu-pdf-download";
import { MenuSection } from "./menu-section";

interface MenuClientProps {
  products: Product[];
  categories: Category[];
  showPdfDownload: boolean;
}

export function MenuClient({
  products,
  categories,
  showPdfDownload,
}: MenuClientProps) {
  return (
    <div className="max-w-4xl mx-auto px-6 py-16">
      {showPdfDownload && <MenuPDFDownload />}
      <MenuOpeningHours />

      {/* Display all categories in order */}
      {categories.map((category) => (
        <MenuSection
          key={category.id}
          category={category}
          products={products}
          emoji={
            category.id
              ? siteConstants.menu.categoryEmojis[category.id]
              : undefined
          }
        />
      ))}

      <MenuFooterNote />
    </div>
  );
}
