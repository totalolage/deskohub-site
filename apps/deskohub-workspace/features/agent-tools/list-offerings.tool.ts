import { Effect, Match, Schema } from "effect";
import { loadPublicOfferings } from "@/features/checkout/backend/checkout/public-offerings";
import {
  workspaceCoworkCurrentTiers,
  workspaceProductMonitorOptions,
} from "@/features/checkout/product-catalog";
import {
  getPublicOpeningHours,
  type PublicOffering,
} from "@/features/checkout/public-offerings";
import { m } from "@/features/i18n";
import { getShareableReservationUrl } from "@/features/reservation/backend/shareable-reservation-url";
import { getCoworkReservationSearchParams } from "@/features/reservation/cowork-reservation-checkout-query";
import { getMeetingRoomReservationSearchParams } from "@/features/reservation/meeting-room-reservation-checkout-query";
import {
  getMeetingRoomReservationDurationKey,
  meetingRoomReservationDurationKeySchema,
} from "@/features/reservation/meeting-room-reservation-duration";
import { workspaceReservationKindSchema } from "@/features/reservation/reservation-kind";
import { workspaceSiteConstants } from "@/shared/utils/site-constants";
import {
  agentToolLocaleField,
  defineAgentTool,
  getAgentToolLocale,
} from "./agent-tool";
import { AgentToolError } from "./agent-tool-error";
import { agentToolMoneySchema, toAgentToolMoney } from "./agent-tool-money";

const offeringSchema = Schema.Struct({
  family: workspaceReservationKindSchema,
  tier: Schema.optionalKey(Schema.Literals(workspaceCoworkCurrentTiers)),
  duration: Schema.optionalKey(meetingRoomReservationDurationKeySchema),
  duration_label: Schema.optionalKey(Schema.String),
  name: Schema.String,
  description: Schema.String,
  usage: Schema.String,
  price: agentToolMoneySchema,
  price_unit: Schema.Literals(["day", "booking"]),
  seat_price: Schema.optionalKey(agentToolMoneySchema),
  max_seats: Schema.optionalKey(Schema.Int),
  max_duration_hours: Schema.optionalKey(Schema.Int),
  add_ons: Schema.Array(
    Schema.Struct({
      id: Schema.Literals(["coffee", "workstation"]),
      name: Schema.String,
      price: agentToolMoneySchema,
      price_unit: Schema.Literal("day"),
      included: Schema.Boolean,
      options: Schema.optionalKey(
        Schema.Array(
          Schema.Struct({
            id: Schema.Literals(workspaceProductMonitorOptions),
            name: Schema.String,
          })
        )
      ),
    })
  ),
  reservation_url: Schema.String,
});

type AgentOffering = typeof offeringSchema.Type;

const outputSchema = Schema.Struct({
  business: Schema.Struct({
    name: Schema.String,
    address: Schema.String,
    opening_hours: Schema.String,
    booking: Schema.String,
  }),
  offerings: Schema.Array(offeringSchema),
});

export type ListOfferingsResult = typeof outputSchema.Type;

export const listOfferingsTool = defineAgentTool({
  name: "list_offerings",
  title: "List DH Workspace offerings",
  description:
    "Lists every product DH Workspace in Prague offers, with regular prices in CZK, add-ons, usage limits, opening hours, and the reservation page for each. Use get_quote for the exact price of a selection, which can include a sale.",
  access: "public",
  readOnly: true,
  unavailableCode: "offerings_unavailable",
  input: Schema.Struct({ locale: agentToolLocaleField }),
  output: outputSchema,
  run: Effect.fn("agentTools.listOfferings")(
    function* (input) {
      const locale = getAgentToolLocale(input);
      const offerings = yield* loadPublicOfferings(locale);
      const { address } = workspaceSiteConstants.location;

      return {
        business: {
          name: workspaceSiteConstants.brand.name,
          address: `${address.street}, ${address.postalCode} ${address.city}`,
          opening_hours: getPublicOpeningHours(locale),
          booking: m.agentToolBookingHandoff({}, { locale }),
        },
        offerings: yield* Effect.all(offerings.map(toAgentOffering), {
          concurrency: "inherit",
        }),
      };
    },
    Effect.mapError(AgentToolError.unavailable("offerings_unavailable"))
  ),
});

const toAgentOffering = (offering: PublicOffering) =>
  Match.value(offering).pipe(
    Match.discriminatorsExhaustive("kind")({
      cowork: (cowork) =>
        getShareableReservationUrl(
          "cowork",
          getCoworkReservationSearchParams({ entryTier: cowork.tier })
        ).pipe(
          Effect.map(
            (reservationUrl): AgentOffering => ({
              family: "cowork",
              tier: cowork.tier,
              ...getOfferingCopy(cowork),
              price: toAgentToolMoney(cowork.price),
              price_unit: "day",
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
          getMeetingRoomReservationSearchParams({ duration })
        ).pipe(
          Effect.map(
            (reservationUrl): AgentOffering => ({
              family: "meeting-room",
              duration,
              duration_label: meetingRoom.durationLabel,
              ...getOfferingCopy(meetingRoom),
              price: toAgentToolMoney(meetingRoom.price),
              price_unit: "booking",
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
