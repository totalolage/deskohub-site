import { describe, expect, mock, spyOn, test } from "bun:test";
import { RegistryProvider } from "@effect/atom-react";
import { Atom } from "effect/unstable/reactivity";
import { renderToStaticMarkup } from "react-dom/server";
import { customerDataLayer } from "../../customer-api/customer-data-runtime";
import {
  fakeCustomerDataLayer,
  makeFakeDevice,
} from "../../customer-api/testing/fake-customer-data";
import { FakeWorkspace } from "../../customer-api/testing/fake-workspace";
import { sampleOrderIds } from "../../customer-api/testing/sample-fixtures";
import { AppLocaleProvider } from "../../i18n/locale-context";
import { m } from "../../i18n/messages";
import { expoRouterStandIn } from "../../testing/expo-router-stand-in";
import type { StatusVisit } from "./status-refresh-rules";

// The stand-in's focus effect never runs the screen's callback, so the
// screen stays unfocused and its first status read hasn't started.
mock.module("expo-router", () => expoRouterStandIn());

const { OrderStatusScreen } = await import("./order-status-screen");

/**
 * The screen's first paint, before its first status read has answered: the
 * markup a static render produces, with host components as their names.
 */
const firstPaint = (visit: StatusVisit) => {
  // React DOM warns about the React Native host names and props it renders.
  const { error } = console;
  const warnings = spyOn(console, "error").mockImplementation((...args) => {
    if (!/incorrect casing|does not recognize the/.test(String(args[0])))
      error(...args);
  });
  try {
    return renderStatusScreen(visit);
  } finally {
    warnings.mockRestore();
  }
};

const renderStatusScreen = (visit: StatusVisit) =>
  renderToStaticMarkup(
    <AppLocaleProvider locale="en-US">
      <RegistryProvider
        initialValues={[
          Atom.initialValue(
            customerDataLayer,
            fakeCustomerDataLayer({
              workspace: FakeWorkspace.forKind("linked"),
              device: makeFakeDevice(),
            })
          ),
        ]}
      >
        <OrderStatusScreen orderId={sampleOrderIds.pending} visit={visit} />
      </RegistryProvider>
    </AppLocaleProvider>
  );

const headings = (markup: string) =>
  [...markup.matchAll(/<Text[^>]*role="heading"[^>]*>([^<]*)<\/Text>/g)].map(
    (match) => match[1]
  );

const progressBars = (markup: string) =>
  [...markup.matchAll(/<ActivityIndicator[^>]*role="progressbar"[^>]*>/g)]
    .length;

// The deep-link return from payment opened on a lone spinner, which read as
// a blank screen until the first read answered (#1131). The screen opens on
// its status card instead, saying the reservation is being checked.
describe("the status screen before its first read answers", () => {
  for (const visit of ["after-payment", "normal"] as const) {
    test(`shows the status card checking the reservation (${visit})`, () => {
      const markup = firstPaint(visit);
      expect(headings(markup)).toEqual([
        m.reservations_refresh_reading({}, { locale: "en-US" }),
      ]);
      expect(progressBars(markup)).toBe(1);
    });

    test(`shows no order details yet (${visit})`, () => {
      const markup = firstPaint(visit);
      expect(markup).not.toContain(
        m.reservations_order_payment({}, { locale: "en-US" })
      );
      expect(markup).not.toContain(
        m.reservations_refresh({}, { locale: "en-US" })
      );
    });
  }
});
