import { RegistryProvider, useAtom, useAtomValue } from "@effect/atom-react";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import * as Atom from "effect/unstable/reactivity/Atom";
import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import "./booking-widget.css";
import { defaultLocale, m } from "@/features/i18n";
import {
  bookingCheckAtom,
  bookingLinkAtom,
  bookingLocaleAtom,
  bookingReserveAtom,
  bookingStartAtom,
} from "./booking-atoms";
import type { BookingStart } from "./booking-draft";
import { BookingForm } from "./booking-form";

/**
 * The booking view's root: waits for the `show_booking` result, then keeps
 * the results of the tool calls the view makes. Every message, startup
 * failures included, is in the view's language once the host has sent the
 * result.
 */
function BookingWidget() {
  const locale = AsyncResult.getOrElse(
    useAtomValue(bookingLocaleAtom),
    () => defaultLocale
  );
  const start = useAtomValue(bookingStartAtom);
  // Assistive technology reads the copy in the view's language.
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  return AsyncResult.match(start, {
    onInitial: () => (
      <p
        aria-live="polite"
        className="p-4 text-sm text-navy-blue"
        role="status"
      >
        {m.bookingWidgetLoading({}, { locale })}
      </p>
    ),
    onFailure: () => (
      <p className="p-4 text-sm text-burned-orange-ink" role="alert">
        {m.bookingWidgetStartFailed({}, { locale })}
      </p>
    ),
    onSuccess: ({ value }) => <BookingSession start={value} />,
  });
}

function BookingSession({ start }: { readonly start: BookingStart }) {
  const [check, setCheck] = useAtom(bookingCheckAtom);
  const [reservation, setReservation] = useAtom(bookingReserveAtom);
  const [link, openLink] = useAtom(bookingLinkAtom);
  // A changed or invalid selection makes earlier results stale.
  const clearResults = () => {
    setCheck(Atom.Reset);
    setReservation(Atom.Reset);
  };

  return (
    <BookingForm
      check={check}
      linkFailed={AsyncResult.isFailure(link)}
      onCheck={(selection) => {
        setReservation(Atom.Reset);
        setCheck({ selection, start });
      }}
      onOpenLink={openLink}
      onReserve={(selection, earlySetup) =>
        setReservation({ selection, earlySetup, locale: start.locale })
      }
      onSelectionChange={clearResults}
      reservation={reservation}
      start={start}
    />
  );
}

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <RegistryProvider>
        <BookingWidget />
      </RegistryProvider>
    </StrictMode>
  );
}
