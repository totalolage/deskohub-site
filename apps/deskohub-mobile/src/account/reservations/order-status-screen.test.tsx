import { describe, expect, mock, spyOn, test } from "bun:test";
import { RegistryProvider } from "@effect/atom-react";
import { Atom } from "effect/unstable/reactivity";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AsyncView } from "../../customer-api/async-view";
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
import { LoadingIndicator } from "../../ui/loading-indicator";
import { elementTree, find } from "../../ui/testing/element-tree";
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
    if (
      !/incorrect casing|does not recognize the|non-boolean attribute/.test(
        String(args[0])
      )
    )
      error(...args);
  });
  try {
    return renderStatusScreen(visit);
  } finally {
    warnings.mockRestore();
  }
};

/** `screen` under the locale and the fake customer data it reads. */
const withCustomerData = (screen: ReactElement) => (
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
      {screen}
    </RegistryProvider>
  </AppLocaleProvider>
);

const renderStatusScreen = (visit: StatusVisit) =>
  renderToStaticMarkup(
    withCustomerData(
      <OrderStatusScreen orderId={sampleOrderIds.pending} visit={visit} />
    )
  );

/** The loading indicator on the status card shown before the first read. */
const pendingIndicator = (visit: StatusVisit) => {
  const screen = elementTree(
    OrderStatusScreen,
    { orderId: sampleOrderIds.pending, visit },
    withCustomerData
  );
  const pending = find(screen, AsyncView)?.props.loading;
  if (!isValidElement(pending) || typeof pending.type !== "function")
    throw new Error("No status card.");
  const card = pending.type as (props: unknown) => ReactNode;
  return find(
    elementTree(card, pending.props, withCustomerData),
    LoadingIndicator
  )?.props;
};

const headings = (markup: string) =>
  [...markup.matchAll(/<Text[^>]*role="heading"[^>]*>([^<]*)<\/Text>/g)].map(
    (match) => match[1]
  );

const progressBars = (markup: string) =>
  [...markup.matchAll(/<View[^>]*role="progressbar"[^>]*>/g)].length;

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

    test(`checks with the labelled brand die at section size (${visit})`, () => {
      expect(pendingIndicator(visit)).toEqual({
        size: "section",
        tone: "brand",
        label: m.account_loading({}, { locale: "en-US" }),
      });
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
