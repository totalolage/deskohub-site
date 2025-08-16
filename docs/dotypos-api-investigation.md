# Dotypos API Investigation & Implementation Plan for DeskOHub Reservation System

## Executive Summary

This document provides a comprehensive analysis of the Dotypos API documentation and a detailed implementation plan for integrating a reservation system into the DeskOHub project. The investigation covered all critical API components including reservations, tables, customers, authentication, webhooks, and multi-location support.

## Table of Contents

1. [API Overview](#api-overview)
2. [Authentication & Authorization](#authentication--authorization)
3. [Core Data Models](#core-data-models)
4. [Implementation Architecture](#implementation-architecture)
5. [Development Phases](#development-phases)
6. [Technical Requirements](#technical-requirements)
7. [Security Considerations](#security-considerations)
8. [Testing Strategy](#testing-strategy)

---

## API Overview

### Base Information
- **Base URL**: `https://api.dotykacka.cz/v2/`
- **API Version**: v2
- **Protocol**: REST with JSON payloads
- **Authentication**: OAuth2-like flow with refresh/access tokens
- **Rate Limiting**: HTTP 429 responses, 1 concurrent request per combination for POS actions

### Key Features
- Full CRUD operations for reservations
- Table management with floor plan support
- Customer profiles with GDPR compliance
- Multi-location (branch) support
- Real-time webhooks for reservation updates
- ETag support for caching and conflict resolution
- Batch operations (up to 100 items)

---

## Authentication & Authorization

### OAuth2 Flow Implementation

```typescript
// 1. Client Registration (one-time setup)
interface DotyposCredentials {
  clientId: string;
  clientSecret: string;
  testLicenseKey: string; // For development
}

// 2. Authorization Flow
class DotyposAuthService {
  // Step 1: Redirect for authorization
  getAuthorizationUrl(redirectUri: string, state: string): string {
    return `https://admin.dotykacka.cz/client/connect?` +
           `client_id=${this.clientId}&` +
           `client_secret=${this.clientSecret}&` +
           `scope=*&` +
           `redirect_uri=${redirectUri}&` +
           `state=${state}`;
  }

  // Step 2: Handle callback
  async handleCallback(token: string, cloudId: string): Promise<void> {
    await this.secureStorage.store('refreshToken', token);
    await this.secureStorage.store('cloudId', cloudId);
  }

  // Step 3: Get access token
  async getAccessToken(): Promise<string> {
    const response = await fetch('https://api.dotykacka.cz/v2/signin/token', {
      method: 'POST',
      headers: {
        'Authorization': `User ${this.refreshToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ _cloudId: this.cloudId })
    });
    
    const { accessToken } = await response.json();
    return accessToken; // Valid for 1 hour
  }
}
```

### Token Management
- **Refresh Token**: Long-lived, stored encrypted
- **Access Token**: 1-hour validity, refreshed automatically
- **Error Handling**: Comprehensive error codes for auth failures

---

## Core Data Models

### 1. Reservation Model

```typescript
interface Reservation {
  id?: number;
  _branchId: number;        // Required: Location
  _cloudId: number;         // Required: Business
  _customerId?: number;     // Optional: Guest profile
  _employeeId?: number;     // Optional: Staff assignment
  _tableId?: number;        // Optional: Table assignment
  startDate: number;        // Unix milliseconds
  endDate: number;          // Unix milliseconds
  seats: number;            // Min: 1, Max: table.seats
  status: 'NEW' | 'CONFIRMED' | 'CANCELLED';
  note?: string;
  flags?: number;           // Bit flags for custom logic
  created?: number;         // Read-only
  versionDate?: number;     // Read-only
}
```

### 2. Table Model

```typescript
interface Table {
  id: number;
  _branchId: number;
  _cloudId: number;
  _tableGroupId?: number;
  name: string;             // Max 180 chars
  seats?: number;           // Capacity
  type: TableType;          // SQUARE, CIRCLE2, etc.
  positionX?: number;       // Floor plan X
  positionY?: number;       // Floor plan Y
  rotation?: number;        // Degrees
  enabled: boolean;         // Operational status
  display: boolean;         // Visibility
  locationName?: string;    // Area identifier
  tags?: string[];
}

type TableType = 'SQUARE' | 'SQUARE6' | 'CIRCLE2' | 'CIRCLE4' | 
                 'ROUND' | 'CHAIR_SINGLE' | 'DELIVERY' | 'DOOR' | 
                 'GENERIC' | 'CAR1' | 'CAR2';
```

### 3. Customer Model

```typescript
interface Customer {
  id?: number;
  _cloudId: number;
  // Name requirement: firstName+lastName OR companyName
  firstName?: string;       // Max 180 chars
  lastName?: string;        // Max 180 chars
  companyName?: string;     // Max 180 chars
  email?: string;           // Max 100 chars
  phone?: string;           // Max 20 chars
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  zip?: string;
  country?: string;
  vatId?: string;           // EU VAT validation
  companyId?: string;       // Business registration
  points?: number;          // Loyalty points >= 0
  tags?: string[];          // Categorization
  deleted: boolean;         // Soft delete
  display: boolean;         // Visibility
  expireDate?: number;      // GDPR compliance
}
```

### 4. Branch Model

```typescript
interface Branch {
  id: number;
  _cloudId: number;
  name: string;             // Max 100 chars
  display: boolean;         // Visibility
  deleted: boolean;         // Soft delete
  features: number;         // Feature flags
  flags: number;            // Branch flags
  created: number;          // Read-only
  versionDate: number;      // Read-only
}
```

---

## Implementation Architecture

### Integration with Existing Effect.ts Architecture

Based on the existing DeskOHub codebase structure, here's the recommended implementation:

```typescript
// features/booking/backend/dotypos-reservation.service.ts
import { Effect, Context, Layer } from "effect";
import { 
  NetworkError, 
  ValidationError, 
  UnauthorizedError 
} from "@/features/shared/errors";

// Service definition using Effect patterns
export class DotyposReservationService extends Context.Tag("DotyposReservationService")<
  DotyposReservationService,
  {
    createReservation: (data: ReservationInput) => Effect.Effect<
      Reservation,
      NetworkError | ValidationError | UnauthorizedError
    >;
    getAvailableTables: (params: AvailabilityParams) => Effect.Effect<
      Table[],
      NetworkError | UnauthorizedError
    >;
    confirmReservation: (id: number) => Effect.Effect<
      Reservation,
      NetworkError | UnauthorizedError | NotFoundError
    >;
    cancelReservation: (id: number) => Effect.Effect<
      void,
      NetworkError | UnauthorizedError | NotFoundError
    >;
    setupWebhook: (url: string) => Effect.Effect<
      WebhookConfig,
      NetworkError | UnauthorizedError
    >;
  }
>() {}

// Layer implementation
export const DotyposReservationServiceLive = Layer.effect(
  DotyposReservationService,
  Effect.gen(function* () {
    const config = yield* DotyposConfig;
    const auth = yield* DotyposAuthService;
    
    return {
      createReservation: (data) =>
        Effect.gen(function* () {
          const token = yield* auth.getAccessToken();
          
          // Validate input
          if (!data.seats || data.seats < 1) {
            return yield* Effect.fail(new ValidationError("Invalid seat count"));
          }
          
          // Create customer if needed
          const customerId = yield* createOrFindCustomer(data.customer);
          
          // Find available table
          const tableId = yield* findSuitableTable(data);
          
          // Create reservation
          const reservation = yield* createReservationAPI({
            ...data,
            _customerId: customerId,
            _tableId: tableId,
            _branchId: config.branchId,
            _cloudId: config.cloudId
          });
          
          return reservation;
        }),
        
      // ... other methods
    };
  })
);
```

### API Integration Pattern

```typescript
// features/booking/backend/dotypos-api.client.ts
export class DotyposAPIClient {
  private readonly baseUrl = "https://api.dotykacka.cz/v2";
  
  constructor(
    private auth: DotyposAuthService,
    private config: DotyposConfig
  ) {}
  
  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    options?: RequestOptions
  ): Effect.Effect<T, NetworkError | UnauthorizedError> {
    return Effect.gen(function* () {
      const token = yield* Effect.tryPromise({
        try: () => this.auth.getAccessToken(),
        catch: () => new UnauthorizedError("Failed to get access token")
      });
      
      const response = yield* Effect.tryPromise({
        try: () => fetch(`${this.baseUrl}${path}`, {
          method,
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
            ...(options?.etag && { 'If-Match': options.etag })
          },
          body: body ? JSON.stringify(body) : undefined
        }),
        catch: () => new NetworkError("Request failed")
      });
      
      if (response.status === 401 || response.status === 403) {
        // Handle token refresh
        yield* this.auth.refreshAccessToken();
        return yield* this.request(method, path, body, options);
      }
      
      if (!response.ok) {
        return yield* Effect.fail(
          new NetworkError(`API error: ${response.status}`)
        );
      }
      
      return yield* Effect.tryPromise({
        try: () => response.json() as Promise<T>,
        catch: () => new NetworkError("Invalid response")
      });
    });
  }
}
```

### Webhook Handler

```typescript
// app/api/webhooks/dotypos/route.ts
import { NextRequest, NextResponse } from "next/server";
import { Effect } from "effect";
import { DotyposWebhookService } from "@/features/booking/backend/webhook.service";

export async function POST(request: NextRequest) {
  const payload = await request.json();
  
  const program = Effect.gen(function* () {
    const service = yield* DotyposWebhookService;
    
    // Process webhook payload
    yield* service.processReservationUpdate(payload);
    
    // Notify connected clients via WebSocket/SSE
    yield* service.broadcastUpdate(payload);
    
    return { success: true };
  });
  
  const result = await Effect.runPromise(
    program.pipe(
      Effect.provide(DotyposWebhookServiceLive),
      Effect.catchAll((error) => 
        Effect.succeed({ success: false, error: error.message })
      )
    )
  );
  
  return NextResponse.json(result, { 
    status: result.success ? 200 : 500 
  });
}
```

---

## Development Phases

### Phase 1: Foundation (Week 1)
- [ ] Set up Dotypos API credentials and testing environment
- [ ] Implement authentication service with token management
- [ ] Create base API client with Effect.ts integration
- [ ] Set up configuration management for API keys
- [ ] Implement secure token storage

### Phase 2: Core Reservation System (Week 2)
- [ ] Implement customer creation/search service
- [ ] Build table availability checking logic
- [ ] Create reservation CRUD operations
- [ ] Implement status workflow (NEW → CONFIRMED → CANCELLED)
- [ ] Add validation and error handling

### Phase 3: Advanced Features (Week 3)
- [ ] Implement webhook registration and handling
- [ ] Add real-time updates via WebSocket/SSE
- [ ] Build floor plan visualization with table positioning
- [ ] Implement multi-branch support
- [ ] Add reservation filtering and search

### Phase 4: UI Integration (Week 4)
- [ ] Create reservation form component
- [ ] Build table selection interface
- [ ] Implement availability calendar
- [ ] Add customer profile management
- [ ] Create admin reservation management panel

### Phase 5: Testing & Optimization (Week 5)
- [ ] Comprehensive unit testing
- [ ] Integration testing with Dotypos sandbox
- [ ] Performance optimization (caching, ETags)
- [ ] Error recovery and retry logic
- [ ] Documentation and deployment

---

## Technical Requirements

### Environment Variables
```env
# Dotypos API Configuration
DOTYPOS_CLIENT_ID=your_client_id
DOTYPOS_CLIENT_SECRET=your_client_secret
DOTYPOS_CLOUD_ID=your_cloud_id
DOTYPOS_BRANCH_ID=default_branch_id
DOTYPOS_API_URL=https://api.dotykacka.cz/v2
DOTYPOS_WEBHOOK_URL=https://your-domain.com/api/webhooks/dotypos
DOTYPOS_ENABLED=true
```

### Dependencies
```json
{
  "dependencies": {
    "effect": "^3.10.0",  // Already installed
    "@effect/platform": "^0.70.0",  // Already installed
    "@effect/schema": "^0.78.0",  // Already installed
    "crypto-js": "^4.2.0",  // For token encryption
    "date-fns": "^3.0.0",  // For date handling
    "zod": "^3.22.4"  // Already installed for validation
  }
}
```

---

## Security Considerations

### Token Security
1. **Refresh tokens**: Store encrypted in secure storage
2. **Access tokens**: Keep in memory only, never persist
3. **CSRF protection**: Use state parameter in OAuth flow
4. **HTTPS only**: All API communications over TLS

### Data Protection
1. **Customer data**: Follow GDPR guidelines
2. **Soft delete**: Use deleted flag for data retention
3. **Expiration dates**: Set for temporary/guest data
4. **Minimal data**: Only collect necessary information

### API Security
1. **Rate limiting**: Implement backoff strategies
2. **Webhook validation**: Verify webhook payloads
3. **Error handling**: Don't expose sensitive errors
4. **Audit logging**: Log all reservation operations

---

## Testing Strategy

### Unit Tests
```typescript
// features/booking/backend/__tests__/reservation.service.test.ts
describe('DotyposReservationService', () => {
  it('should create reservation with valid data', async () => {
    const result = await Effect.runPromise(
      service.createReservation({
        startDate: new Date('2024-03-15T19:00:00'),
        endDate: new Date('2024-03-15T21:00:00'),
        seats: 4,
        customer: {
          firstName: 'John',
          lastName: 'Doe',
          email: 'john@example.com'
        }
      }).pipe(
        Effect.provide(TestLayer)
      )
    );
    
    expect(result.status).toBe('NEW');
    expect(result.seats).toBe(4);
  });
});
```

### Integration Tests
- Test with Dotypos sandbox environment
- Verify webhook delivery
- Test error scenarios (auth failures, rate limits)
- Validate multi-branch scenarios

### E2E Tests
- Complete reservation flow
- Table availability checking
- Real-time updates via webhooks
- Customer management operations

---

## Monitoring & Observability

### Metrics to Track
- API response times
- Token refresh rates
- Webhook delivery success
- Reservation creation/cancellation rates
- Error rates by type

### Logging Strategy
```typescript
const createReservation = Effect.gen(function* () {
  yield* Effect.log("Creating reservation", { 
    seats: data.seats, 
    date: data.startDate 
  });
  
  const result = yield* apiCall();
  
  yield* Effect.log("Reservation created", { 
    id: result.id, 
    status: result.status 
  });
  
  return result;
});
```

---

## Migration from Existing System

### Current State
- Basic booking form with email notifications
- No real-time availability checking
- No table management
- Single location support

### Migration Path
1. **Parallel Operation**: Run new system alongside existing
2. **Data Migration**: Import existing bookings as reservations
3. **Feature Parity**: Ensure all current features work
4. **Gradual Rollout**: Enable for selected customers first
5. **Full Migration**: Switch all users to new system

---

## Conclusion

The Dotypos API provides a robust foundation for implementing a comprehensive reservation system in DeskOHub. The API's features align well with the project's Effect.ts architecture, and the implementation plan ensures a systematic approach to integration while maintaining code quality and security standards.

### Key Success Factors
- Proper authentication flow implementation
- Robust error handling with Effect.ts
- Real-time updates via webhooks
- Comprehensive testing strategy
- Security-first approach

### Next Steps
1. Obtain Dotypos API credentials
2. Set up development environment
3. Begin Phase 1 implementation
4. Create detailed technical specifications for each component
5. Establish monitoring and alerting

---

## Appendix: API Quick Reference

### Endpoints
```
# Authentication
POST /v2/signin/token

# Reservations
GET    /v2/clouds/:cloudId/reservations
POST   /v2/clouds/:cloudId/reservations
PUT    /v2/clouds/:cloudId/reservations/:id
PATCH  /v2/clouds/:cloudId/reservations/:id
DELETE /v2/clouds/:cloudId/reservations/:id

# Tables
GET    /v2/clouds/:cloudId/tables
GET    /v2/clouds/:cloudId/tables/:id

# Customers
GET    /v2/clouds/:cloudId/customers
POST   /v2/clouds/:cloudId/customers
PUT    /v2/clouds/:cloudId/customers/:id
PATCH  /v2/clouds/:cloudId/customers/:id
DELETE /v2/clouds/:cloudId/customers/:id

# Branches
GET    /v2/clouds/:cloudId/branches
GET    /v2/clouds/:cloudId/branches/:id

# Webhooks
GET    /v2/clouds/:cloudId/webhooks
POST   /v2/clouds/:cloudId/webhooks
DELETE /v2/clouds/:cloudId/webhooks/:id
```

### Error Codes
- 200: Success
- 201: Created
- 304: Not Modified
- 400: Bad Request
- 401: Unauthorized
- 403: Forbidden
- 404: Not Found
- 409: Conflict
- 429: Too Many Requests
- 500: Internal Server Error