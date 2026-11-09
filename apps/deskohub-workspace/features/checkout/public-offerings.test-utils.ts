import { workspaceMeetingRoomCatalog } from "@/features/checkout/meeting-room-product-catalog";
import {
  getCoworkTierCoffeeAddon,
  getCoworkTierWorkstationAddon,
  getWorkspaceMeetingRoomPriceForDuration,
  getWorkspaceOfficeAccessPrice,
  getWorkspaceOfficeSeatPrice,
  getWorkspaceProductByTier,
  getWorkspaceProductCoffeeLinePriceForTier,
  workspaceCoworkCurrentTiers,
  workspaceProductMonitorOptions,
  workspaceProductWorkstationAddonPrice,
} from "@/features/checkout/product-catalog";
import {
  getWorkspaceMeetingRoomDurationLabel,
  getWorkspaceMeetingRoomProductTitle,
  getWorkspaceOfficeProductTitle,
  getWorkspaceProductMonitorTitle,
  getWorkspaceProductTierTitle,
  workspaceProductMonitorDescriptionMessages,
} from "@/features/checkout/product-catalog.i18n";
import {
  getPublicCatalogOfferings,
  type PublicOffering,
  type PublicOfficeOffer,
} from "@/features/checkout/public-offerings";
import { type Locale, m } from "@/features/i18n";
import { formatMoney, type Money, moneyWithValue } from "@/shared/money/money";

/**
 * Every bookable product, advertising its smallest booking (one cowork day,
 * one meeting-room booking, or one office day with one seat) at the catalog
 * price less a public sale of `discountValue` minor units.
 */
export const advertisedCatalogOfferings = ({
  discountValue = 0,
  locale,
  office,
}: {
  readonly discountValue?: number;
  readonly locale: Locale;
  readonly office?: PublicOfficeOffer;
}): ReadonlyArray<PublicOffering> =>
  getPublicCatalogOfferings({ locale, ...(office && { office }) }).map(
    (offering) => {
      const regular =
        offering.kind === "office"
          ? moneyWithValue(
              offering.price.value + offering.seatPrice.value,
              offering.price
            )
          : offering.price;
      return {
        ...offering,
        advertisedPrice: {
          price: moneyWithValue(regular.value - discountValue, regular),
          discount: moneyWithValue(discountValue, regular),
        },
      };
    }
  );

const minus = (money: Money, value: number) =>
  moneyWithValue(money.value - value, money);

/**
 * The plain-text price lines a reader sees for each product family, built
 * from the product catalog: regular prices with their unit, add-ons, and the
 * sale on the advertised booking when `discountValue` is non-zero.
 */
export const catalogPriceLines = (
  locale: Locale,
  { discountValue = 0 }: { readonly discountValue?: number } = {}
) => {
  // Plain text shows the no-break spaces of formatted money as spaces.
  const money = (amount: Money) =>
    formatMoney(amount, locale).replace(/\s/g, " ");
  const perDay = (amount: Money) =>
    `${money(amount)}${m.coworkReservationPricePeriodSuffix({}, { locale })}`;
  const sale = (regular: Money, format: (amount: Money) => string) =>
    discountValue === 0
      ? []
      : [
          `${m.checkoutSummaryDiscountedPrice({ price: format(minus(regular, discountValue)) }, { locale })} (${m.checkoutSummaryOriginalPrice({ price: format(regular) }, { locale })})`,
        ];
  const officeDay = m.reservationOfficeBasePriceLabel(
    { dayCount: 1 },
    { locale }
  );
  const officeAccess = getWorkspaceOfficeAccessPrice(1);
  const officeSeat = getWorkspaceOfficeSeatPrice(1);

  return {
    cowork: workspaceCoworkCurrentTiers.flatMap((tier) => {
      const { price } = getWorkspaceProductByTier(tier);
      const coffee = getCoworkTierCoffeeAddon(tier);
      const coffeeLabel = m.reservationCoffeeLabel({}, { locale });
      return [
        `${getWorkspaceProductTierTitle(tier, locale)}: ${perDay(price)}`,
        ...sale(price, perDay),
        ...{
          included: [
            m.publicOfferingAddOnIncluded({ addOn: coffeeLabel }, { locale }),
          ],
          optional: [
            `${coffeeLabel}: ${perDay(getWorkspaceProductCoffeeLinePriceForTier(tier))}`,
          ],
          unavailable: [],
        }[coffee],
        ...(getCoworkTierWorkstationAddon(tier) === "unavailable"
          ? []
          : [
              `${m.reservationWorkstationLabel({}, { locale })}: ${perDay(workspaceProductWorkstationAddonPrice)}`,
              ...workspaceProductMonitorOptions.map(
                (option) =>
                  `${getWorkspaceProductMonitorTitle(option, locale)}: ${workspaceProductMonitorDescriptionMessages[option]({}, { locale })}`
              ),
            ]),
      ];
    }),
    meetingRoom: workspaceMeetingRoomCatalog.flatMap(({ duration }) => {
      const price = getWorkspaceMeetingRoomPriceForDuration(duration);
      return [
        `${getWorkspaceMeetingRoomProductTitle(locale)}, ${getWorkspaceMeetingRoomDurationLabel(duration, locale)}: ${money(price)}`,
        ...sale(price, money),
      ];
    }),
    office: [
      getWorkspaceOfficeProductTitle(locale),
      `${officeDay}: ${money(officeAccess)}`,
      `${m.publicOfferingOfficeSeatPrice({}, { locale })}: ${money(officeSeat)}`,
      ...sale(
        moneyWithValue(officeAccess.value + officeSeat.value, officeAccess),
        money
      ).map(
        (line) =>
          `${officeDay}, ${m.reservationOfficeSeatCountOption({ count: 1 }, { locale })}: ${line}`
      ),
    ],
  };
};
