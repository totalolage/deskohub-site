import {
  Document,
  Font,
  Image,
  Page,
  StyleSheet,
  Text,
  View,
} from "@react-pdf/renderer";
import { getImageProps } from "next/image";
import type React from "react";
import logo from "@/assets/images/logo/for-light-bg.png";
import type { Category, Product } from "@/features/dotypos/generated";
import type { Locale } from "@/features/i18n";
import { siteConstants } from "@/shared/utils/constants";
import { formatPrice } from "@/shared/utils/currency";
import { formatCategory, formatMenuItem } from "../utils/format-menu-item";

// Register fonts if needed
Font.register({
  family: "Roboto",
  fonts: [
    {
      src: "https://cdnjs.cloudflare.com/ajax/libs/ink/3.1.10/fonts/Roboto/roboto-regular-webfont.ttf",
    },
    {
      src: "https://cdnjs.cloudflare.com/ajax/libs/ink/3.1.10/fonts/Roboto/roboto-bold-webfont.ttf",
      fontWeight: "bold",
    },
  ],
});

// Create styles
const styles = StyleSheet.create({
  page: {
    flexDirection: "column",
    backgroundColor: "#ffffff",
    padding: 40,
    fontFamily: "Roboto",
  },
  header: {
    marginBottom: 30,
    textAlign: "center",
  },
  title: {
    fontSize: 32,
    fontWeight: "bold",
    color: "#000000",
    marginBottom: 10,
  },
  sectionTitle: {
    fontSize: 24,
    fontWeight: "bold",
    color: "#22c55e",
    marginTop: 30,
    marginBottom: 20,
  },
  category: {
    marginBottom: 25,
  },
  categoryTitle: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#22c55e",
    marginBottom: 15,
  },
  item: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 10,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#eeeeee",
    borderBottomStyle: "solid",
  },
  itemLeft: {
    flex: 1,
    paddingRight: 10,
  },
  itemName: {
    fontSize: 12,
    fontWeight: "bold",
    marginBottom: 2,
  },
  itemUnit: {
    fontSize: 10,
    color: "#666666",
    marginLeft: 5,
  },
  itemDescription: {
    fontSize: 10,
    color: "#666666",
    marginTop: 2,
  },
  itemPrice: {
    fontSize: 12,
    fontWeight: "bold",
    color: "#22c55e",
    minWidth: 60,
    textAlign: "right",
  },
  unavailable: {
    opacity: 0.6,
  },
  unavailableText: {
    fontSize: 9,
    color: "#ff0000",
    marginLeft: 5,
  },
});

interface MenuPDFDocumentProps {
  categories: Category[];
  products: Product[];
  locale: Locale;
}

export const MenuPDFDocument: React.FC<MenuPDFDocumentProps> = ({
  categories,
  products,
  locale,
}) => {
  const renderItems = (categoryId: string) => {
    const categoryProducts = products.filter(
      (p) => p._categoryId === categoryId
    );

    return categoryProducts.map((product) => {
      // Format product with localized text
      const item = formatMenuItem(product, locale);

      return (
        <View
          key={item.id}
          style={
            !item.isAvailable ? [styles.item, styles.unavailable] : styles.item
          }
        >
          <View style={styles.itemLeft}>
            <View style={{ flexDirection: "row", alignItems: "center" }}>
              <Text style={styles.itemName}>{item.name}</Text>
              {item.unit && ["g", "l"].some((u) => item.unit?.includes(u)) && (
                <Text style={styles.itemUnit}>({item.unit})</Text>
              )}
              {!item.isAvailable && (
                <Text style={styles.unavailableText}>
                  (momentálně nedostupné)
                </Text>
              )}
            </View>
            {item.description && (
              <Text style={styles.itemDescription}>{item.description}</Text>
            )}
          </View>
          <Text style={styles.itemPrice}>
            {formatPrice(item.priceWithVat, locale)}
          </Text>
        </View>
      );
    });
  };

  const logoSrc = getImageProps({ src: logo, alt: "logo" }).props.src;

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <Image
            src={new URL(
              logoSrc,
              `https://${siteConstants.brand.domain}`
            ).toString()}
          />
          <Text style={styles.title}>MENU</Text>
        </View>
      </Page>

      <Page size="A4" style={styles.page}>
        {/* Render all categories */}
        {categories.map((category) => {
          const categoryProducts = products.filter(
            (p) => p._categoryId === category.id
          );

          // Skip empty categories
          if (categoryProducts.length === 0) return null;

          // Format category with localized text
          const formattedCategory = formatCategory(category, locale);

          return (
            <View key={category.id} style={styles.category}>
              <Text style={styles.categoryTitle}>{formattedCategory.name}</Text>
              {renderItems(category.id!)}
            </View>
          );
        })}
      </Page>
    </Document>
  );
};
