import { describe, expect, mock, spyOn, test } from "bun:test";
import { RegistryContext } from "@effect/atom-react";
import { Layer } from "effect";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { makeFakeDeviceConsent } from "../../consent/testing/fake-device-consent";
import { accountAtom } from "../../customer-api/customer-data-runtime";
import {
  makeCustomerDataRegistry,
  settle,
} from "../../customer-api/testing/customer-data-test-registry";
import {
  fakeCustomerDataLayer,
  makeFakeDevice,
} from "../../customer-api/testing/fake-customer-data";
import { FakeWorkspace } from "../../customer-api/testing/fake-workspace";
import type { SampleAccountKind } from "../../customer-api/testing/sample-fixtures";
import { AppLocaleProvider } from "../../i18n/locale-context";
import { m } from "../../i18n/messages";
import { expoRouterStandIn } from "../../testing/expo-router-stand-in";
import { analyticsPreferenceAtom } from "./analytics-preference";
import { marketingPreferencesAtom } from "./marketing-preferences";

mock.module("expo-router", () => expoRouterStandIn());
// A static render can't take the pressed-state functions a Pressable's style
// and children may be; they render unpressed.
const reactNative = await import("react-native");
mock.module("react-native", () => ({
  ...reactNative,
  Pressable: ({
    style,
    children,
    ...props
  }: {
    readonly style?: unknown;
    readonly children?:
      | ReactNode
      | ((state: { pressed: boolean }) => ReactNode);
  }) =>
    createElement(
      "Pressable",
      {
        ...props,
        style: typeof style === "function" ? style({ pressed: false }) : style,
      },
      typeof children === "function" ? children({ pressed: false }) : children
    ),
}));
// The document links only need the origin, not the native auth client.
mock.module("../../auth/auth-client", () => ({
  apiOrigin: "https://workspace.test",
}));

const { LegalScreen } = await import("./legal-screen");

const label = m.legal_analytics_switch_label({}, { locale: "en-US" });
const unavailable = m.legal_analytics_unavailable({}, { locale: "en-US" });

/**
 * The Legal screen of a signed-in account in `kind` whose analytics
 * preference is granted, once the screen's reads have answered: the markup a
 * static render produces, with host components as their names.
 */
const legalScreen = async (kind: SampleAccountKind) => {
  const workspace = FakeWorkspace.forKind(kind);
  workspace.analyticsDecision = {
    granted: true,
    decidedAt: "2026-10-01T08:00:00.000Z",
    notice: "current",
  };
  const device = makeFakeDeviceConsent({
    stored: { kind: "undecided" },
    accountId: workspace.data.accountId,
  });
  const registry = makeCustomerDataRegistry(
    Layer.mergeAll(
      fakeCustomerDataLayer({ workspace, device: makeFakeDevice() }),
      device.layer
    )
  );
  const unmount = [
    registry.mount(accountAtom),
    registry.mount(marketingPreferencesAtom),
    registry.mount(analyticsPreferenceAtom),
  ];
  await Promise.all([
    settle(registry, accountAtom),
    settle(registry, marketingPreferencesAtom),
    settle(registry, analyticsPreferenceAtom),
  ]);

  // React DOM warns about the React Native host names and props it renders.
  const { error } = console;
  const warnings = spyOn(console, "error").mockImplementation((...args) => {
    if (!/incorrect casing|does not recognize the/.test(String(args[0])))
      error(...args);
  });
  try {
    return renderToStaticMarkup(
      <AppLocaleProvider locale="en-US">
        <RegistryContext value={registry}>
          <LegalScreen />
        </RegistryContext>
      </AppLocaleProvider>
    );
  } finally {
    warnings.mockRestore();
    for (const stop of unmount) stop();
  }
};

const analyticsSwitches = (markup: string) =>
  [...markup.matchAll(/<Switch[^>]*aria-label="([^"]*)"[^>]*>/g)]
    .map((match) => match[1])
    .filter((name) => name === label).length;

// The analytics preference belongs to the signed-in account, not to its
// Dotypos profile: the site shows it to every signed-in account, so the app
// doesn't hide it behind profile completion or a profile outage.
describe("the Legal screen's analytics preference", () => {
  for (const kind of [
    "linked",
    "completion-required",
    "authenticated-unavailable",
  ] as const) {
    test(`shows the account's switch (${kind})`, async () => {
      const markup = await legalScreen(kind);
      expect(analyticsSwitches(markup)).toBe(1);
      expect(markup).not.toContain(unavailable);
    });
  }
});

// The app doesn't offer the site's data export: every signed-in account sees
// the archive section's row saying so.
describe("the Legal screen's personal data archive", () => {
  const archiveRow = m.legal_archive_unavailable({}, { locale: "en-US" });

  for (const kind of [
    "linked",
    "completion-required",
    "authenticated-unavailable",
  ] as const) {
    test(`keeps its archive row (${kind})`, async () => {
      const markup = await legalScreen(kind);
      expect(markup).toContain(archiveRow);
    });
  }
});
