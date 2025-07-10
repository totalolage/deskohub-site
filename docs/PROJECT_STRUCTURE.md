# DeskohHub Project Structure

This document provides a comprehensive overview of the DeskohHub codebase structure, which follows a **feature-based architecture** pattern for improved scalability, maintainability, and developer experience.

## Architecture Philosophy

We organize our code around **business features** rather than technical layers. Each feature is a self-contained module that includes all the code necessary to implement a specific business capability. This approach provides several benefits:

- **Encapsulation**: Features contain all their related code in one place
- **Scalability**: New features can be added without affecting existing ones
- **Maintainability**: Developers can focus on individual features without understanding the entire codebase
- **Reusability**: Features can be easily shared or moved between projects

## Directory Structure

```
deskohub-site/
├── app/                          # Next.js App Router pages
│   ├── [locale]/                 # Internationalized routes
│   │   ├── layout.tsx           # Locale-specific layout
│   │   ├── page.tsx             # Home page
│   │   ├── reservation/         # Booking pages
│   │   └── workspace-reservation/ # Workspace booking
│   ├── globals.css              # Global styles
│   ├── layout.tsx               # Root layout wrapper
│   ├── not-found.tsx            # 404 page
│   └── rootLayout.tsx           # Main layout with header/footer
│
├── features/                     # Feature-based modules
│   ├── booking/                 # Restaurant booking feature
│   │   ├── actions/            # Server actions
│   │   ├── components/         # Feature-specific components
│   │   ├── hooks/              # Feature-specific hooks
│   │   ├── lib/                # Feature utilities
│   │   ├── schemas/            # Zod schemas
│   │   └── index.ts            # Public exports
│   │
│   ├── contact/                 # Contact information feature
│   │   ├── components/
│   │   └── index.ts
│   │
│   ├── gallery/                 # Image galleries feature
│   │   ├── components/
│   │   └── index.ts
│   │
│   ├── home/                    # Homepage sections
│   │   ├── components/
│   │   └── index.ts
│   │
│   ├── i18n/                    # Internationalization feature
│   │   ├── components/
│   │   └── index.ts
│   │
│   ├── location/                # Location/map feature
│   │   ├── components/
│   │   └── index.ts
│   │
│   ├── navigation/              # Header/footer navigation
│   │   ├── components/
│   │   └── index.ts
│   │
│   ├── theme/                   # Theme management
│   │   ├── components/
│   │   └── index.ts
│   │
│   └── workspace-reservation/   # Workspace booking feature
│       ├── components/
│       ├── schemas/
│       └── index.ts
│
├── shared/                      # Shared resources
│   ├── components/             # Shared components
│   ├── hooks/                  # Shared hooks
│   ├── utils/                  # Shared utilities
│   └── types/                  # Shared TypeScript types
│
├── components/                  # UI component library
│   └── ui/                     # shadcn/ui components
│       ├── button.tsx
│       ├── form.tsx
│       ├── input.tsx
│       └── ...
│
├── i18n/                       # Internationalization config
│   ├── paraglide/             # Generated translations
│   └── translations/          # Source translation files
│
├── assets/                     # Static assets
│   └── images/
│
├── public/                     # Public static files
├── styles/                     # Global styles
└── docs/                       # Documentation
```

## Feature Structure

Each feature follows a consistent internal structure:

```
features/[feature-name]/
├── components/          # React components specific to this feature
│   ├── ComponentName.tsx
│   └── SubComponent.tsx
├── hooks/              # Custom hooks for this feature
│   └── useFeatureHook.ts
├── actions/            # Server actions (if needed)
│   └── featureActions.ts
├── schemas/            # Zod schemas for validation
│   └── featureSchema.ts
├── lib/                # Feature-specific utilities
│   └── featureUtils.ts
├── types/              # TypeScript types (if complex)
│   └── feature.types.ts
└── index.ts            # Public API exports
```

### Feature Guidelines

