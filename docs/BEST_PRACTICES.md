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
// features/booking/hooks/useBookingState.ts
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
import { m } from "@/i18n";

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
const BookingForm = lazy(() => import('@/features/booking').then(m => ({ default: m.BookingForm })));

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
- [ ] Linting passes (`bun run check`)
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