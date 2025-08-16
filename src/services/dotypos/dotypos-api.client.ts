import { Effect, Schema } from "effect";
import { dotyposAuth } from "./dotypos-auth.service";
import {
  NetworkError,
  ValidationError,
  ExternalAPIError,
} from "@/shared/backend/errors";

// API Response Interfaces
export interface DotyposReservation {
  id?: number;
  _branchId: number;
  _cloudId: number;
  _customerId?: number;
  _employeeId?: number;
  _tableId?: number;
  startDate: number; // Unix milliseconds
  endDate: number; // Unix milliseconds
  seats: number;
  status: "NEW" | "CONFIRMED" | "CANCELLED";
  note?: string;
  flags?: number;
  created?: number;
  versionDate?: number;
  _etag?: string; // For conflict resolution
}

export interface DotyposTable {
  id: number;
  _branchId: number;
  _cloudId: number;
  _tableGroupId?: number;
  name: string;
  seats?: number;
  type: TableType;
  positionX?: number;
  positionY?: number;
  rotation?: number;
  enabled: boolean;
  display: boolean;
  locationName?: string;
  tags?: string[];
  _etag?: string;
}

export interface DotyposCustomer {
  id?: number;
  _cloudId: number;
  firstName?: string;
  lastName?: string;
  companyName?: string;
  email?: string;
  phone?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  zip?: string;
  country?: string;
  vatId?: string;
  companyId?: string;
  points?: number;
  tags?: string[];
  deleted: boolean;
  display: boolean;
  expireDate?: number;
  _etag?: string;
}

export interface DotyposBranch {
  id: number;
  _cloudId: number;
  name: string;
  display: boolean;
  deleted: boolean;
  features: number;
  flags: number;
  created: number;
  versionDate: number;
}

export type TableType =
  | "SQUARE"
  | "SQUARE6"
  | "CIRCLE2"
  | "CIRCLE4"
  | "ROUND"
  | "CHAIR_SINGLE"
  | "DELIVERY"
  | "DOOR"
  | "GENERIC"
  | "CAR1"
  | "CAR2";

// Request Interfaces
export interface CreateReservationRequest {
  _branchId: number;
  _customerId?: number;
  _tableId?: number;
  startDate: number;
  endDate: number;
  seats: number;
  status?: "NEW" | "CONFIRMED";
  note?: string;
}

export interface UpdateReservationRequest {
  _branchId?: number;
  _customerId?: number;
  _tableId?: number;
  startDate?: number;
  endDate?: number;
  seats?: number;
  status?: "NEW" | "CONFIRMED" | "CANCELLED";
  note?: string;
}

export interface CreateCustomerRequest {
  firstName?: string;
  lastName?: string;
  companyName?: string;
  email?: string;
  phone?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  zip?: string;
  country?: string;
  vatId?: string;
  companyId?: string;
  tags?: string[];
}

// API Client Options
export interface DotyposAPIOptions {
  etag?: string;
  limit?: number;
  offset?: number;
  sort?: string;
  filter?: Record<string, any>;
}

// Pagination Response
export interface PaginatedResponse<T> {
  data: T[];
  count: number;
  limit: number;
  offset: number;
}

/**
 * Dotypos API Client
 * Handles all communication with the Dotypos API v2
 */
export class DotyposAPIClient {
  private static instance: DotyposAPIClient;
  private readonly baseUrl = "https://api.dotykacka.cz/v2";

  private constructor() {}

  /**
   * Get singleton instance of the API client
   */
  public static getInstance(): DotyposAPIClient {
    if (!DotyposAPIClient.instance) {
      DotyposAPIClient.instance = new DotyposAPIClient();
    }
    return DotyposAPIClient.instance;
  }

