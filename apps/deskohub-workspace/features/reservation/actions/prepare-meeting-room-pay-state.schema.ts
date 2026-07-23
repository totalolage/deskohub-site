import { Schema } from "effect";
import { normalizedMeetingRoomReservationOrderSchema } from "@/features/reservation/meeting-room-reservation";
import { preparePayStateCommonSchema } from "./prepare-pay-state-common.schema";

export const prepareMeetingRoomPayStateInputSchema = Schema.Struct({
  ...preparePayStateCommonSchema.fields,
  reservation: normalizedMeetingRoomReservationOrderSchema,
});

export type PrepareMeetingRoomPayStateInput =
  typeof prepareMeetingRoomPayStateInputSchema.Type;
