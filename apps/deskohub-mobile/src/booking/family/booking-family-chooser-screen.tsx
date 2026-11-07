import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import { useRouter } from "expo-router";
import { useAppLocale } from "../../i18n/locale-context";
import { m } from "../../i18n/messages";
import { ListGroup, ListRow, SectionHeader } from "../../ui/list";
import { ScrollScreen } from "../../ui/scroll-screen";
import { bookFamilyHref } from "../booking-routes";
import { bookingOfferingsAtom } from "../data/booking-queries";
import { formatMoney } from "../ui/money";
import { bookingFamilyChoices } from "./booking-family-chooser";
import { familyDescription, familyTitle } from "./booking-family-copy";
import { bookingReadOf } from "./booking-family-view";
import { BookingGate } from "./booking-gate";
import { BookingReadView } from "./booking-read-view";

/**
 * The booking entry: the families to book with today's advertised "from"
 * prices, for an account that can book.
 */
export function BookingFamilyChooserScreen() {
  const locale = useAppLocale();
  const router = useRouter();
  const offerings = useAtomValue(bookingOfferingsAtom(locale));
  const refresh = useAtomRefresh(bookingOfferingsAtom(locale));
  return (
    <ScrollScreen refreshing={offerings.waiting} onRefresh={refresh}>
      <BookingGate>
        <BookingReadView read={bookingReadOf(offerings)} onRetry={refresh}>
          {(catalog) => (
            <>
              <SectionHeader title={m.booking_family_heading({}, { locale })} />
              <ListGroup>
                {bookingFamilyChoices(catalog.offerings).map(
                  ({ family, fromPrice }) => (
                    <ListRow
                      key={family}
                      label={familyTitle(family, locale)}
                      description={familyDescription(family, locale)}
                      value={m.booking_family_from_price(
                        { price: formatMoney(fromPrice, locale) },
                        { locale }
                      )}
                      onPress={() => router.push(bookFamilyHref(family))}
                    />
                  )
                )}
              </ListGroup>
              <ListGroup>
                <ListRow
                  label={m.booking_opening_hours(
                    { hours: catalog.openingHours },
                    { locale }
                  )}
                />
              </ListGroup>
            </>
          )}
        </BookingReadView>
      </BookingGate>
    </ScrollScreen>
  );
}
