# DeskohHub Development Best Practices

This document outlines coding standards, patterns, and best practices for the DeskohHub project.

## Feature-Based Architecture

### Do's ✅

- **Keep features self-contained**: Each feature should include all necessary components, hooks, and utilities
- **Export through index.ts**: Only expose what's needed by other parts of the application
- **Use clear naming**: Feature names should reflect business capabilities (e.g., `booking`, `gallery`)
- **Organize by business logic**: Group related functionality together

### Don'ts ❌

- **Don't import from feature internals**: Always import from the feature's index file
- **Don't create circular dependencies**: Features should not depend on each other
- **Don't put shared code in features**: Use `/shared` for truly reusable code

## Page Implementation Guidelines

### Page Structure and Sections

Pages should be split into logical sections, with each section being a separate component:

```typescript
// ✅ Good - Page composed of section components
// app/[locale]/training-room/page.tsx
export default async function TrainingRoomPage({ params }: RouteProps_locale) {
  setLocale((await params).locale);
  
  return (
    <>
      <TrainingHero />
      <TrainingPackages />
      <TrainingGallery />
      <TrainingBenefits />
      <TrainingCTA />
    </>
  );
}

// ❌ Avoid - Monolithic page with all content inline
export default async function TrainingRoomPage() {
  return (
    <div>
      <section className="hero">
        {/* All hero content inline */}
      </section>
      <section className="packages">
        {/* All packages content inline */}
      </section>
      {/* More inline content */}
    </div>
  );
}
```

### Server vs Client Components

**Default to Server Components** - Only use Client Components for the smallest localized behaviors:

```typescript
// ✅ Good - Server component for static content
// features/home/components/HomeHero.tsx
export const HomeHero = () => {
  return (
    <section className="hero">
      <h1>{m["home.hero.title"]()}</h1>
      <p>{m["home.hero.description"]()}</p>
    </section>
  );
};

// ✅ Good - Client component scoped to interactive behavior only
// features/table-reservation/components/DatePicker.tsx
"use client";

export const DatePicker = ({ onDateChange }: DatePickerProps) => {
  const [selectedDate, setSelectedDate] = useState<Date>();
  
  // Interactive logic here
  return <Calendar />;
};

// ❌ Avoid - Making entire sections client components unnecessarily
"use client";

export const EntireSection = () => {
  // Only the form needs interactivity, not the whole section
  return (
    <section>
      <h2>Static Content</h2>
      <p>More static content</p>
      <InteractiveForm /> {/* Only this needs to be client */}
    </section>
  );
};
```

### Section Component Best Practices

1. **Keep sections focused** - Each section should have a single responsibility
2. **Use semantic HTML** - Wrap sections in `<section>` tags with appropriate ARIA labels
3. **Consistent spacing** - Use standardized padding/margin patterns across sections
4. **Responsive by default** - Ensure all sections work across breakpoints

## Component Guidelines

### Functional Components

Always use functional components with TypeScript:

```typescript
// ✅ Good
export const ComponentName = ({ prop1, prop2 }: ComponentProps) => {
  return <div>{/* content */}</div>;
};

// ❌ Avoid
export default function ComponentName(props) {
  return <div>{/* content */}</div>;
}
```

### Props Interfaces

Define clear prop interfaces:

```typescript
// ✅ Good
interface ComponentProps {
  title: string;
  isActive?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}

// ❌ Avoid
const Component = ({ title, isActive, onClick, children }: any) => {};
```

### File Naming

- Components: `PascalCase.tsx` (e.g., `BookingForm.tsx`)
- Hooks: `camelCase.ts` starting with "use" (e.g., `useBookingLogic.ts`)
- Utilities: `kebab-case.ts` (e.g., `date-formatting.ts`)
- Types: `camelCase.types.ts` (e.g., `booking.types.ts`)

## State Management

### Local State

Use local state for component-specific data:

