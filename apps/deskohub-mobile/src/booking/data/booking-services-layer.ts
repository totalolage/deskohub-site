import { Layer } from "effect";
import { Atom } from "effect/unstable/reactivity";
import type { CustomerDataServices } from "../../customer-api/customer-data-runtime";
import { BookingIds } from "../booking-ids.service";
import { paymentBrowserLayer } from "../payment-browser";
import type { PaymentBrowser } from "../payment-browser.service";
import { RememberedReferralCode } from "../remembered-referral.service";

/** The services booking commands need on top of the account's data runtime. */
export type BookingServices =
  | PaymentBrowser
  | RememberedReferralCode
  | BookingIds;

/**
 * The booking services' Layer for the account's registry. It may require
 * the data runtime's services and holds no per-account state of its own:
 * `RememberedReferralCode` is built over `AccountScopedStorage` (a
 * `deskohub.booking.` entry per `CustomerAccountScope`, cleared and fenced on
 * account exit), never `DeviceStorage` directly.
 *
 * The checkout flow runs each command on `customerDataRuntime` and provides
 * this Layer to that command only:
 *
 *   runCheckoutCommand(command).pipe(Effect.provide(get(bookingServicesLayer)))
 *
 * so `CustomerApi`, `AccountReadBudget` and the session check stay the single
 * instances the account's runtime built, never a second `customerDataLayer`.
 *
 * Its default is the live Layer (the platform's payment page, the account's
 * storage, random ids); sample-data mode keeps it but completes the fake
 * Workspace's payment page instead of opening it. Tests seed fakes with
 * `Atom.initialValue(bookingServicesLayer, layer)`. Kept alive so a seeded
 * Layer never falls back to the default; that keeps the Layer value, not
 * built services, which each command builds afresh. Booking services must
 * therefore be stateless in memory. One that needs in-memory state across
 * commands (such as a counter) instead needs a runtime that builds the
 * booking Layer once per registry over the account runtime's built context.
 */
export const bookingServicesLayer = Atom.keepAlive(
  Atom.make<Layer.Layer<BookingServices, never, CustomerDataServices>>(
    // Suspended because bun's tests don't define `__DEV__`; they seed fakes.
    Layer.suspend(() =>
      // Metro inlines `__DEV__` and EXPO_PUBLIC_ values and drops this
      // branch from release bundles, so the sample payment page and the fake
      // Workspace never ship there; a static import would bundle them.
      __DEV__ && process.env.EXPO_PUBLIC_ACCOUNT_SAMPLE_DATA === "1"
        ? (
            require("../testing/sample-booking-services-layer") as typeof import("../testing/sample-booking-services-layer")
          ).sampleBookingServicesLayer
        : Layer.mergeAll(
            paymentBrowserLayer,
            RememberedReferralCode.Default,
            BookingIds.Default
          )
    )
  )
);