  /**
   * Make an authenticated request to the Dotypos API
   */
  private makeRequest<T>(
    method: string,
    path: string,
    body?: any,
    options?: DotyposAPIOptions
  ): Effect.Effect<T, NetworkError | ExternalAPIError | ValidationError> {
    const self = this;
    return Effect.gen(function* () {
      // Check if auth is configured
      if (!dotyposAuth.isConfigured()) {
        return yield* Effect.fail(
          new ExternalAPIError("Dotypos", "Authentication not configured", 503)
        );
      }

      // Get access token
      const accessToken = yield* Effect.tryPromise({
        try: () => dotyposAuth.getAccessToken(),
        catch: (error) =>
          new ExternalAPIError(
            "Dotypos",
            `Failed to get access token: ${error}`,
            401
          ),
      });

      // Build URL with cloud ID
      const cloudId = dotyposAuth.getCloudId();
      const url = `${self.baseUrl}/clouds/${cloudId}${path}`;

      // Build headers
      const headers: HeadersInit = {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      };

      // Add ETag if provided
      if (options?.etag) {
        headers["If-Match"] = options.etag;
      }

      // Make the request
      const response = yield* Effect.tryPromise({
        try: () =>
          fetch(url, {
            method,
            headers,
            body: body ? JSON.stringify(body) : undefined,
          }),
        catch: (error) =>
          new NetworkError(`Failed to connect to Dotypos API: ${error}`, url),
      });

      // Handle response
      if (!response.ok) {
        if (response.status === 401) {
          // Try to refresh token and retry
          yield* Effect.tryPromise({
            try: () => dotyposAuth.refreshAccessToken(),
            catch: (error) =>
              new ExternalAPIError(
                "Dotypos",
                `Failed to refresh token: ${error}`,
                401
              ),
          });

          // Retry the request with new token
          return yield* self.makeRequest<T>(method, path, body, options);
        }

        if (response.status === 409) {
          // Conflict - ETag mismatch
          return yield* Effect.fail(
            new ExternalAPIError(
              "Dotypos",
              "Resource was modified by another client",
              409
            )
          );
        }

        if (response.status === 429) {
          // Rate limit exceeded
          return yield* Effect.fail(
            new ExternalAPIError("Dotypos", "Rate limit exceeded", 429)
          );
        }

        const errorBody = yield* Effect.tryPromise({
          try: () => response.text(),
          catch: () => new Error("Unknown error"),
        }).pipe(Effect.catchAll(() => Effect.succeed("Unknown error")));

        return yield* Effect.fail(
          new ExternalAPIError(
            "Dotypos",
            `API request failed: ${errorBody}`,
            response.status
          )
        );
      }

      // Parse response
      if (response.status === 204) {
        // No content
        return undefined as T;
      }

      const data = yield* Effect.tryPromise({
        try: () => response.json(),
        catch: () =>
          new ValidationError("Failed to parse API response as JSON"),
      });

      // Extract ETag if present
      const etag = response.headers.get("ETag");
      if (etag && typeof data === "object" && data !== null) {
        (data as any)._etag = etag;
      }

      return data as T;
    });
  }

  // ============= Reservation Methods =============

  /**
   * Create a new reservation
   */
  createReservation(
    reservation: CreateReservationRequest
  ): Effect.Effect<
    DotyposReservation,
    NetworkError | ExternalAPIError | ValidationError
  > {
    return this.makeRequest<DotyposReservation>(
      "POST",
      "/reservations",
      reservation
    );
  }

  /**
   * Get a reservation by ID
   */
  getReservation(
    id: number
  ): Effect.Effect<
    DotyposReservation,
    NetworkError | ExternalAPIError | ValidationError
  > {
    return this.makeRequest<DotyposReservation>(
      "GET",
      `/reservations/${id}`
    );
  }

  /**
   * Update a reservation
   */
  updateReservation(
    id: number,
    updates: UpdateReservationRequest,
    etag?: string
  ): Effect.Effect<
    DotyposReservation,
    NetworkError | ExternalAPIError | ValidationError
  > {
    return this.makeRequest<DotyposReservation>(
      "PATCH",
      `/reservations/${id}`,
      updates,
      { etag }
    );
  }

  /**
   * Cancel a reservation
   */
  cancelReservation(
    id: number,
    etag?: string
  ): Effect.Effect<void, NetworkError | ExternalAPIError | ValidationError> {
    return this.updateReservation(id, { status: "CANCELLED" }, etag).pipe(
      Effect.map(() => undefined)
    );
  }

  /**
   * Delete a reservation
   */
  deleteReservation(
    id: number,
    etag?: string
  ): Effect.Effect<void, NetworkError | ExternalAPIError | ValidationError> {
    return this.makeRequest<void>("DELETE", `/reservations/${id}`, null, {
      etag,
    });
  }

  /**
   * List reservations with optional filters
   */
  listReservations(
    options?: DotyposAPIOptions
  ): Effect.Effect<
    PaginatedResponse<DotyposReservation>,
    NetworkError | ExternalAPIError | ValidationError
  > {
    const params = new URLSearchParams();
    if (options?.limit) params.append("limit", options.limit.toString());
    if (options?.offset) params.append("offset", options.offset.toString());
    if (options?.sort) params.append("sort", options.sort);
    if (options?.filter) {
      Object.entries(options.filter).forEach(([key, value]) => {
        params.append(key, String(value));
      });
    }

    const queryString = params.toString() ? `?${params.toString()}` : "";
    return this.makeRequest<PaginatedResponse<DotyposReservation>>(
      "GET",
      `/reservations${queryString}`
    );
  }