```typescript
// ✅ Good - Component state
const [isOpen, setIsOpen] = useState(false);

// ✅ Good - Complex state with reducer
const [state, dispatch] = useReducer(bookingReducer, initialState);
```

### Feature State

Keep feature-specific state within the feature:

```typescript
// features/table-reservation/hooks/useReservationState.ts
export const useBookingState = () => {
  const [booking, setBooking] = useState<Booking | null>(null);
  // Feature-specific logic
  return { booking, setBooking };
};
```

## Styling Best Practices

### Use Tailwind Classes

Prefer Tailwind utility classes over custom CSS:

```typescript
// ✅ Good
<div className="flex items-center justify-between p-4 bg-primary rounded-lg">

// ❌ Avoid
<div style={{ display: 'flex', alignItems: 'center' }}>
```

### Use cn() for Dynamic Classes

```typescript
import { cn } from "@/shared/utils";

// ✅ Good
<div className={cn(
  "p-4 rounded-lg",
  isActive && "bg-primary text-white",
  disabled && "opacity-50 cursor-not-allowed"
)}>
```

### Theme Tokens

Always use theme tokens instead of hard-coded colors:

```typescript
// ✅ Good
<div className="bg-primary text-primary-foreground">

// ❌ Avoid
<div className="bg-blue-500 text-white">
```

## Internationalization (i18n)

### Always Use Translations

```typescript
import { m } from "@/features/i18n";

// ✅ Good
<h1>{m["hero.title"]()}</h1>
<p>{m["hero.description"]()}</p>

// ❌ Avoid
<h1>Welcome to DeskohHub</h1>
<p>Your favorite gaming bar</p>
```

### Dynamic Translations

For dynamic content with parameters:

```typescript
// ✅ Good
<p>{m["booking.guestCount"]({ count: 5 })}</p>

// Outputs: "5 guests" or "5 hostů" depending on locale
```

## Pricing and Currency Formatting

### Use Intl API for All Prices

All prices must be formatted using the JavaScript Intl API to ensure proper localization:

```typescript
// ✅ Good - Store prices as numbers in constants
export const pricing = {
  entryFee: {
    withPurchase: 50,    // CZK
    withoutPurchase: 100 // CZK
  },
  training: {
    halfDay: 2500,       // CZK
    fullDay: 4500        // CZK
  }
};

// ✅ Good - Format using Intl API
const formatPrice = (amount: number, locale: string = 'cs-CZ') => {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'CZK',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(amount);
};

// Usage in components
<span>{formatPrice(pricing.entryFee.withPurchase)}</span>
// Outputs: "50 Kč" for Czech locale, "CZK 50" for English locale

// ❌ Never hardcode prices in translations
// Bad: "training.price": "2,500 CZK"
// Bad: "entry.fee": "50 Kč"
```

### Price Constants Location

All prices should be stored in `/shared/utils/constants.ts`:

```typescript
// shared/utils/constants.ts
export const constants = {
  pricing: {
    entryFee: {
      withPurchase: 50,
      withoutPurchase: 100,
      childrenUnder15: 0
    },
    training: {
      halfDay: 2500,
      fullDay: 4500,
      custom: null // Indicate custom pricing
    }
  },
  // ... other constants
};
```

### Price Display Components

Create reusable price display components:

```typescript
// ✅ Good - Reusable price component
export const Price = ({ amount, locale }: { amount: number; locale?: string }) => {
  const userLocale = locale || useLocale();
  
  const formatted = new Intl.NumberFormat(userLocale, {
    style: 'currency',
    currency: 'CZK',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(amount);
  
  return <span className="font-semibold">{formatted}</span>;
};

// Usage
<Price amount={constants.pricing.entryFee.withPurchase} />
```

### Future External API Integration

When prices come from external APIs:

```typescript
// ✅ Good - Prepare for dynamic pricing
interface PricingData {
  entryFeeWithPurchase: number;
  entryFeeWithoutPurchase: number;
  trainingHalfDay: number;
  trainingFullDay: number;
}

const usePricing = () => {
  // For now, return from constants
  return constants.pricing;
  
  // Future: fetch from external API
  // const { data } = useExternalPricing();
  // return data || constants.pricing;
};
```

