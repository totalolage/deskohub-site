# Migration from Vercel Edge Config to Direct Statsig API

## Overview
This document describes the migration from Vercel Edge Config to Statsig's direct API for feature flag management, implemented to resolve excessive Edge Config read issues that caused account suspension.

## Problem
The application was exceeding Vercel's Edge Config read limits due to:
- Server-side flag evaluation on every page request
- Aggressive 1-second sync intervals in the Statsig adapter
- No request-level caching of flag evaluations
- Multiple independent flag evaluations per request

## Solution

### 1. Removed Edge Config Integration
- Removed environment variables from Vercel:
  - `EXPERIMENTATION_CONFIG` 
  - `EXPERIMENTATION_CONFIG_ITEM_KEY`
- Updated `flags.ts` to use direct Statsig API connection
- Increased sync intervals: 10s in development, 60s in production

### 2. Implemented Request-Level Caching with Batch Fetching
Created `/shared/utils/feature-flags/flags.ts` with:
- React's `cache()` function for request-level memoization
- **Single batch fetch**: All flags fetched together in one API call
- Individual flag functions that access the cached batch result
- Ensures maximum one Statsig API call per request regardless of how many flags are used

### 3. Updated All Flag Imports
Migrated all components and pages from root `/flags` imports to cached versions:
- `import { boardGamesListFlag } from "@/flags"` → `import { boardGamesListFlag } from "@/shared/utils/feature-flags/flags"`
- Same function names, just different import path
- All flags now automatically cached at request level

## Benefits
1. **Zero Edge Config Reads**: No longer using Edge Config at all
2. **Single API Call per Request**: All flags fetched together in one batch
3. **Better Performance**: Statsig's API has built-in caching and CDN
4. **Cost Savings**: No Edge Config usage charges
5. **Optimized Network Usage**: One API call regardless of how many flags are used

## Implementation Details

### Clean Architecture
- **Single source of truth**: `/shared/lib/feature-flags.ts` contains all feature flag logic
- **No multiple files**: Everything consolidated into one clean module
- **Batch fetching**: All flags fetched together in one API call per request
- **Request caching**: Uses React's `cache()` for automatic request-level memoization

### Configuration Changes
```typescript
// Before (with Edge Config)
const statsigAdapter = createDefaultStatsigAdapter();

// After (direct API)
const statsigAdapter = createStatsigAdapter({
  statsigServerApiKey: env.STATSIG_SERVER_API_KEY,
  statsigOptions: {
    rulesetsSyncIntervalMs: isDev() ? 10000 : 60000,
    initStrategyForIDLists: "none",
    disableIdListsSync: true,
  }
});
```

### Usage Pattern
```typescript
// Simple, clean import from single location
import { boardGamesListFlag } from "@/shared/lib/feature-flags";

// Use the flag - automatically cached and batch-fetched
const enabled = await boardGamesListFlag();
```

The implementation ensures:
- All flags are fetched in a single batch API call
- Results are cached for the entire request
- Individual flag functions return values from the cached batch
- Clean, simple API for developers

## Deployment Steps
1. ✅ Remove Edge Config environment variables from Vercel
2. ✅ Deploy code changes
3. ✅ Verify feature flags work correctly
4. ✅ Monitor Statsig dashboard for proper flag evaluation

## Monitoring
- Check Statsig dashboard at: https://console.statsig.com/k1kCBz05vvOKf3yNkwqP9
- Monitor flag evaluation metrics
- Verify no Edge Config reads in Vercel dashboard

## Rollback Plan
If issues arise:
1. Re-add Edge Config environment variables to Vercel
2. Revert `flags.ts` changes to use `createDefaultStatsigAdapter()`
3. Deploy rollback

## Future Improvements
Consider:
- Static generation (ISR) for pages with stable flag values
- Edge caching for flag evaluations
- Reducing number of feature flags
- Client-side flag evaluation for non-critical features