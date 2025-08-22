# Feature Flags with Statsig

## Overview

The DeskOHub website uses Statsig for feature flag management. This allows us to control feature visibility in production without redeployment and includes built-in analytics and A/B testing capabilities.

## Current Feature Flags

### 1. Board Games List (`board_games_list`)
- **When Enabled**: Shows the full interactive board games list with filtering, sorting, and search functionality
- **When Disabled**: Shows a simple link to the Google Sheets document with the games list
- **Location**: `/board-games` page

### 2. Boardroom Reservations (`boardroom_reservations`)
- **When Enabled**: Shows the reservation button in the training room page that links to the reservation form
- **When Disabled**: Shows a contact button that links to the contact page instead
- **Location**: `/training-room` page CTA section

### 3. Contact Form (`contact_form`)
- **When Enabled**: Shows the full contact form on the contact page
- **When Disabled**: Only shows static contact information (phone, email, address)
- **Location**: `/contact` page

### 4. Gallery (`gallery`)
- **When Enabled**: Shows the fancy gallery with hero carousel, categorized spaces, and event showcases
- **When Disabled**: Shows a minimal grid-based gallery with all images
- **Location**: `/gallery` page

## Configuration

### Environment Variables

The following environment variables are configured in Vercel:

```bash
# Statsig Configuration
NEXT_PUBLIC_STATSIG_CLIENT_KEY=client-6WHjWhpK2RuvGqyyOpExsgX448SFakAKJGraqkAeSHB
STATSIG_SERVER_API_KEY=secret-bKsdIHQOy0VtxuVNcjzFDBOU0URdIYkAy5sVHKmzYnZ
EXPERIMENTATION_CONFIG=<edge-config-url>
EXPERIMENTATION_CONFIG_ITEM_KEY=statsig-k1kCBz05vvOKf3yNkwqP9
```

### Statsig Console

Access the Statsig console at: https://console.statsig.com/k1kCBz05vvOKf3yNkwqP9

To manage feature flags:
1. Log in to the Statsig console
2. Navigate to "Feature Gates"
3. Create or modify gates with the exact names:
   - `board_games_list`
   - `boardroom_reservations`
   - `contact_form`
   - `gallery`

## Implementation

### Flag Definition (`/flags.ts`)

```typescript
import { flag } from "flags/next";
import { adapter as statsigAdapter } from "@flags-sdk/statsig";

// Create a feature flag
export const createFeatureFlag = (key: string) =>
  flag<boolean, StatsigUser>({
    key,
    adapter: statsigAdapter.featureGate((gate) => gate.value, {
      exposureLogging: true,
    }),
    identify,
  });

// Define feature flags
export const boardGamesListFlag = createFeatureFlag("board_games_list");
export const boardroomReservationsFlag = createFeatureFlag("boardroom_reservations");
export const contactFormFlag = createFeatureFlag("contact_form");
export const galleryFlag = createFeatureFlag("gallery");
```

### Usage in Server Components

```typescript
import { boardGamesListFlag } from "@/flags";

export default async function BoardGamesPage() {
  const enabled = await boardGamesListFlag();
  
  return (
    <>
      {enabled ? (
        <FullBoardGamesList />
      ) : (
        <LinkToGoogleSheets />
      )}
    </>
  );
}
```

## Adding New Feature Flags

1. **Create the flag in Statsig Console**:
   - Go to https://console.statsig.com/k1kCBz05vvOKf3yNkwqP9
   - Click "Create" → "Feature Gate"
   - Name it with snake_case (e.g., `my_new_feature`)
   - Configure targeting rules as needed

2. **Add to `/flags.ts`**:
   ```typescript
   export const myNewFeatureFlag = createFeatureFlag("my_new_feature");
   ```

3. **Use in your component**:
   ```typescript
   import { myNewFeatureFlag } from "@/flags";
   
   const enabled = await myNewFeatureFlag();
   ```

## Testing

### Local Development

In local development, Statsig will use the configuration from your Statsig project. You can:
1. Override flags in the Statsig console
2. Set up targeting rules based on user properties
3. Use percentage rollouts for gradual feature releases

### Testing Different States

1. **Enable a feature globally**:
   - In Statsig console, edit the feature gate
   - Set "Default Value" to "Pass"
   - Save changes

2. **Target specific users**:
   - Add targeting rules based on userID
   - Currently using "anonymous" as default userID
   - Can be enhanced to use actual user identifiers

3. **Percentage rollout**:
   - Use Statsig's percentage rollout feature
   - Gradually increase exposure from 0% to 100%

## Monitoring

Statsig provides built-in analytics:
- **Exposure logging**: Automatically tracks when users see each feature
- **Metrics**: Monitor impact on key metrics
- **Diagnostics**: Debug flag evaluations in real-time

Access analytics at: https://console.statsig.com/k1kCBz05vvOKf3yNkwqP9/diagnostics

## Best Practices

1. **Naming Convention**: Use snake_case for flag names in Statsig
2. **Default to Disabled**: New features should default to "Fail" (disabled)
3. **Gradual Rollout**: Use percentage rollouts for major features
4. **Monitor Metrics**: Watch key metrics when enabling features
5. **Clean Up**: Remove flag code once features are permanently enabled

## Advantages over Edge Config

- **No code deployment needed**: Change flags instantly in Statsig console
- **Built-in analytics**: Automatic exposure tracking and metrics
- **A/B testing**: Built-in experimentation capabilities
- **Targeting rules**: Complex user targeting without code changes
- **Rollback capability**: Instant rollback if issues arise
- **Audit log**: Track all changes to feature flags

## Troubleshooting

### Flags not updating

1. Check Statsig console for the correct flag name
2. Verify environment variables are set correctly
3. Check browser console for Statsig initialization errors
4. Clear Next.js cache: `rm -rf .next`

### Connection issues

1. Verify `NEXT_PUBLIC_STATSIG_CLIENT_KEY` is set
2. Check `STATSIG_SERVER_API_KEY` for server-side evaluation
3. Ensure Edge Config URL is valid in `EXPERIMENTATION_CONFIG`

### Debugging

Enable Statsig debug mode by adding to your component:
```typescript
// Temporarily add for debugging
console.log('Flag evaluation:', await myFlag());
```

Check Statsig Diagnostics: https://console.statsig.com/k1kCBz05vvOKf3yNkwqP9/diagnostics