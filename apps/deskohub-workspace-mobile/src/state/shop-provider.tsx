import NetInfo from "@react-native-community/netinfo";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Platform } from "react-native";
import { shopAnalytics } from "@/src/analytics/shop-analytics";
import { ShopApiError, selectShopApi } from "@/src/api";
import { getCartQuantity, setCartQuantity } from "@/src/domain/cart";
import { getDefaultLocale } from "@/src/domain/format";
import type {
  AppUpdateState,
  CartLine,
  Catalog,
  CheckoutQuote,
  Locale,
  PaymentHandoff,
  Purchase,
  ShopEntitlement,
  ShopSession,
} from "@/src/domain/shop";
import { type MessageKey, translate } from "@/src/i18n/messages";
import { useAppUpdates } from "@/src/platform/use-app-updates";
import { createCartStorage } from "@/src/storage/cart-storage";
import { createCatalogStorage } from "@/src/storage/catalog-storage";
import { deviceStorage } from "@/src/storage/device-storage";
import {
  type AnalyticsConsent,
  createPreferenceStorage,
} from "@/src/storage/preference-storage";

type LoadState = "loading" | "ready" | "error";
type SignInState = "idle" | "opening" | "error";

type ShopContextValue = Readonly<{
  apiMode: "demo" | "live" | "unavailable";
  loadState: LoadState;
  errorKind: ShopApiError["kind"] | null;
  session: ShopSession;
  entitlement: ShopEntitlement | null;
  catalog: Catalog | null;
  catalogIsStale: boolean;
  purchases: readonly Purchase[];
  cart: readonly CartLine[];
  cartQuantity: number;
  quote: CheckoutQuote | null;
  paymentHandoff: PaymentHandoff | null;
  paymentPurchase: Purchase | null;
  locale: Locale;
  analyticsConsent: AnalyticsConsent;
  updateState: AppUpdateState;
  isOnline: boolean;
  isOnWifi: boolean;
  signInState: SignInState;
  actionError: string | null;
  isActionPending: boolean;
  t: (
    key: MessageKey,
    variables?: Readonly<Record<string, string | number>>
  ) => string;
  beginSignIn: () => Promise<boolean>;
  retryLoad: () => Promise<void>;
  refreshShop: () => Promise<void>;
  signOut: () => Promise<void>;
  setProductQuantity: (productId: string, quantity: number) => void;
  prepareQuote: () => Promise<CheckoutQuote | null>;
  startPayment: () => Promise<PaymentHandoff | null>;
  completePaymentHandoff: () => Promise<Purchase | null>;
  loadPurchase: (orderId: string) => Promise<Purchase | null>;
  refreshPurchase: (orderId: string) => Promise<Purchase | null>;
  setLocale: (locale: Locale) => void;
  setAnalyticsConsent: (consent: AnalyticsConsent) => void;
  checkForUpdate: () => Promise<void>;
  applyUpdate: () => Promise<void>;
  clearActionError: () => void;
}>;

const ShopContext = createContext<ShopContextValue | null>(null);
const runtime = selectShopApi();
const cartStorage = createCartStorage(deviceStorage);
const catalogStorage = createCatalogStorage(deviceStorage);
const preferenceStorage = createPreferenceStorage(deviceStorage);

function errorKind(error: unknown): ShopApiError["kind"] {
  return error instanceof ShopApiError ? error.kind : "unknown";
}