1. **Self-Containment**: Features should be as independent as possible
2. **Clear Exports**: Only export what's needed by other features via `index.ts`
3. **No Cross-Feature Imports**: Features shouldn't import from each other's internal files
4. **Shared Dependencies**: Use `/shared` for truly common code

## Key Features

### Booking Feature (`/features/booking`)
Handles restaurant table reservations with:
- Multi-step booking form with validation
- Date/time selection with business hours
- Guest count and special requests
- Server-side booking storage
- Email notifications

### Workspace Reservation (`/features/workspace-reservation`)
Manages workspace bookings with:
- Workspace type selection
- Duration-based pricing
- Equipment requests
- Validation schemas

### Navigation (`/features/navigation`)
Contains the main site navigation:
- Responsive header with language switcher
- Footer with contact info and social links
- Mobile menu functionality

### Home (`/features/home`)
Homepage-specific sections:
- Hero banner with CTA
- Statistics showcase

### Gallery (`/features/gallery`)
Image and games galleries:
- Photo gallery grid
- Board games showcase
- Lazy loading images

### i18n (`/features/i18n`)
Internationalization components:
- Language switcher dropdown
- Locale management

## Shared Resources

### `/shared/components`
Components used across multiple features:
- `not-found.tsx` - 404 error page component

### `/shared/hooks`
Reusable React hooks:
- `useDeviceType` - Detect device characteristics
- `useScreenSize` - Responsive screen detection
- `useToast` - Toast notification system
- `useIsMobile` - Mobile detection (deprecated)

### `/shared/utils`
Common utility functions:
- `cn()` - Class name merging utility
- `constants` - Business constants (hours, limits)
- `date-formatting` - Date/time formatters
- `form-utils` - Form helper functions
- `safe-action-client` - Type-safe server actions
- `working-hours-timezone` - Business hours logic
- `zod-i18n` - Internationalized validation

### `/shared/types`
Shared TypeScript type definitions used across features

## UI Components (`/components/ui`)

We use [shadcn/ui](https://ui.shadcn.com/) as our component library. These components are kept separate from features as they're:
- Design system primitives
- Highly reusable
- Theme-aware
- Accessibility-compliant

Examples: Button, Form, Input, Select, Card, Dialog, etc.

## Import Conventions

```typescript
// Import from feature's public API
import { BookingForm } from "@/features/booking";

// Import shared utilities
import { cn } from "@/shared/utils";
import { useToast } from "@/shared/hooks";

// Import UI components
import { Button } from "@/components/ui/button";

// Import i18n
import { m } from "@/i18n";

// NEVER import from feature internals
// ❌ import { InternalComponent } from "@/features/booking/components/internal";
```

## Adding New Features

1. Create a new directory under `/features/[feature-name]`
2. Add the standard subdirectories as needed
3. Create an `index.ts` file to export the public API
4. Keep all feature-specific code within the feature directory
5. Use `/shared` only for truly shared code

Example:
```bash
mkdir -p features/pricing/components features/pricing/hooks
touch features/pricing/index.ts
```

## Best Practices

### 1. Feature Independence
- Features should not depend on each other's internals
- Use events or shared state for feature communication
- Keep coupling loose and dependencies explicit

### 2. Component Organization
- Small, focused components
- Compose larger components from smaller ones
- Keep business logic in hooks or utilities

### 3. State Management
- Local state for component-specific data
- Feature-level state for feature-specific data
- Global state (if needed) in shared stores

### 4. Testing Strategy
- Unit tests for utilities and hooks
- Component tests for UI components
- Integration tests for features
- E2E tests for critical user flows

### 5. Performance
- Lazy load features when possible
- Use React.memo for expensive components
- Optimize images and assets
- Implement proper caching strategies

## Migration Guide

When migrating existing code to feature-based architecture:

1. Identify the business feature
2. Create the feature directory structure
3. Move all related code to the feature
4. Update imports to use the feature's public API
5. Test thoroughly

## Conclusion

This feature-based architecture provides a scalable foundation for the DeskohHub application. By organizing code around business capabilities rather than technical layers, we achieve better maintainability, clearer boundaries, and improved developer experience.