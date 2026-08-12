import { router } from "expo-router";
import { useMemo, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { AppIcon } from "@/components/AppIcon";
import { AppScreen } from "@/components/AppScreen";
import { Brand } from "@/components/Brand";
import { CartDock } from "@/components/CartDock";
import {
  ActionButton,
  Pill,
  StatePanel,
  StatusBanner,
} from "@/components/Controls";
import { ProductCard } from "@/components/ProductCard";
import { SignInHandoff } from "@/components/SignInHandoff";
import { palette, radii, spacing, type } from "@/constants/Theme";
import { formatPragueDay, localizeText } from "@/src/domain/format";
import { useShop } from "@/src/state/shop-provider";

function LaunchState() {
  const { t } = useShop();
  return (
    <View style={styles.launch}>
      <Brand />
      <View style={styles.launchCopy}>
        <Text accessibilityRole="header" style={styles.launchTitle}>
          {t("loadingTitle")}
        </Text>
      </View>
    </View>
  );
}

function SignInState() {
  const { actionError, beginSignIn, isActionPending, t } = useShop();

  return (
    <AppScreen header={false}>
      <SignInHandoff
        actionLabel={t("continueToSignIn")}
        body={t("signInBody")}
        loading={isActionPending}
        notice={
          <>
            {actionError === "native_auth_unavailable" && (
              <StatusBanner
                body={t("nativeAuthUnavailableBody")}
                title={t("nativeAuthUnavailableTitle")}
                tone="warning"
              />
            )}
            {actionError && actionError !== "native_auth_unavailable" && (
              <StatusBanner title={t("errorTitle")} tone="error" />
            )}
          </>
        }
        onContinue={() => void beginSignIn()}
        title={t("signInTitle")}
      />
    </AppScreen>
  );
}

function LockedState() {
  const { entitlement, locale, session, t } = useShop();
  if (entitlement?.kind !== "locked" || session.kind !== "signed_in")
    return null;
  const nextReservation = entitlement.nextReservationStartsAt
    ? t("lockedNext", {
        date: formatPragueDay(entitlement.nextReservationStartsAt, locale),
      })
    : t("lockedNoReservation");

  return (
    <AppScreen>
      <View style={styles.lockedTicket}>
        <View style={styles.lockedMark}>
          <Text style={styles.lockedMarkText}>⌁</Text>
        </View>
        <Text accessibilityRole="header" style={styles.lockedTitle}>
          {t("lockedTitle")}
        </Text>
        <View style={styles.nextReservation}>
          <Text style={styles.nextReservationText}>{nextReservation}</Text>
        </View>
      </View>
    </AppScreen>
  );
}

function CatalogState() {
  const {
    actionError,
    cart,
    catalog,
    catalogIsStale,
    entitlement,
    isActionPending,
    locale,
    refreshShop,
    session,
    t,
  } = useShop();
  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState<string | null>(null);

  const products = useMemo(() => {
    if (!catalog) return [];
    const needle = search.trim().toLocaleLowerCase();
    return catalog.products.filter((product) => {
      const categoryMatches =
        categoryId === null || product.categoryId === categoryId;
      const searchMatches =
        needle.length === 0 ||
        `${product.name.cs} ${product.name.en} ${product.description.cs} ${product.description.en}`
          .toLocaleLowerCase()
          .includes(needle);
      return categoryMatches && searchMatches;
    });
  }, [catalog, categoryId, search]);

  if (
    !catalog ||
    (!catalogIsStale &&
      (entitlement?.kind !== "eligible" || session.kind !== "signed_in"))
  )
    return null;

  return (
    <AppScreen
      footer={<CartDock onPress={() => router.push("/cart")} />}
      refresh={() => void refreshShop()}
      refreshing={isActionPending}
    >
      {actionError && <StatusBanner title={t("errorTitle")} tone="error" />}
      <View style={styles.catalogControls}>
        <View style={styles.searchWrap}>
          <AppIcon
            color={palette.secondaryInk}
            name={{ ios: "magnifyingglass", android: "search", web: "search" }}
            size={18}
          />
          <TextInput
            accessibilityLabel={t("searchLabel")}
            onChangeText={setSearch}
            placeholder={t("searchPlaceholder")}
            placeholderTextColor={palette.secondaryInk}
            returnKeyType="search"
            style={styles.search}
            value={search}
          />
        </View>
        <ScrollView
          contentContainerStyle={styles.categories}
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.categoriesScroller}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected: categoryId === null }}
            onPress={() => setCategoryId(null)}
          >
            <Pill label={t("allCategory")} selected={categoryId === null} />
          </Pressable>
          {catalog.categories.map((category) => (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: categoryId === category.id }}
              key={category.id}
              onPress={() => setCategoryId(category.id)}
            >
              <Pill
                label={localizeText(category.name, locale)}
                selected={categoryId === category.id}
              />
            </Pressable>
          ))}
        </ScrollView>
      </View>
      {catalogIsStale && <StatusBanner title={t("savedMenu")} tone="warning" />}
      {catalog.products.length === 0 && (
        <StatePanel
          action={
            <ActionButton
              label={t("refreshMenu")}
              onPress={() => void refreshShop()}
              variant="secondary"
            />
          }
          mark="↻"
          title={t("emptyCatalogTitle")}
        />
      )}
      {catalog.products.length > 0 && products.length === 0 && (
        <StatePanel mark="?" title={t("noSearchTitle")} />
      )}
      {products.length > 0 && (
        <View style={styles.products}>
          {products.map((product) => (
            <View key={product.id} style={styles.productRow}>
              <ProductCard
                product={product}
                quantity={
                  cart.find((line) => line.productId === product.id)
                    ?.quantity ?? 0
                }
              />
            </View>
          ))}
        </View>
      )}
    </AppScreen>
  );
}