## TypeScript Best Practices

### Strict Types

Always use strict types:

```typescript
// ✅ Good
const processBooking = (booking: Booking): BookingResult => {
  // Implementation
};

// ❌ Avoid
const processBooking = (booking: any) => {
  // Implementation
};
```

### Avoid Type Assertions

Prefer type guards over assertions:

```typescript
// ✅ Good
const isBooking = (data: unknown): data is Booking => {
  return typeof data === 'object' && data !== null && 'id' in data;
};

// ❌ Avoid
const booking = data as Booking;
```

### Enhanced Type Safety with ts-reset

The project uses `@total-typescript/ts-reset` to provide stricter and more intuitive TypeScript behavior:

```typescript
// With ts-reset, these common APIs have improved types:

// ✅ Array.find returns T | undefined (not just T)
const found = [1, 2, 3].find(n => n === 4); // number | undefined

// ✅ JSON.parse returns unknown (not any)
const parsed = JSON.parse(jsonString); // unknown - requires proper validation

// ✅ Array.filter narrows types correctly
const numbers = mixedArray.filter((item): item is number => typeof item === 'number');

// ✅ Object.keys returns string[] for better flexibility
const keys = Object.keys(myObject); // string[]
```

**Key Benefits:**
- Catches potential runtime errors at compile time
- Forces proper handling of edge cases (undefined, unknown types)
- Improves code reliability and maintainability
- Better IDE autocomplete and type inference

**Note:** When you see type errors after adding ts-reset, they're revealing actual potential issues that need to be handled properly.

## Error Handling

### Use Try-Catch for Async Operations

```typescript
// ✅ Good
try {
  const result = await bookingAction(data);
  if (result.success) {
    // Handle success
  } else {
    // Handle validation errors
  }
} catch (error) {
  console.error('Booking failed:', error);
  // Show user-friendly error
}
```

### Provide User Feedback

Always inform users of errors:

```typescript
// ✅ Good
toast.error(m["booking.errorMessage"]());

// ❌ Avoid
console.error(error); // Only logging, no user feedback
```

## Performance Optimization

### Lazy Loading

Lazy load features when possible:

```typescript
// ✅ Good
const ReservationForm = lazy(() =>
  import("@/features/table-reservation").then((m) => ({
    default: m.TableReservationForm,
  }))
);

// Use with Suspense
<Suspense fallback={<Loading />}>
  <BookingForm />
</Suspense>
```

### Memoization

Use memoization for expensive computations:

```typescript
// ✅ Good
const expensiveResult = useMemo(() => {
  return calculateComplexValue(data);
}, [data]);

// ✅ Good - Memoized component
export const ExpensiveComponent = memo(({ data }: Props) => {
  // Component logic
});
```

## Forms and Validation

### Use React Hook Form + Zod

```typescript
// ✅ Good
const schema = z.object({
  email: z.string().email(),
  name: z.string().min(2).max(50),
});

const form = useForm<z.infer<typeof schema>>({
  resolver: zodResolver(schema),
});
```

### Server-Side Validation

Always validate on the server:

```typescript
// ✅ Good - Server action
export const bookingAction = async (data: unknown) => {
  const validated = bookingSchema.safeParse(data);
  
  if (!validated.success) {
    return { success: false, errors: validated.error.flatten() };
  }
  
  // Process valid data
};
```

### Form Input Error States

All form inputs must use the error variant when displaying validation errors:

```typescript
// ✅ Good - Use error variant for all input components
<Input
  variant={form.formState.errors.email ? "error" : "default"}
  {...field}
/>

<Select value={field.value} onValueChange={field.onChange}>
  <SelectTrigger variant={fieldState.error ? "error" : "default"}>
    <SelectValue />
  </SelectTrigger>
  <SelectContent>
    {/* options */}
  </SelectContent>
</Select>

<Textarea
  variant={form.formState.errors.message ? "error" : "default"}
  {...field}
/>

// ❌ Avoid - Don't use CSS classes for error styling
<Input
  className={cn(
    "base-classes",
    form.formState.errors.email && "border-red-500"
  )}
/>
```

