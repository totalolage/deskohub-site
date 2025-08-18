/**
 * Mock Dotypos Service for testing without creating real reservations
 */

import { Effect, Layer } from "effect";
import { ExternalAPIError } from "@/shared/backend/errors";
import type {
  CreateReservationRequest,
  Customer,
  Reservation,
  Table,
} from "../generated/types.gen";

// Import the actual DotyposClient tag
import { DotyposClient } from "./service";

// Mock data
const mockTables: Table[] = [
  {
    id: "1",
    _cloudId: "123",
    name: "1",
    seats: 4,
    display: true,
    enabled: true,
  },
  {
    id: "2",
    _cloudId: "123",
    name: "2",
    seats: 4,
    display: true,
    enabled: true,
  },
  {
    id: "3",
    _cloudId: "123",
    name: "3",
    seats: 6,
    display: true,
    enabled: true,
  },
  {
    id: "4",
    _cloudId: "123",
    name: "4",
    seats: 6,
    display: true,
    enabled: true,
  },
  {
    id: "5",
    _cloudId: "123",
    name: "5",
    seats: 8,
    display: true,
    enabled: true,
  },
  {
    id: "6",
    _cloudId: "123",
    name: "6",
    seats: 2,
    display: true,
    enabled: true,
  },
  {
    id: "7",
    _cloudId: "123",
    name: "7",
    seats: 2,
    display: true,
    enabled: true,
  },
  {
    id: "8",
    _cloudId: "123",
    name: "DnD",
    seats: 10,
    display: true,
    enabled: true,
  },
  {
    id: "9",
    _cloudId: "123",
    name: "Private Room",
    seats: 12,
    display: true,
    enabled: true,
  },
];

const mockCustomers: Customer[] = [];
const mockReservations: Reservation[] = [];

let nextReservationId = 1000;
let nextCustomerId = 2000;

/**
 * Mock implementation of DotyposClient
 */
export const DotyposServiceMockLive = Layer.succeed(
  DotyposClient,
  DotyposClient.of({
    cloudId: "mock-cloud-123",
    branchId: "mock-branch-1",
    employeeId: "mock-employee-1",

    createReservation: (request: CreateReservationRequest) =>
      Effect.gen(function* () {
        yield* Effect.logInfo("MOCK: Creating reservation", request);

        const newReservation: Reservation = {
          id: String(nextReservationId++),
          _branchId: request._branchId,
          _cloudId: request._cloudId,
          _customerId: request._customerId,
          _tableId: request._tableId,
          seats: request.seats,
          startDate: request.startDate,
          endDate: request.endDate,
          status: request.status,
          note: request.note,
          created: Date.now(),
        };

        mockReservations.push(newReservation);

        yield* Effect.logInfo("MOCK: Created reservation", {
          id: newReservation.id,
          tableId: newReservation._tableId,
          seats: newReservation.seats,
          note: newReservation.note,
        });

        return newReservation;
      }),

    getReservation: (id: string) =>
      Effect.gen(function* () {
        yield* Effect.logInfo("MOCK: Getting reservation", { id });
        const reservation = mockReservations.find((r) => r.id === id);

        if (!reservation) {
          return yield* Effect.fail(
            new ExternalAPIError({
              service: "DotyposMock",
              message: `Reservation ${id} not found`,
              statusCode: 404,
            })
          );
        }

        return reservation;
      }),

    findOrCreateCustomer: (customerData: {
      firstName: string;
      lastName: string;
      email?: string;
      phone?: string;
    }) =>
      Effect.gen(function* () {
        yield* Effect.logInfo(
          "MOCK: Finding or creating customer",
          customerData
        );

        // Try to find existing customer
        const existingCustomer = mockCustomers.find(
          (c) =>
            (customerData.email && c.email === customerData.email) ||
            (customerData.phone && c.phone === customerData.phone)
        );

        if (existingCustomer) {
          yield* Effect.logInfo(
            "MOCK: Found existing customer",
            existingCustomer
          );
          return existingCustomer;
        }

        // Create new customer
        const newCustomer: Customer = {
          id: String(nextCustomerId++),
          _cloudId: "123",
          firstName: customerData.firstName,
          lastName: customerData.lastName,
          email: customerData.email,
          phone: customerData.phone,
          flags: 0,
          points: 0,
          display: true,
          deleted: false,
        };

        mockCustomers.push(newCustomer);
        yield* Effect.logInfo("MOCK: Created new customer", newCustomer);

        return newCustomer;
      }),

    getTables: () =>
      Effect.gen(function* () {
        yield* Effect.logInfo("MOCK: Getting tables");
        return mockTables;
      }),
  })
);
