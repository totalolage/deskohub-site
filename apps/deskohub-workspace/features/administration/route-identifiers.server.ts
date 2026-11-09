import "server-only";

import {
  DotyposCustomerIdSchema,
  DotyposReservationIdSchema,
} from "@deskohub/dotypos";
import { NexiOperationIdSchema, NexiOrderIdSchema } from "@deskohub/nexi";
import { Effect, Option, Schema } from "effect";
import { notFound } from "next/navigation";
import { AdministrationRecordNotFound } from "@/features/administrators/server/administration-request.server";
import { workspaceReservationIdSchema } from "@/features/reservation/persistence-contracts";

const requireRouteIdentifier = <A>(
  decode: (input: string | undefined) => Option.Option<A>,
  input: string | undefined
): A => Option.getOrElse(decode(input), notFound);

/** Decodes a route identifier inside a page query, or answers with a 404. */
const decodeRouteIdentifier = <A>(
  decode: (input: string | undefined) => Option.Option<A>,
  input: string | undefined
) =>
  Option.match(decode(input), {
    onNone: () => Effect.fail(new AdministrationRecordNotFound()),
    onSome: Effect.succeed,
  });

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

export const decodeWorkspaceReservationRouteId = (input: string | undefined) =>
  decodeRouteIdentifier(decodeWorkspaceReservationId, input);

export const decodeDotyposReservationRouteId = (input: string | undefined) =>
  decodeRouteIdentifier(decodeDotyposReservationId, input);

export const decodeDotyposCustomerRouteId = (input: string | undefined) =>
  decodeRouteIdentifier(decodeDotyposCustomerId, input);

export const requireDotyposCustomerRouteId = (input: string | undefined) =>
  requireRouteIdentifier(decodeDotyposCustomerId, input);

export const decodeNexiOrderRouteId = (input: string | undefined) =>
  decodeRouteIdentifier(decodeNexiOrderId, input);

export const decodeNexiOperationRouteId = (input: string | undefined) =>
  decodeRouteIdentifier(decodeNexiOperationId, input);
