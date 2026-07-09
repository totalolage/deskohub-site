import { z } from "zod/v4";
import {
  type WorkspaceCoworkProductTier,
  type WorkspaceProductMonitorOption,
  workspaceProductMonitorOptions,
} from "@/features/checkout/product-catalog";

export const storedBasicReservationDetailsSchema = z.strictObject({
  _tag: z.literal("cowork"),
  tier: z.literal("basic"),
  coffee: z.boolean(),
});

export const storedPlusReservationDetailsSchema = z.strictObject({
  _tag: z.literal("cowork"),
  tier: z.literal("plus"),
  coffee: z.literal(true),
});

export const storedProfiReservationDetailsSchema = z.strictObject({
  _tag: z.literal("cowork"),
  tier: z.literal("profi"),
  coffee: z.literal(true),
  monitorOption: z.enum(workspaceProductMonitorOptions),
});

export const storedCoworkReservationDetailsSchema = z.union([
  storedBasicReservationDetailsSchema,
  storedPlusReservationDetailsSchema,
  storedProfiReservationDetailsSchema,
]);

export const storedMeetingRoomReservationDetailsSchema = z.strictObject({
  _tag: z.literal("meeting-room"),
});

export const storedWorkspaceReservationDetailsSchema = z.union([
  storedCoworkReservationDetailsSchema,
  storedMeetingRoomReservationDetailsSchema,
]);

export type StoredCoworkReservationDetails = z.output<
  typeof storedCoworkReservationDetailsSchema
>;
export type StoredWorkspaceReservationDetails = z.output<
  typeof storedWorkspaceReservationDetailsSchema
>;

export type ReservationDetailsInput = {
  readonly entryTier: WorkspaceCoworkProductTier | "meeting-room";
  readonly coffee?: boolean;
  readonly monitorOption?: WorkspaceProductMonitorOption;
};

export const getStoredWorkspaceReservationDetails = (
  input: ReservationDetailsInput
): StoredWorkspaceReservationDetails => {
  switch (input.entryTier) {
    case "basic":
      return {
        _tag: "cowork",
        tier: "basic",
        coffee: Boolean(input.coffee),
      };
    case "plus":
      return {
        _tag: "cowork",
        tier: "plus",
        coffee: true,
      };
    case "profi":
      return storedProfiReservationDetailsSchema.parse({
        _tag: "cowork",
        tier: "profi",
        coffee: true,
        monitorOption: input.monitorOption,
      });
    case "meeting-room":
      return {
        _tag: "meeting-room",
      };
  }
};
