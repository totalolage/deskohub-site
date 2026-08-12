/*
THESIS: The shop behaves like an honest fridge ticket—immediate, legible, and finished in a few taps, never a generic delivery marketplace.
OWN-WORLD: Deskohub navy anchors the frame; aquamarine means access and completion; tactile paper surfaces hold the working menu.
STORY: Confirm access, mark exactly what was taken, review the server-confirmed amount, then pay securely.
FIRST VIEWPORT: A compact brand bar gives way to today’s access ticket and the question “What are you taking?” with search immediately below.
FORM: An established-brand Operate surface using a compact Android navigation bar, responsive product ledger, and persistent cart action.
*/

import { router } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useMemo, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";

import { AppScreen, ScreenIntro } from "@/components/AppScreen";
import { Brand } from "@/components/Brand";
import { CartDock } from "@/components/CartDock";
import {
  ActionButton,
  Pill,
  StatePanel,
  StatusBanner,
} from "@/components/Controls";
import { ProductCard } from "@/components/ProductCard";
import { palette, radii, spacing, type } from "@/constants/Theme";
import { formatPragueDay, localizeText } from "@/src/domain/format";
import { useShop } from "@/src/state/shop-provider";

function LaunchState() {
  const { t } = useShop();
  return (
    <View style={styles.launch}>
      <Brand inverse />
      <View style={styles.launchCopy}>
        <View style={styles.launchLine} />
        <Text accessibilityRole="header" style={styles.launchTitle}>
          {t("loadingTitle")}
        </Text>
        <Text style={styles.launchBody}>{t("loadingBody")}</Text>
      </View>
    </View>
  );
}

function SignInState() {
  const { actionError, beginSignIn, isActionPending, signInState, t } =
    useShop();

  return (
    <AppScreen>
      <View style={styles.signInShell}>
        <View style={styles.signInMark}>
          <SymbolView
            name={{
              ios: "basket",
              android: "shopping_basket",
              web: "shopping_basket",
            }}
            size={34}
            tintColor={palette.navy}
          />
        </View>
        <View style={styles.signInHero}>
          <Text accessibilityRole="header" style={styles.signInTitle}>
            {t("signInTitle")}
          </Text>
          <Text style={styles.signInBody}>{t("signInBody")}</Text>
        </View>
        <View style={styles.signInForm}>
          <Text style={styles.handoffBody}>{t("signInHandoffBody")}</Text>
          {actionError === "native_auth_unavailable" && (
            <StatusBanner
              body={t("nativeAuthUnavailableBody")}
              title={t("nativeAuthUnavailableTitle")}
              tone="warning"
            />
          )}
          {actionError && actionError !== "native_auth_unavailable" && (
            <StatusBanner
              body={t("errorBody")}
              title={t("errorTitle")}
              tone="error"
            />
          )}
          <ActionButton
            label={
              signInState === "opening"
                ? t("openingSignIn")
                : t("continueToSignIn")
            }
            loading={isActionPending}
            onPress={() => void beginSignIn()}
          />
        </View>
      </View>
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
        <Text style={styles.lockedBody}>{t("lockedBody")}</Text>
        <View style={styles.nextReservation}>
          <Text style={styles.nextReservationText}>{nextReservation}</Text>
        </View>
      </View>
      <StatusBanner
        body={t("lockedHistory")}
        title={
          session.customer.email
            ? t("signedInAs", { email: session.customer.email })
            : t("appName")
        }
      />
    </AppScreen>
  );
}