#### Error Variant Requirements

1. **All input components must support error variants**: Input, Select, Textarea, and any custom form controls
2. **Use consistent variant prop**: `variant` with values "default" and "error"
3. **Error styling must use theme tokens**: Use `border-destructive` instead of hardcoded colors
4. **Integrate with form validation**: Always check `form.formState.errors` or `fieldState.error`

#### Implementation Pattern

```typescript
// Component implementation
interface InputProps {
  variant?: "default" | "error";
  // ... other props
}

const inputVariants = cva(
  "base-classes",
  {
    variants: {
      variant: {
        default: "border-border",
        error: "border-destructive focus:ring-destructive",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

// Usage in forms
<FormField
  control={form.control}
  name="email"
  render={({ field, fieldState }) => (
    <FormItem>
      <FormLabel>Email</FormLabel>
      <FormControl>
        <Input
          variant={fieldState.error ? "error" : "default"}
          {...field}
        />
      </FormControl>
      <FormMessage />
    </FormItem>
  )}
/>
```

## Testing Guidelines

### Component Testing

Test user interactions:

```typescript
// ✅ Good
test('submits form with valid data', async () => {
  render(<BookingForm />);
  
  await userEvent.type(screen.getByLabelText(/email/i), 'test@example.com');
  await userEvent.click(screen.getByRole('button', { name: /submit/i }));
  
  expect(mockSubmit).toHaveBeenCalledWith({ email: 'test@example.com' });
});
```

### Integration Testing

Test feature workflows:

```typescript
// ✅ Good
test('complete booking flow', async () => {
  // Test the entire booking process
  // from form submission to confirmation
});
```

## Git Commit Messages

Follow conventional commits:

```bash
# ✅ Good
feat: add pricing feature with tier selection
fix: resolve date picker timezone issue
docs: update API documentation
refactor: extract booking logic to custom hook

# ❌ Avoid
updated files
fix
WIP
```

## Code Review Checklist

Before submitting code:

- [ ] All TypeScript errors resolved
- [ ] Linting passes (`bun run lint`)
- [ ] Build succeeds (`bun run build`)
- [ ] No hardcoded strings (use i18n)
- [ ] No hardcoded colors (use theme)
- [ ] Components follow naming conventions
- [ ] Features are self-contained
- [ ] Imports use feature public APIs
- [ ] Error handling implemented
- [ ] User feedback for all actions
- [ ] Responsive design tested
- [ ] Accessibility considered

## Security Best Practices

### Never Expose Secrets

```typescript
// ❌ Never do this
const API_KEY = "sk-1234567890";

// ✅ Use environment variables
const apiKey = process.env.API_KEY;
```

### Validate All Inputs

```typescript
// ✅ Always validate user input
const sanitizedInput = DOMPurify.sanitize(userInput);
const validatedData = schema.parse(formData);
```

### Use HTTPS

Always use secure connections for external APIs and resources.

## Accessibility (a11y)

### Semantic HTML

```typescript
// ✅ Good
<button onClick={handleClick}>Click me</button>
<nav aria-label="Main navigation">

// ❌ Avoid
<div onClick={handleClick}>Click me</div>
```

### ARIA Labels

```typescript
// ✅ Good
<button aria-label={m["accessibility.closeDialog"]()}>
  <X className="h-4 w-4" />
</button>
```

### Keyboard Navigation

Ensure all interactive elements are keyboard accessible.

## Conclusion

Following these best practices ensures:
- Consistent, maintainable code
- Better developer experience
- Improved performance
- Enhanced user experience
- Easier onboarding for new developers

Remember: **Consistency is key**. When in doubt, follow existing patterns in the codebase.
