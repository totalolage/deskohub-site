import type { CustomerBookingOfferings } from "@deskohub/workspace-customer-api";
import { useRouter } from "expo-router";
import { useAppLocale } from "../../i18n/locale-context";
import { m } from "../../i18n/messages";
import { ListGroup, ListRow, SectionHeader } from "../../ui/list";
import { ScrollScreen } from "../../ui/scroll-screen";
import { bookFamilyHref } from "../booking-routes";
import { formatMoney } from "../ui/money";
import { bookingFamilyChoices } from "./booking-family-chooser";
import { familyDescription, familyTitle } from "./booking-family-copy";
import { BookingGate } from "./booking-gate";
import { BookingOfferingsView } from "./booking-offerings-view";

/**
 * The booking entry: the families to book with today's advertised "from"
 * prices, for an account that can book.
 */
export function BookingFamilyChooserScreen() {
  return (
    <ScrollScreen>
      <BookingGate>
        <BookingOfferingsView>
          {(catalog) => <BookingFamilyChoices catalog={catalog} />}
        </BookingOfferingsView>
      </BookingGate>
    </ScrollScreen>
  );
}

function BookingFamilyChoices({
  catalog,
}: {
  readonly catalog: CustomerBookingOfferings;
}) {
  const locale = useAppLocale();
  const router = useRouter();
  return (
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
  );
}
