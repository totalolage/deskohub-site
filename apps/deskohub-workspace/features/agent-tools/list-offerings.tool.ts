import { Effect, Match, Schema } from "effect";
import { loadPublicOfferings } from "@/features/checkout/backend/checkout/public-offerings";
import {
  getPublicOpeningHours,
  type PublicOffering,
} from "@/features/checkout/public-offerings";
import { type Locale, m } from "@/features/i18n";
import { getShareableReservationUrl } from "@/features/reservation/backend/shareable-reservation-url";
import { getCoworkOfferSearchParams } from "@/features/reservation/cowork-reservation-checkout-query";
import { getMeetingRoomReservationSelectionSearchParams } from "@/features/reservation/meeting-room-reservation-checkout-query";
import { getMeetingRoomReservationDurationKey } from "@/features/reservation/meeting-room-reservation-duration";
import { workspaceSiteConstants } from "@/shared/utils/site-constants";
import {
  agentToolLocaleField,
  defineAgentTool,
  getAgentToolLocale,
} from "./agent-tool";
import { AgentToolError } from "./agent-tool-error";
import { toAgentToolMoney } from "./agent-tool-money";
import {
  type AgentOffering,
  type ListOfferingsResult,
  listOfferingsResultSchema,
} from "./list-offerings.schema";

export const listOfferingsTool = defineAgentTool({
  name: "list_offerings",
  title: "List Deskohub Workspace offerings",
  description:
    "Lists every product Deskohub Workspace in Prague offers, with its regular price and today's price including any public sale, in CZK, plus add-ons, usage limits, opening hours, and the reservation page for each. Use get_quote for the exact price of another date or selection.",
  access: "public",
  readOnly: true,
  unavailableCode: "offerings_unavailable",
  input: Schema.Struct({ locale: agentToolLocaleField }),
  output: listOfferingsResultSchema,
  run: Effect.fn("agentTools.listOfferings")((input) =>
    Effect.Do.pipe(
      Effect.let("locale", () => getAgentToolLocale(input)),
      Effect.bind("listing", ({ locale }) => loadAgentOfferings(locale)),
      Effect.map(
        ({ locale, listing }): ListOfferingsResult => ({
          business: getBusiness(locale),
          ...listing,
        })
      )
    )
  ),
});

/**
 * Every offering with its prices for today, in `locale`: the listing
 * `list_offerings` and the booking view share.
 */
export const loadAgentOfferings = Effect.fn("agentTools.loadOfferings")(
  (locale: Locale) =>
    loadPublicOfferings(locale).pipe(
      Effect.flatMap((listing) =>
        Effect.forEach(listing.offerings, toAgentOffering, {
          concurrency: "inherit",
        }).pipe(
          Effect.map(
            (offerings): Omit<ListOfferingsResult, "business"> => ({
              advertised_on: listing.advertisedOn.toString(),
              offerings,
            })
          )
        )
      ),
      Effect.mapError(AgentToolError.unavailable("offerings_unavailable"))
    )
);

const getBusiness = (locale: Locale): ListOfferingsResult["business"] => {
  const { address } = workspaceSiteConstants.location;

  return {
    name: workspaceSiteConstants.brand.name,
    address: `${address.street}, ${address.postalCode} ${address.city}`,
    opening_hours: getPublicOpeningHours(locale),
    booking: m.agentToolBookingHandoff({}, { locale }),
  };
};

const toAgentOffering = (offering: PublicOffering) =>
  Match.value(offering).pipe(
    Match.discriminatorsExhaustive("kind")({
      cowork: (cowork) =>
        getShareableReservationUrl(
          "cowork",
          getCoworkOfferSearchParams({ entryTier: cowork.tier })
        ).pipe(
          Effect.map(
            (reservationUrl): AgentOffering => ({
              family: "cowork",
              tier: cowork.tier,
              ...getOfferingCopy(cowork),
              price: toAgentToolMoney(cowork.price),
              price_unit: "day",
              ...getAdvertisedPrice(cowork),
              add_ons: cowork.addOns.map((addOn) => ({
                id: addOn.id,
                name: addOn.name,
                price: toAgentToolMoney(addOn.price),
                price_unit: "day",
                included: addOn.included,
                ...(addOn.options && { options: addOn.options }),
              })),
              reservation_url: reservationUrl,
            })
          )
        ),
      "meeting-room": (meetingRoom) => {
        const duration = getMeetingRoomReservationDurationKey(
          meetingRoom.duration
        );

        return getShareableReservationUrl(
          "meeting-room",
          // No start yet: the page opens on the earliest one.
          getMeetingRoomReservationSelectionSearchParams({
            duration,
            startDateTime: "",
          })
        ).pipe(
          Effect.map(
            (reservationUrl): AgentOffering => ({
              family: "meeting-room",
              duration,
              duration_label: meetingRoom.durationLabel,
              ...getOfferingCopy(meetingRoom),
              price: toAgentToolMoney(meetingRoom.price),
              price_unit: "booking",
              ...getAdvertisedPrice(meetingRoom),
              add_ons: [],
              reservation_url: reservationUrl,
            })
          )
        );
      },
      office: (office) =>
        getShareableReservationUrl("office").pipe(
          Effect.map(
            (reservationUrl): AgentOffering => ({
              family: "office",
              ...getOfferingCopy(office),
              price: toAgentToolMoney(office.price),
              price_unit: "day",
              ...getAdvertisedPrice(office),
              seat_price: toAgentToolMoney(office.seatPrice),
              ...(office.maximumSeats !== undefined && {
                max_seats: office.maximumSeats,
              }),
              max_duration_hours: office.maximumDurationHours,
              add_ons: [],
              reservation_url: reservationUrl,
            })
          )
        ),
    })
  );

const getOfferingCopy = ({
  name,
  description,
  usage,
}: Pick<PublicOffering, "name" | "description" | "usage">) => ({
  name,
  description,
  usage,
});

const getAdvertisedPrice = ({
  advertisedPrice,
}: Pick<PublicOffering, "advertisedPrice">) => ({
  advertised_price: toAgentToolMoney(advertisedPrice.price),
  discount: toAgentToolMoney(advertisedPrice.discount),
});
