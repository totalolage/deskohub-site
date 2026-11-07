import { Layer } from "effect";
import { Atom } from "effect/unstable/reactivity";
import type { CustomerDataServices } from "../../customer-api/customer-data-runtime";

/**
 * The services booking commands need on top of the account's data runtime.
 * A placeholder until the checkout stream lands them: it becomes
 * `PaymentBrowser | RememberedReferralCode | BookingIds`.
 */
export type BookingServices = never;

/**
 * The booking services' Layer for the account's registry. It may require
 * the data runtime's services and holds no per-account state of its own:
 * `RememberedReferralCode` is built over `AccountScopedStorage` (a
 * `deskohub.booking.` key per `CustomerAccountScope`, cleared and fenced on
 * account exit), never `DeviceStorage` directly.
 *
 * The checkout interpreter runs each command on `customerDataRuntime` and
 * provides this Layer to that command only:
 *
 *   customerDataRuntime.fn((command, get) =>
 *     runCheckoutCommand(command).pipe(
 *       Effect.provide(get(bookingServicesLayer))
 *     )
 *   )
 *
 * so `CustomerApi`, `DotyposReadBudget` and the session check stay the single
 * instances the account's runtime built, never a second `customerDataLayer`.
 * `CustomerDataProvider` (or a test registry) seeds the live or fake Layer
 * with `Atom.initialValue(bookingServicesLayer, layer)`. Kept alive so it never
 * falls back to the default.
 */
export const bookingServicesLayer = Atom.keepAlive(
  Atom.make<Layer.Layer<BookingServices, never, CustomerDataServices>>(
    Layer.empty
  )
);
