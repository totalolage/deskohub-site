# Development Environment Utility

## Overview
Simple, centralized utility for detecting development environment.

## Environment Detection

### Location
`/shared/utils/environment.ts`

### API

```typescript
import { isDev } from "@/shared/utils/environment";
```

### Function Reference

#### `isDev(): boolean`
Intelligently detects if the application is running in development mode:
- **Server-side**: Checks `NODE_ENV === "development"`
- **Client-side**: Checks if running on localhost (localhost, 127.0.0.1, or local network IPs)

This dual approach ensures dev tools work correctly both during SSR and client-side rendering.

## Webhook Test Panel

### Location
`/features/reservation/components/webhook-test-panel.tsx`

### Purpose
Development-only panel for testing webhook handlers with real reservation data.

### Features
- Only visible when `isDev()` returns true
- Collapsible panel with orange styling for visibility
- Test three webhook statuses:
  - Created (Status 0): Triggers customer pending email + business notification
  - Confirmed (Status 5): Triggers customer confirmation email
  - Declined (Status 10): Triggers customer declined email
- Shows success/failure status for each webhook call
- Displays full response data for debugging

### Usage
The panel is automatically added to reservation detail pages (`/[locale]/reservation/[id]`) when in development mode.

```tsx
<WebhookTestPanel
  reservationId={reservation.id}
  customerId={customer.id}
  currentStatus={reservation.status}
/>
```

### Testing Workflow
1. Create a reservation through the normal flow
2. Navigate to `/[locale]/reservation/[ID]`
3. Scroll to bottom to see the webhook test panel
4. Click to expand the panel
5. Click "Trigger" for any webhook status
6. Check server console for email output (Console provider in dev)
7. View response in the panel

## Usage Examples

### Basic Usage
```typescript
import { isDev } from "@/shared/utils/environment";

if (isDev()) {
  // This code only runs in development
  console.log("Debug info:", data);
}
```

### Conditional Rendering
```typescript
import { isDev } from "@/shared/utils/environment";

function MyComponent() {
  return (
    <>
      <MainContent />
      {isDev() && <DevOnlyDebugPanel />}
    </>
  );
}
```

### Migration from Direct Checks
```typescript
// Before
if (env.NODE_ENV === "development") { /* ... */ }
if (process.env.NODE_ENV === "development") { /* ... */ }

// After
if (isDev()) { /* ... */ }
```

## Files Updated to Use Environment Utils
- `/flags.ts` - Feature flag development mode detection
- `/shared/components/feature-flag-debugger.tsx` - Dev mode UI display
- `/app/[locale]/reservation/[id]/page.tsx` - Webhook test panel inclusion
- `/features/reservation/components/webhook-test-panel.tsx` - Dev tools visibility

## Security Considerations
- The webhook test panel is **ONLY** rendered when `isDev()` returns true
- Server-side: Based on NODE_ENV
- Client-side: Based on hostname (localhost detection)
- Webhook secret is required even in development
- All test webhooks fetch real data from Dotypos
- Emails are sent using the configured provider (Console in dev)

## Best Practices
1. Always use `isDev()` instead of direct `NODE_ENV` checks
2. The function works correctly on both server and client side
3. Remember that localhost IPs (192.168.x.x, 10.x.x.x) are also considered development
4. Dev tools will automatically hide in production deployments

## Why This Approach?
- **Simplicity**: One function to rule them all
- **Context-aware**: Automatically uses the right check based on where it's called
- **SSR-friendly**: Works during server-side rendering and hydration
- **No configuration**: Just import and use