  // ============= Table Methods =============

  /**
   * Get all tables
   */
  getTables(
    branchId?: number
  ): Effect.Effect<
    DotyposTable[],
    NetworkError | ExternalAPIError | ValidationError
  > {
    const path = branchId ? `/tables?_branchId=${branchId}` : "/tables";
    return this.makeRequest<DotyposTable[]>("GET", path);
  }

  /**
   * Get a table by ID
   */
  getTable(
    id: number
  ): Effect.Effect<
    DotyposTable,
    NetworkError | ExternalAPIError | ValidationError
  > {
    return this.makeRequest<DotyposTable>("GET", `/tables/${id}`);
  }

  // ============= Customer Methods =============

  /**
   * Create a new customer
   */
  createCustomer(
    customer: CreateCustomerRequest
  ): Effect.Effect<
    DotyposCustomer,
    NetworkError | ExternalAPIError | ValidationError
  > {
    const cloudId = dotyposAuth.getCloudId();
    const customerData = {
      ...customer,
      _cloudId: parseInt(cloudId),
      deleted: false,
      display: true,
    };
    return this.makeRequest<DotyposCustomer>("POST", "/customers", customerData);
  }

  /**
   * Get a customer by ID
   */
  getCustomer(
    id: number
  ): Effect.Effect<
    DotyposCustomer,
    NetworkError | ExternalAPIError | ValidationError
  > {
    return this.makeRequest<DotyposCustomer>("GET", `/customers/${id}`);
  }

  /**
   * Update a customer
   */
  updateCustomer(
    id: number,
    updates: Partial<CreateCustomerRequest>,
    etag?: string
  ): Effect.Effect<
    DotyposCustomer,
    NetworkError | ExternalAPIError | ValidationError
  > {
    return this.makeRequest<DotyposCustomer>(
      "PATCH",
      `/customers/${id}`,
      updates,
      { etag }
    );
  }

  /**
   * Search customers by email or phone
   */
  searchCustomers(
    query: { email?: string; phone?: string }
  ): Effect.Effect<
    DotyposCustomer[],
    NetworkError | ExternalAPIError | ValidationError
  > {
    const params = new URLSearchParams();
    if (query.email) params.append("email", query.email);
    if (query.phone) params.append("phone", query.phone);
    const queryString = params.toString() ? `?${params.toString()}` : "";
    return this.makeRequest<DotyposCustomer[]>("GET", `/customers${queryString}`);
  }

  /**
   * Soft delete a customer (GDPR compliance)
   */
  deleteCustomer(
    id: number,
    etag?: string
  ): Effect.Effect<void, NetworkError | ExternalAPIError | ValidationError> {
    return this.updateCustomer(id, { deleted: true } as any, etag).pipe(
      Effect.map(() => undefined)
    );
  }

  // ============= Branch Methods =============

  /**
   * Get all branches
   */
  getBranches(): Effect.Effect<
    DotyposBranch[],
    NetworkError | ExternalAPIError | ValidationError
  > {
    return this.makeRequest<DotyposBranch[]>("GET", "/branches");
  }

  /**
   * Get a branch by ID
   */
  getBranch(
    id: number
  ): Effect.Effect<
    DotyposBranch,
    NetworkError | ExternalAPIError | ValidationError
  > {
    return this.makeRequest<DotyposBranch>("GET", `/branches/${id}`);
  }

  // ============= Helper Methods =============

  /**
   * Convert Date to Dotypos timestamp (Unix milliseconds)
   */
  static dateToTimestamp(date: Date): number {
    return date.getTime();
  }

  /**
   * Convert Dotypos timestamp to Date
   */
  static timestampToDate(timestamp: number): Date {
    return new Date(timestamp);
  }

  /**
   * Check if a table is available for a given time range
   */
  checkTableAvailability(
    tableId: number,
    startDate: Date,
    endDate: Date
  ): Effect.Effect<boolean, NetworkError | ExternalAPIError | ValidationError> {
    const self = this;
    return Effect.gen(function* () {
      const reservations = yield* self.listReservations({
        filter: {
          _tableId: tableId,
          startDate_gte: DotyposAPIClient.dateToTimestamp(startDate),
          endDate_lte: DotyposAPIClient.dateToTimestamp(endDate),
          status_ne: "CANCELLED",
        },
      });

      return reservations.data.length === 0;
    });
  }
}

// Export singleton instance
export const dotyposAPI = DotyposAPIClient.getInstance();