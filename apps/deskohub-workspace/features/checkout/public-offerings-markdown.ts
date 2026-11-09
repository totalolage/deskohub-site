import type { List, ListItem } from "mdast";
import { workspaceProductMonitorDescriptionMessages } from "@/features/checkout/product-catalog.i18n";
import { type Locale, m } from "@/features/i18n";
import {
  markdownBlockListItem,
  markdownList,
  markdownListItem,
  markdownParagraph,
  markdownStrong,
} from "@/shared/markdown/markdown";
import { formatMoney, type Money, moneyWithValue } from "@/shared/money/money";
import type { PublicOffering } from "./public-offerings";

type OfferingOf<Kind extends PublicOffering["kind"]> = Extract<
  PublicOffering,
  { readonly kind: Kind }
>;

const perDay = (money: Money, locale: Locale) =>
  `${formatMoney(money, locale)}${m.coworkReservationPricePeriodSuffix({}, { locale })}`;

/**
 * The public sale on the advertised booking, as the reservation page shows
 * it: the discounted price with the price it replaces.
 */
const saleItems = (
  { advertisedPrice: { price, discount } }: PublicOffering,
  formatPrice: (money: Money) => string,
  locale: Locale,
  scope?: string
): ListItem[] => {
  if (discount.value === 0) return [];
  const original = moneyWithValue(price.value + discount.value, price);
  const sale = `${m.checkoutSummaryDiscountedPrice({ price: formatPrice(price) }, { locale })} (${m.checkoutSummaryOriginalPrice({ price: formatPrice(original) }, { locale })})`;
  return [markdownListItem(scope ? `${scope}: ${sale}` : sale)];
};

const coworkAddOnItem = (
  addOn: OfferingOf<"cowork">["addOns"][number],
  locale: Locale
): ListItem => {
  if (addOn.included) {
    return markdownListItem(
      m.publicOfferingAddOnIncluded({ addOn: addOn.name }, { locale })
    );
  }
  const line = `${addOn.name}: ${perDay(addOn.price, locale)}`;
  return addOn.options
    ? markdownBlockListItem(
        markdownParagraph(line),
        markdownList(
          addOn.options.map(({ id, name }) =>
            markdownListItem(
              `${name}: ${workspaceProductMonitorDescriptionMessages[id]({}, { locale })}`
            )
          )
        )
      )
    : markdownListItem(line);
};

const offeringItem = (offering: PublicOffering, locale: Locale): ListItem => {
  switch (offering.kind) {
    case "cowork":
      return markdownBlockListItem(
        markdownParagraph(
          markdownStrong(offering.name),
          `: ${perDay(offering.price, locale)}`
        ),
        markdownList([
          ...saleItems(offering, (money) => perDay(money, locale), locale),
          markdownListItem(offering.usage),
          ...offering.addOns.map((addOn) => coworkAddOnItem(addOn, locale)),
        ])
      );
    case "meeting-room":
      return markdownBlockListItem(
        markdownParagraph(
          markdownStrong(offering.name),
          `, ${offering.durationLabel}: ${formatMoney(offering.price, locale)}`
        ),
        markdownList([
          ...saleItems(offering, (money) => formatMoney(money, locale), locale),
          markdownListItem(offering.usage),
        ])
      );
    case "office": {
      const oneDay = m.reservationOfficeBasePriceLabel(
        { dayCount: 1 },
        { locale }
      );
      return markdownBlockListItem(
        markdownParagraph(markdownStrong(offering.name)),
        markdownList([
          markdownListItem(`${oneDay}: ${formatMoney(offering.price, locale)}`),
          markdownListItem(
            `${m.publicOfferingOfficeSeatPrice({}, { locale })}: ${formatMoney(offering.seatPrice, locale)}`
          ),
          // The office advertises one day with one seat.
          ...saleItems(
            offering,
            (money) => formatMoney(money, locale),
            locale,
            `${oneDay}, ${m.reservationOfficeSeatCountOption({ count: 1 }, { locale })}`
          ),
          markdownListItem(offering.usage),
        ])
      );
    }
  }
};

/**
 * Each offering with its regular price and unit, any public sale on its
 * advertised booking, its add-ons, and when it can be used.
 */
export const publicOfferingsMarkdown = (
  offerings: ReadonlyArray<PublicOffering>,
  locale: Locale
): List =>
  markdownList(offerings.map((offering) => offeringItem(offering, locale)));
