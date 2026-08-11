import "server-only";

import {
  DotyposCustomerIdSchema,
  DotyposReservationIdSchema,
} from "@deskohub/dotypos";
import { NexiOperationIdSchema, NexiOrderIdSchema } from "@deskohub/nexi";
import { Option, Schema } from "effect";
import { notFound } from "next/navigation";
import { workspaceReservationIdSchema } from "@/features/reservation/persistence-contracts";

const requireRouteIdentifier = <A>(
  decode: (input: unknown) => Option.Option<A>,
  input: unknown
): A => Option.getOrElse(decode(input), notFound);

const decodeWorkspaceReservationId = Schema.decodeUnknownOption(
  workspaceReservationIdSchema
);
const decodeDotyposReservationId = Schema.decodeUnknownOption(
  DotyposReservationIdSchema
);
const decodeDotyposCustomerId = Schema.decodeUnknownOption(
  DotyposCustomerIdSchema
);
const decodeNexiOrderId = Schema.decodeUnknownOption(NexiOrderIdSchema);
const decodeNexiOperationId = Schema.decodeUnknownOption(NexiOperationIdSchema);

export const requireWorkspaceReservationRouteId = (input: unknown) =>
  requireRouteIdentifier(decodeWorkspaceReservationId, input);

export const requireDotyposReservationRouteId = (input: unknown) =>
  requireRouteIdentifier(decodeDotyposReservationId, input);

export const requireDotyposCustomerRouteId = (input: unknown) =>
  requireRouteIdentifier(decodeDotyposCustomerId, input);

export const requireNexiOrderRouteId = (input: unknown) =>
  requireRouteIdentifier(decodeNexiOrderId, input);

export const requireNexiOperationRouteId = (input: unknown) =>
  requireRouteIdentifier(decodeNexiOperationId, input);

export const getDotyposCustomerRouteId = (input: unknown) =>
  Option.getOrUndefined(decodeDotyposCustomerId(input));