export function ShopProvider({ children }: PropsWithChildren) {
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [loadErrorKind, setLoadErrorKind] = useState<
    ShopApiError["kind"] | null
  >(null);
  const [session, setSession] = useState<ShopSession>({ kind: "signed_out" });
  const [entitlement, setEntitlement] = useState<ShopEntitlement | null>(null);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [catalogIsStale, setCatalogIsStale] = useState(false);
  const [purchases, setPurchases] = useState<readonly Purchase[]>([]);
  const [cart, setCart] = useState<readonly CartLine[]>([]);
  const [quote, setQuote] = useState<CheckoutQuote | null>(null);
  const [paymentHandoff, setPaymentHandoff] = useState<PaymentHandoff | null>(
    null
  );
  const [paymentPurchase, setPaymentPurchase] = useState<Purchase | null>(null);
  const [locale, setLocaleState] = useState<Locale>(getDefaultLocale);
  const [analyticsConsent, setAnalyticsConsentState] =
    useState<AnalyticsConsent>("denied");
  const appUpdates = useAppUpdates();
  const [isOnline, setIsOnline] = useState(true);
  const [isOnWifi, setIsOnWifi] = useState(false);
  const [signInState, setSignInState] = useState<SignInState>("idle");
  const [actionError, setActionError] = useState<string | null>(null);
  const [isActionPending, setIsActionPending] = useState(false);
  const loadSignedInContent = useCallback(async (targetLocale: Locale) => {
    const [nextEntitlement, nextPurchases] = await Promise.all([
      runtime.api.getEntitlement(),
      runtime.api.listPurchases(),
    ]);
    setEntitlement(nextEntitlement);
    setPurchases(nextPurchases);
    if (nextEntitlement.kind === "eligible") {
      try {
        const nextCatalog = await runtime.api.getCatalog(targetLocale);
        setCatalog(nextCatalog);
        setCatalogIsStale(false);
        await catalogStorage.save(targetLocale, nextCatalog);
      } catch (error) {
        const cachedCatalog = await catalogStorage.load(targetLocale);
        if (!cachedCatalog) throw error;
        setCatalog(cachedCatalog);
        setCatalogIsStale(true);
      }
    } else {
      setCatalog(null);
      setCatalogIsStale(false);
    }
  }, []);

  const bootstrap = useCallback(async () => {
    setLoadState("loading");
    setLoadErrorKind(null);
    let cachedCatalog: Catalog | null = null;
    try {
      if (Platform.OS !== "web") {
        const initialUrl = await Linking.getInitialURL();
        if (initialUrl?.includes("://auth/callback?")) {
          await runtime.api.completeSignInHandoff(initialUrl);
        }
      }
      const [persistedCart, persistedLocale, persistedConsent] =
        await Promise.all([
          cartStorage.load(),
          preferenceStorage.loadLocale(),
          preferenceStorage.loadAnalyticsConsent(),
        ]);
      const targetLocale = persistedLocale ?? getDefaultLocale();
      cachedCatalog = await catalogStorage.load(targetLocale);
      setCart(persistedCart);
      if (persistedLocale) setLocaleState(persistedLocale);
      setAnalyticsConsentState(persistedConsent);
      await shopAnalytics.setConsent(persistedConsent === "allowed");
      const nextSession = await runtime.api.getSession();
      setSession(nextSession);
      if (nextSession.kind === "signed_in") {
        await loadSignedInContent(targetLocale);
      }
      setLoadState("ready");
    } catch (error) {
      if (cachedCatalog) {
        setCatalog(cachedCatalog);
        setCatalogIsStale(true);
        setLoadState("ready");
        return;
      }
      setLoadErrorKind(errorKind(error));
      setLoadState("error");
    }
  }, [loadSignedInContent]);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  useEffect(() => {
    if (Platform.OS === "web") document.documentElement.lang = locale;
  }, [locale]);

  useEffect(
    () =>
      NetInfo.addEventListener((state) => {
        setIsOnline(
          state.isConnected === true && state.isInternetReachable !== false
        );
        setIsOnWifi(state.type === "wifi");
      }),
    []
  );

  const beginSignIn = useCallback(async () => {
    setSignInState("opening");
    setIsActionPending(true);
    setActionError(null);
    try {
      if (runtime.mode === "live") {
        const handoff = await runtime.api.prepareSignInHandoff(locale);
        if (Platform.OS === "web") {
          window.location.assign(handoff.url);
          return true;
        }
        const result = await WebBrowser.openAuthSessionAsync(
          handoff.url,
          handoff.callbackUrl
        );
        if (result.type !== "success") {
          setSignInState("idle");
          return false;
        }
        const nextSession = await runtime.api.completeSignInHandoff(result.url);
        if (nextSession.kind === "signed_out") {
          setActionError("native_auth_unavailable");
          setSignInState("error");
          return false;
        }
        setSession(nextSession);
        await loadSignedInContent(locale);
        shopAnalytics.capture("shop_signed_in");
        setSignInState("idle");
        return true;
      }
      const nextSession = await runtime.api.completeSignInHandoff();
      if (nextSession.kind === "signed_out") {
        setActionError("native_auth_unavailable");
        setSignInState("error");
        return false;
      }
      setSession(nextSession);
      await loadSignedInContent(locale);
      shopAnalytics.capture("shop_signed_in");
      setSignInState("idle");
      return true;
    } catch (error) {
      setSignInState("error");
      setActionError(errorKind(error));
      return false;
    } finally {
      setIsActionPending(false);
    }
  }, [loadSignedInContent, locale]);

  const refreshShop = useCallback(async () => {
    setIsActionPending(true);
    setActionError(null);
    try {
      if (session.kind === "signed_in") await loadSignedInContent(locale);
      shopAnalytics.capture("shop_catalog_refreshed");
      setLoadState("ready");
    } catch (error) {
      setActionError(errorKind(error));
    } finally {
      setIsActionPending(false);
    }
  }, [loadSignedInContent, locale, session.kind]);

  const signOut = useCallback(async () => {
    setIsActionPending(true);
    setActionError(null);
    try {
      await runtime.api.signOut();
    } catch (error) {
      setActionError(errorKind(error));
    } finally {
      // Signing out locally is authoritative even if remote session revocation
      // cannot complete while the device is offline.
      setSession({ kind: "signed_out" });
      setEntitlement(null);
      setCatalog(null);
      setCatalogIsStale(false);
      setPurchases([]);
      setQuote(null);
      setPaymentHandoff(null);
      setPaymentPurchase(null);
      setSignInState("idle");
      setIsActionPending(false);
    }
  }, []);

  const setProductQuantity = useCallback(
    (productId: string, quantity: number) => {
      setCart((currentCart) => {
        const nextCart = setCartQuantity(currentCart, productId, quantity);
        void cartStorage.save(nextCart);
        return nextCart;
      });
      setQuote(null);
    },
    []
  );

  const prepareQuote = useCallback(async () => {
    if (!isOnline || cart.length === 0) return null;
    setIsActionPending(true);
    setActionError(null);
    try {
      const nextQuote = await runtime.api.quoteCart(cart, locale);
      setQuote(nextQuote);
      shopAnalytics.capture("shop_quote_confirmed", {
        item_count: getCartQuantity(cart),
      });
      return nextQuote;
    } catch (error) {
      setActionError(errorKind(error));
      return null;
    } finally {
      setIsActionPending(false);
    }
  }, [cart, isOnline, locale]);

  const startPayment = useCallback(async () => {
    if (!isOnline || !quote) return null;
    setIsActionPending(true);
    setActionError(null);
    try {
      const handoff = await runtime.api.createHostedPayment(
        quote,
        cart,
        locale
      );
      setPaymentHandoff(handoff);
      setPaymentPurchase(null);
      shopAnalytics.capture("shop_payment_started");
      return handoff;
    } catch (error) {
      setActionError(errorKind(error));
      return null;
    } finally {
      setIsActionPending(false);
    }
  }, [cart, isOnline, locale, quote]);

  const reconcilePurchase = useCallback(async (orderId: string) => {
    setIsActionPending(true);
    setActionError(null);
    try {
      const purchase = await runtime.api.reconcilePayment(orderId);
      setPaymentPurchase(purchase);
      setPurchases((currentPurchases) => [
        purchase,
        ...currentPurchases.filter((candidate) => candidate.id !== purchase.id),
      ]);
      if (purchase.status === "paid") {
        setCart([]);
        setQuote(null);
        await cartStorage.clear();
      }
      shopAnalytics.capture("shop_payment_reconciled", {
        status: purchase.status,
      });
      return purchase;
    } catch (error) {
      setActionError(errorKind(error));
      return null;
    } finally {
      setIsActionPending(false);
    }
  }, []);

  const completePaymentHandoff = useCallback(async () => {
    if (!paymentHandoff || !isOnline) return null;
    if (runtime.mode === "live") {
      await WebBrowser.openBrowserAsync(paymentHandoff.hostedPaymentUrl);
    }
    return reconcilePurchase(paymentHandoff.orderId);
  }, [isOnline, paymentHandoff, reconcilePurchase]);

  const refreshPurchase = useCallback(
    async (orderId: string) => {
      if (!isOnline) return null;
      return reconcilePurchase(orderId);
    },
    [isOnline, reconcilePurchase]
  );

  const loadPurchase = useCallback(async (orderId: string) => {
    setIsActionPending(true);
    setActionError(null);
    try {
      const purchase = await runtime.api.getPurchase(orderId);
      setPurchases((currentPurchases) => [
        purchase,
        ...currentPurchases.filter((candidate) => candidate.id !== purchase.id),
      ]);
      return purchase;
    } catch (error) {
      setActionError(errorKind(error));
      return null;
    } finally {
      setIsActionPending(false);
    }
  }, []);

  const setLocale = useCallback(
    (nextLocale: Locale) => {
      setLocaleState(nextLocale);
      void preferenceStorage.saveLocale(nextLocale);
      if (entitlement?.kind === "eligible" || catalogIsStale) {
        void (async () => {
          try {
            if (!isOnline) throw new ShopApiError("Offline", "offline");
            const nextCatalog = await runtime.api.getCatalog(nextLocale);
            setCatalog(nextCatalog);
            setCatalogIsStale(false);
            await catalogStorage.save(nextLocale, nextCatalog);
          } catch {
            const cachedCatalog = await catalogStorage.load(nextLocale);
            if (cachedCatalog) {
              setCatalog(cachedCatalog);
              setCatalogIsStale(true);
            }
          }
        })();
      }
    },
    [catalogIsStale, entitlement?.kind, isOnline]
  );

  const setAnalyticsConsent = useCallback((consent: AnalyticsConsent) => {
    setAnalyticsConsentState(consent);
    void preferenceStorage.saveAnalyticsConsent(consent);
    void shopAnalytics.setConsent(consent === "allowed");
  }, []);

  const t = useCallback(
    (
      key: MessageKey,
      variables: Readonly<Record<string, string | number>> = {}
    ) => translate(locale, key, variables),
    [locale]
  );

  const value = useMemo<ShopContextValue>(
    () => ({
      apiMode: runtime.mode,
      loadState,
      errorKind: loadErrorKind,
      session,
      entitlement,
      catalog,
      catalogIsStale,
      purchases,
      cart,
      cartQuantity: getCartQuantity(cart),
      quote,
      paymentHandoff,
      paymentPurchase,
      locale,
      analyticsConsent,
      updateState: appUpdates.state,
      isOnline,
      isOnWifi,
      signInState,
      actionError,
      isActionPending,
      t,
      beginSignIn,
      retryLoad: bootstrap,
      refreshShop,
      signOut,
      setProductQuantity,
      prepareQuote,
      startPayment,
      completePaymentHandoff,
      loadPurchase,
      refreshPurchase,
      setLocale,
      setAnalyticsConsent,
      checkForUpdate: appUpdates.check,
      applyUpdate: appUpdates.apply,
      clearActionError: () => setActionError(null),
    }),
    [
      actionError,
      analyticsConsent,
      appUpdates.apply,
      appUpdates.check,
      appUpdates.state,
      beginSignIn,
      bootstrap,
      cart,
      catalog,
      catalogIsStale,
      completePaymentHandoff,
      entitlement,
      isActionPending,
      isOnline,
      isOnWifi,
      loadErrorKind,
      loadState,
      locale,
      loadPurchase,
      paymentHandoff,
      paymentPurchase,
      prepareQuote,
      purchases,
      quote,
      refreshPurchase,
      refreshShop,
      session,
      setAnalyticsConsent,
      setLocale,
      setProductQuantity,
      signOut,
      startPayment,
      t,
      signInState,
    ]
  );

  return <ShopContext.Provider value={value}>{children}</ShopContext.Provider>;
}

export function useShop(): ShopContextValue {
  const context = useContext(ShopContext);
  if (!context) throw new Error("useShop must be used inside ShopProvider");
  return context;
}