function CatalogState() {
  const { width } = useWindowDimensions();
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
  const columns = width >= 680 ? 2 : 1;
  const compact = width < 480;

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
      {!catalogIsStale && (
        <View
          style={[styles.accessTicket, compact && styles.accessTicketCompact]}
        >
          <View style={styles.accessDot}>
            <Text style={styles.accessDotText}>✓</Text>
          </View>
          <View style={styles.accessCopy}>
            <Text style={styles.accessTitle}>{t("accessToday")}</Text>
            <Text style={styles.accessBody}>{t("accessUntil")}</Text>
          </View>
          <Text style={styles.accessChevron}>›</Text>
        </View>
      )}
      <ScreenIntro
        kicker={
          session.kind === "signed_in" && session.customer.displayName
            ? `${t("shopGreeting")}, ${session.customer.displayName}`
            : t("shopGreeting")
        }
        title={t("shopTitle")}
        body={t("shopSubtitle")}
      />
      {actionError && (
        <StatusBanner
          body={t("errorBody")}
          title={t("errorTitle")}
          tone="error"
        />
      )}
      <View style={styles.searchWrap}>
        <SymbolView
          name={{ ios: "magnifyingglass", android: "search", web: "search" }}
          size={22}
          tintColor={palette.navyMuted}
        />
        <TextInput
          accessibilityLabel={t("searchLabel")}
          onChangeText={setSearch}
          placeholder={t("searchPlaceholder")}
          placeholderTextColor="#737493"
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
          onPress={() => setCategoryId(null)}
        >
          <Pill label={t("allCategory")} selected={categoryId === null} />
        </Pressable>
        {catalog.categories.map((category) => (
          <Pressable
            accessibilityRole="button"
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
      {catalogIsStale && (
        <StatusBanner
          body={t("offlineBody")}
          title={t("offlineTitle")}
          tone="warning"
        />
      )}
      {catalog.products.length === 0 && (
        <StatePanel
          action={
            <ActionButton
              label={t("refreshMenu")}
              onPress={() => void refreshShop()}
              variant="secondary"
            />
          }
          body={t("emptyCatalogBody")}
          mark="↻"
          title={t("emptyCatalogTitle")}
        />
      )}
      {catalog.products.length > 0 && products.length === 0 && (
        <StatePanel
          body={t("noSearchBody")}
          mark="?"
          title={t("noSearchTitle")}
        />
      )}
      <View style={styles.products}>
        {products.map((product) => (
          <View
            key={product.id}
            style={{ width: columns === 2 ? "48.8%" : "100%" }}
          >
            <ProductCard
              product={product}
              quantity={
                cart.find((line) => line.productId === product.id)?.quantity ??
                0
              }
            />
          </View>
        ))}
      </View>
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
          body={unavailable ? t("backendUnavailableBody") : t("errorBody")}
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
    backgroundColor: palette.navy,
    flex: 1,
    justifyContent: "space-between",
    padding: spacing.lg,
    paddingBottom: 80,
    paddingTop: 64,
  },
  launchCopy: { maxWidth: 560 },
  launchLine: {
    backgroundColor: palette.aquamarine,
    height: 6,
    marginBottom: spacing.lg,
    width: 72,
  },
  launchTitle: { ...type.display, color: palette.white },
  launchBody: { ...type.body, color: "#D7D7E5", marginTop: spacing.sm },
  signInShell: {
    alignSelf: "center",
    flex: 1,
    justifyContent: "center",
    maxWidth: 620,
    paddingVertical: spacing.xl,
    width: "100%",
  },
  signInMark: {
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: palette.warningSurface,
    borderRadius: radii.full,
    height: 64,
    justifyContent: "center",
    marginBottom: spacing.lg,
    width: 64,
  },
  signInHero: {
    gap: spacing.sm,
  },
  signInTitle: { ...type.display, color: palette.navy },
  signInBody: { ...type.body, color: palette.navyMuted },
  signInForm: { gap: spacing.sm, marginTop: spacing.lg },
  handoffBody: { ...type.body, color: palette.navyMuted },
  input: {
    ...type.body,
    backgroundColor: palette.surface,
    borderColor: palette.silver,
    borderRadius: radii.md,
    borderWidth: 1,
    color: palette.navy,
    minHeight: 54,
    paddingHorizontal: spacing.md,
  },
  stateActions: { gap: spacing.sm },
  helpText: { ...type.caption, color: palette.navyMuted, textAlign: "center" },
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
  lockedMarkText: { color: palette.orangeInk, fontSize: 34, fontWeight: "700" },
  lockedTitle: { ...type.display, color: palette.navy, textAlign: "center" },
  lockedBody: { ...type.body, color: palette.navyMuted, textAlign: "center" },
  nextReservation: {
    alignSelf: "flex-start",
    backgroundColor: palette.warningSurface,
    borderRadius: radii.sm,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  nextReservationText: { ...type.label, color: palette.navy },
  accessTicket: {
    alignItems: "center",
    backgroundColor: palette.successSurface,
    borderRadius: radii.md,
    flexDirection: "row",
    gap: spacing.sm,
    marginBottom: spacing.lg,
    padding: spacing.md,
  },
  accessTicketCompact: {
    marginBottom: spacing.sm,
    padding: spacing.sm,
  },
  accessDot: {
    alignItems: "center",
    backgroundColor: palette.success,
    borderRadius: radii.full,
    height: 34,
    justifyContent: "center",
    width: 34,
  },
  accessDotText: { color: palette.white, fontSize: 18, fontWeight: "800" },
  accessCopy: { flex: 1 },
  accessTitle: { ...type.label, color: palette.aquamarineInk },
  accessBody: { ...type.caption, color: palette.aquamarineInk },
  accessChevron: { color: palette.aquamarineInk, fontSize: 26 },
  searchWrap: {
    alignItems: "center",
    backgroundColor: palette.surface,
    borderColor: palette.outline,
    borderRadius: radii.md,
    borderWidth: 1,
    flexDirection: "row",
    paddingLeft: spacing.md,
  },
  search: {
    ...type.body,
    color: palette.navy,
    flex: 1,
    minHeight: 54,
    paddingHorizontal: spacing.sm,
  },
  categories: { gap: spacing.xs, paddingVertical: spacing.md },
  categoriesScroller: { flexGrow: 0 },
  products: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginTop: spacing.md,
  },
});
