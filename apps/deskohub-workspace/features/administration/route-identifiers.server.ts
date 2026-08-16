import "server-only";

import {
  DotyposCustomerIdSchema,
  DotyposReservationIdSchema,
} from "@deskohub/dotypos";
import { NexiOperationIdSchema, NexiOrderIdSchema } from "@deskohub/nexi";
import { Option, Schema } from "effect";
import { notFound } from "next/navigation";
import { orderIdSchema } from "@/features/order";
import { workspaceReservationIdSchema } from "@/features/reservation/persistence-contracts";

const requireRouteIdentifier = <A>(
  decode: (input: string | undefined) => Option.Option<A>,
  input: string | undefined
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
const decodeOrderId = Schema.decodeUnknownOption(orderIdSchema);

export const requireWorkspaceReservationRouteId = (input: string | undefined) =>
  requireRouteIdentifier(decodeWorkspaceReservationId, input);

export const requireDotyposReservationRouteId = (input: string | undefined) =>
  requireRouteIdentifier(decodeDotyposReservationId, input);

export const requireDotyposCustomerRouteId = (input: string | undefined) =>
  requireRouteIdentifier(decodeDotyposCustomerId, input);

export const requireNexiOrderRouteId = (input: string | undefined) =>
  requireRouteIdentifier(decodeNexiOrderId, input);

export const requireNexiOperationRouteId = (input: string | undefined) =>
  requireRouteIdentifier(decodeNexiOperationId, input);

export const requireOrderRouteId = (input: string | undefined) =>
  requireRouteIdentifier(decodeOrderId, input);

export const getDotyposCustomerRouteId = (input: string | undefined) =>
  Option.getOrUndefined(decodeDotyposCustomerId(input));
