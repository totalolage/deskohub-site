import { RegistryProvider, useAtom, useAtomValue } from "@effect/atom-react";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import * as Atom from "effect/unstable/reactivity/Atom";
import { StrictMode, useEffect, useState } from "react";
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
import {
  type BookingFieldError,
  type BookingStart,
  getInitialDraft,
  validateBookingDraft,
} from "./booking-draft";
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
  const [draft, setDraft] = useState(() => getInitialDraft(start));
  const [errors, setErrors] = useState<ReadonlyArray<BookingFieldError>>([]);
  const [check, setCheck] = useAtom(bookingCheckAtom);
  const [reservation, setReservation] = useAtom(bookingReserveAtom);
  const [link, openLink] = useAtom(bookingLinkAtom);
  return (
    <BookingForm
      check={check}
      draft={draft}
      errors={errors}
      linkFailed={AsyncResult.isFailure(link)}
      onCheck={() => {
        const validation = validateBookingDraft(draft, start);
        setErrors(validation.valid ? [] : validation.errors);
        setReservation(Atom.Reset);
        if (validation.valid) {
          setCheck({ selection: validation.selection, start });
        } else {
          setCheck(Atom.Reset);
        }
      }}
      onDraftChange={(next) => {
        // A changed selection makes earlier results stale.
        setDraft(next);
        setCheck(Atom.Reset);
        setReservation(Atom.Reset);
      }}
      onOpenLink={openLink}
      onReserve={(selection) =>
        setReservation({ selection, locale: start.locale })
      }
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
