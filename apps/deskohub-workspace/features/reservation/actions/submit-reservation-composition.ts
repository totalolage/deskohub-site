import { Effect, Layer } from "effect";
import { CustomerAccountContactService } from "@/features/account";
import { CheckoutService } from "@/features/checkout/backend/checkout";
import { ReferralService } from "@/features/referrals";
import type { SubmitReservationInput } from "@/features/reservation/actions/submit-reservation-input";
import { submitWorkspaceReservation } from "./submit-workspace-reservation";

const liveLayers = Layer.mergeAll(
  CheckoutService.Live,
  CustomerAccountContactService.Live,
  ReferralService.Live
);

export const submitReservationEffect = (
  input: SubmitReservationInput,
  layers = liveLayers
) => submitWorkspaceReservation(input).pipe(Effect.provide(layers));
