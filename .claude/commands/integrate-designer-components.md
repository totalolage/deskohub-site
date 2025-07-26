---
description: Integrate designer-exported pages into the DeskohHub codebase following feature-based architecture
argument-hint: [feature-name]
---

## Context

Current git status showing imported files:
!`git status`

## Task

Integrate the designer-exported components into a feature called "$ARGUMENTS" (or determine the appropriate feature name if not provided).

## Integration Process

### 1. Initial Assessment

**Identify imported files** - The untracked files shown above are what designers exported. Typically includes:
- Main page component
- Several section components
- Common components (header/footer - remove these)
- Assets (images, fonts)

**Determine target feature**:
- New feature: Create new feature structure
- Existing feature: Integrate into existing structure

### 2. Component Analysis

**Map components**:
- Identify duplicates with existing UI components
- List components to replace/merge/create
- Check design system compliance (colors, spacing, responsive breakpoints)

**Common duplicates to remove**:
- Headers/footers → Use `/features/navigation`
- Buttons → Use `/components/ui/button`
- Form components → Use `/components/ui/form`

### 3. File Organization

**Feature-based structure**:
```
features/
└── $ARGUMENTS/
    ├── components/
    │   ├── ${ARGUMENTS}Hero.tsx       # Renamed from hero-section.tsx
    │   ├── ${ARGUMENTS}Features.tsx   # Renamed from features-section.tsx
    │   └── ${ARGUMENTS}CTA.tsx        # Renamed from cta-section.tsx
    ├── types/
    │   └── $ARGUMENTS.types.ts
    └── index.ts                       # Public exports

app/
└── [locale]/
    └── $ARGUMENTS/
        └── page.tsx                   # Uses components from feature

assets/
└── images/
    └── [moved images]
```

**Naming convention**: Prefix components with feature name for clarity

### 4. Server vs Client Components

**Decision tree**:
1. Needs hooks/state/effects? → **Client Component** (`"use client"`)
2. Has event handlers? → **Client Component**
3. Uses browser APIs? → **Client Component**
4. Only displays data? → **Server Component** (default)

**Best practice**: Extract interactive parts into small client components, keep parent sections as server components.

### 5. Code Integration

**Component conversion**:
```typescript
// ❌ From designer (default export)
export default function HeroSection() {
  return <div className={`bg-blue-500 ${active ? 'border' : ''}`}>...</div>
}

// ✅ To integrated (named export, arrow function)
import { cn } from "@/shared/utils";

export const ${ARGUMENTS}Hero = () => {
  return (
    <div className={cn("bg-primary", active && "border")}>...</div>
  );
};
```

**Page structure**:
```typescript
// app/[locale]/$ARGUMENTS/page.tsx
import { ${ARGUMENTS}Hero, ${ARGUMENTS}Features } from "@/features/$ARGUMENTS";
import { m, setLocale } from "@/i18n";
import type { RouteProps_locale } from "../route";
import { metadata } from "@/shared/utils/metadata";

export const generateMetadata = metadata({
  title: m["$ARGUMENTS.pageTitle"](),
  description: m["$ARGUMENTS.pageDescription"](),
});

export default async function ${ARGUMENTS}Page({ params }: RouteProps_locale) {
  setLocale((await params).locale); // CRITICAL: Always set locale!
  
  return (
    <>
      <${ARGUMENTS}Hero />
      <${ARGUMENTS}Features />
    </>
  );
}
```

### 6. i18n Integration

**Paraglide patterns**:
- Files generated with underscores: `feature_hero_title.js`
- But exported with dots: `export { feature_hero_title as "feature.hero.title" }`
- Always use dot notation: `m["$ARGUMENTS.hero.title"]()`

**Add translations to both**:
- `i18n/locales/cs-CZ.json`
- `i18n/locales/en-US.json`

**Structure**:
```json
{
  "$ARGUMENTS": {
    "pageTitle": "Page Title - Deskohub",
    "hero": {
      "title": "Hero Title",
      "subtitle": "Hero Subtitle"
    }
  }
}
```

**Debug i18n issues**:
```bash
# Check if messages compiled
tail -f /tmp/deskohub.log  # or wherever logs are piped

# Find correct message keys
grep -E "export {" i18n/paraglide/messages/${ARGUMENTS}_*.js
```

### 7. Critical Rules

**className composition**:
```typescript
// ❌ NEVER use template strings
className={`text-${size} ${active ? 'bg-blue' : 'bg-gray'}`}

// ✅ ALWAYS use cn()
className={cn(
  "text-base",
  size === "large" && "text-lg",
  active ? "bg-blue" : "bg-gray"
)}
```

**Feature exports** (`features/$ARGUMENTS/index.ts`):
```typescript
export { ${ARGUMENTS}Hero } from "./components/${ARGUMENTS}Hero";
export { ${ARGUMENTS}Features } from "./components/${ARGUMENTS}Features";
export type { ${ARGUMENTS}Data } from "./types/$ARGUMENTS.types";
```

### 8. Commands

Create feature structure:
```bash
mkdir -p features/$ARGUMENTS/components features/$ARGUMENTS/types
touch features/$ARGUMENTS/index.ts
```

Move and rename components:
```bash
# Example moves (adjust based on actual files)
mv hero-section.tsx features/$ARGUMENTS/components/${ARGUMENTS}Hero.tsx
mv features-section.tsx features/$ARGUMENTS/components/${ARGUMENTS}Features.tsx
```

After integration:
```bash
bun run lint
bun run build
bun run dev
```

Clean up:
```bash
# Remove designer duplicates
rm components/header.tsx components/footer.tsx
```

## Checklist

- [ ] Used `git status` to identify imported files
- [ ] Created feature directory structure
- [ ] Moved and renamed components with feature prefix
- [ ] Removed duplicate headers/footers/navigation
- [ ] Converted default exports to named arrow functions
- [ ] Determined server vs client components
- [ ] Updated all imports to use `@/` aliases
- [ ] Used `cn()` for all className composition
- [ ] Added `setLocale()` call in page component
- [ ] Created i18n translations in both languages
- [ ] Used metadata utility for page SEO
- [ ] Created feature index.ts with exports
- [ ] Ran lint and build successfully
- [ ] Cleaned up unused designer files