import { afterEach, describe, expect, mock, test } from "bun:test";
import { Effect } from "effect";
import {
  act,
  Children,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { AppLocaleProvider } from "../i18n/locale-context";
import { m } from "../i18n/messages";
import { clientRoot } from "../testing/client-root";
import { eventually } from "../testing/eventually";
import { expoRouterStandIn } from "../testing/expo-router-stand-in";
import { LiveMessage } from "../ui/controls";
import { LoadingIndicator } from "../ui/loading-indicator";
import { elementTree, find, findAll } from "../ui/testing/element-tree";
import type { AuthSessionState } from "./auth-session-state";

const session: AuthSessionState = { status: "signed-out" };

mock.module("./use-auth-session", () => ({
  useAuthSession: () => session,
}));
/**
 * Bun links later test files' imports against the first mock of a module,
 * so the stand-in names everything the app imports from Expo Router; this
 * screen uses only `router`, once a link is verified.
 */
const unusedRouterExport = () => {
  throw new Error("Not used by the callback screen.");
};
mock.module("expo-router", () => ({
  ...expoRouterStandIn(),
  Redirect: unusedRouterExport,
  SplashScreen: { hideAsync: unusedRouterExport },
  Stack: unusedRouterExport,
  Tabs: unusedRouterExport,
  usePathname: unusedRouterExport,
  useSegments: unusedRouterExport,
  useLocalSearchParams: unusedRouterExport,
  router: {
    canGoBack: () => false,
    back: unusedRouterExport,
    replace: unusedRouterExport,
  },
}));

const { AuthCallbackScreen } = await import("./auth-callback-screen.web");

const inLocale = (screen: ReactElement) => (
  <AppLocaleProvider locale="en-US">{screen}</AppLocaleProvider>
);

/** The status message and the loading indicator, as the screen shows them. */
const progressIn = (tree: ReactNode) => ({
  indicator: find(tree, LoadingIndicator)?.props,
  status: findAll(tree, LiveMessage).find(
    ({ props }) => props.role === "status"
  )?.props.message,
});

describe("the web AuthCallbackScreen", () => {
  const { render } = clientRoot();
  afterEach(async () => {
    await render(null);
  });

  // Its first paint, before verifying the link has started.
  test("shows the brand die above its status while it verifies the link", () => {
    const tree = elementTree(AuthCallbackScreen, {}, inLocale);
    expect(progressIn(tree)).toEqual({
      indicator: { size: "screen", tone: "brand" },
      status: m.callback_completing({}, { locale: "en-US" }),
    });
    // The die sits right above the status message.
    const shown = Children.toArray(
      isValidElement<{ children?: ReactNode }>(tree) ? tree.props.children : []
    ).filter((child) => isValidElement<{ role?: string }>(child));
    const statusAt = shown.findIndex(
      (child) => child.type === LiveMessage && child.props.role === "status"
    );
    expect(shown[statusAt - 1]?.type).toBe(LoadingIndicator);
  });

  // No link was captured on this page load, so verifying it fails at once.
  test("takes the die away once verifying the link failed", async () => {
    let tree: ReactNode = null;
    const Probe = () => {
      tree = AuthCallbackScreen();
      return null;
    };
    await render(inLocale(<Probe />));
    const alert = () =>
      findAll(tree, LiveMessage).find(({ props }) => props.role === "alert")
        ?.props.message;
    await act(() => Effect.runPromise(eventually(() => alert() !== undefined)));

    expect(progressIn(tree)).toEqual({
      indicator: undefined,
      status: undefined,
    });
  });
});