export default function ShopScreen() {
  const {
    catalog,
    catalogIsStale,
    errorKind,
    loadState,
    retryLoad,
    session,
    entitlement,
    t,
  } = useShop();
  if (loadState === "loading") return <LaunchState />;
  if (loadState === "error") {
    const unavailable = errorKind === "unavailable";
    return (
      <AppScreen header={false}>
        <StatePanel
          action={
            <ActionButton label={t("retry")} onPress={() => void retryLoad()} />
          }
          mark="!"
          title={unavailable ? t("backendUnavailableTitle") : t("errorTitle")}
        />
      </AppScreen>
    );
  }
  if (catalogIsStale && catalog) return <CatalogState />;
  if (session.kind === "signed_out") return <SignInState />;
  if (entitlement?.kind === "locked") return <LockedState />;
  return <CatalogState />;
}

const styles = StyleSheet.create({
  launch: {
    backgroundColor: palette.canvas,
    flex: 1,
    justifyContent: "space-between",
    padding: spacing.lg,
    paddingBottom: 80,
    paddingTop: 64,
  },
  launchCopy: { maxWidth: 560 },
  launchTitle: { ...type.display, color: palette.ink },
  lockedTicket: {
    alignItems: "center",
    backgroundColor: palette.surface,
    borderColor: palette.outline,
    borderRadius: radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    gap: spacing.sm,
    marginBottom: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xl,
  },
  lockedMark: {
    alignItems: "center",
    backgroundColor: palette.warningSurface,
    borderRadius: radii.full,
    height: 72,
    justifyContent: "center",
    marginBottom: spacing.sm,
    width: 72,
  },
  lockedMarkText: { color: palette.actionInk, fontSize: 34, fontWeight: "700" },
  lockedTitle: { ...type.display, color: palette.ink, textAlign: "center" },
  nextReservation: {
    alignSelf: "flex-start",
    backgroundColor: palette.warningSurface,
    borderRadius: radii.sm,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  nextReservationText: { ...type.label, color: palette.ink },
  searchWrap: {
    alignItems: "center",
    backgroundColor: palette.surface,
    borderColor: palette.outline,
    borderRadius: 0,
    borderWidth: 1,
    flexDirection: "row",
    minHeight: 40,
    paddingLeft: spacing.sm,
  },
  search: {
    ...type.caption,
    color: palette.ink,
    flex: 1,
    height: 38,
    paddingHorizontal: spacing.sm,
    paddingVertical: 0,
    textAlignVertical: "center",
  },
  catalogControls: {
    alignSelf: "center",
    gap: spacing.md,
    maxWidth: 768,
    width: "100%",
  },
  categories: { gap: spacing.xs },
  categoriesScroller: { flexGrow: 0 },
  products: {
    alignSelf: "center",
    backgroundColor: palette.surface,
    borderColor: palette.outline,
    borderRadius: radii.sm,
    borderWidth: 1,
    marginTop: spacing.lg,
    maxWidth: 768,
    overflow: "hidden",
    width: "100%",
  },
  productRow: { width: "100%" },
});
