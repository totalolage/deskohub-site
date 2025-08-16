# Effect-ts: A Comprehensive Guide to TypeScript's Missing Standard Library

## Executive Summary

Effect is a powerful TypeScript library that addresses fundamental limitations in JavaScript/TypeScript's ecosystem by providing a comprehensive standard library for building production-ready applications. At its core, Effect transforms how we handle errors, manage dependencies, and compose complex asynchronous operations through a type-safe functional programming approach.

### Key Benefits
- **Type-safe error handling**: Errors become first-class values in your type system, eliminating runtime surprises
- **Built-in dependency injection**: Compile-time safe dependency management without decorators or reflection
- **Comprehensive standard library**: Reduces dependency on countless small npm packages
- **Production-ready features**: Built-in support for tracing, metrics, retries, and concurrency
- **Better composability**: Effects compose naturally, making complex workflows manageable

### When to Use Effect
- **Large-scale applications** where type safety and maintainability are critical
- **Complex async workflows** with multiple potential failure points
- **Microservices** requiring robust error handling and observability
- **Projects** where you want to replace multiple libraries (Lodash, Zod, RxJS) with a unified solution

### When Traditional Approaches Might Suffice
- Small scripts or utilities with simple error handling needs
- Projects with teams unfamiliar with functional programming concepts
- Applications where bundle size is extremely critical (though Effect offers a `Micro` module for this)

## Introduction and Background

### The Problem with TypeScript

Consider this seemingly innocent function:

```typescript
const getUserById = (id: string): Promise<User> => { 
  // implementation
}
```

This signature lies. It promises a `User` but hides numerous potential failures:
- Network errors
- Authentication failures
- User not found
- Invalid response format
- Database connection issues

In traditional TypeScript, these errors surface as runtime exceptions, often as `unknown` in catch blocks, providing no compile-time safety.

### How Effect Fills the Gap

Effect reimagines this function with explicit error handling:

```typescript
const getUserById = (id: string): Effect<User, NetworkError | UserNotFound | ParseError, Database> => {
  // implementation  
}
```

Now the signature tells the complete story:
- Returns a `User` on success
- Can fail with specific, typed errors
- Requires a `Database` service to run

### Evolution from fp-ts

Effect builds upon ideas from fp-ts (another functional programming library by Giulio Canti) but adds:
- Production-ready features (retry policies, tracing, metrics)
- Built-in services and dependency injection
- Better developer experience with dual APIs
- First-class concurrency support
- Comprehensive testing utilities

Companies report successful migrations from fp-ts to Effect, with one team migrating 500k lines of code in just two months.

## Core Concepts and Mental Model

### The Effect Type

The heart of Effect is the `Effect<Success, Error, Requirements>` type:

```typescript
type Effect<Success, Error, Requirements> = {
  // Represents a computation that:
  // - Succeeds with a value of type Success
  // - Can fail with an error of type Error  
  // - Requires dependencies of type Requirements
}
```

Think of an Effect as a **description** of a computation, not the computation itself. This is similar to how a recipe describes how to cook a dish but isn't the cooking itself.

### Lazy Execution

Effects are lazy - they don't run until explicitly executed:

```typescript
import { Effect } from "effect"

// This doesn't do anything yet - just describes the computation
const program = Effect.succeed(42)

// Now it runs
const result = Effect.runSync(program) // 42
```

### Effects vs Promises

| Aspect | Promise | Effect |
|--------|---------|--------|
| Execution | Eager (runs immediately) | Lazy (runs when needed) |
| Error types | Always `unknown` | Explicitly typed |
| Cancellation | Not supported | Built-in |
| Composition | Limited (then/catch) | Rich combinators |
| Dependencies | Implicit/global | Explicit in type |

### Mental Model: Restaurant Analogy

Imagine Effect as a restaurant order system:
- **Effect** = Order ticket (describes what to cook)
- **Success** = The completed dish
- **Error** = What can go wrong (missing ingredients, kitchen fire)
- **Requirements** = What's needed (chef, kitchen, ingredients)
- **Running the Effect** = Actually cooking the order

## Effect API Overview

### Creating Effects

Effect provides multiple ways to create effects based on your needs:

```typescript
import { Effect } from "effect"

// Simple success value
const success = Effect.succeed(42)

// Simple failure  
const failure = Effect.fail(new Error("Something went wrong"))

// From synchronous function (can't fail)
const randomNumber = Effect.sync(() => Math.random())

// From synchronous function (can fail)
const parseJson = Effect.try({
  try: () => JSON.parse(jsonString),
  catch: (error) => new ParseError(`Failed to parse: ${error}`)
})

// From Promise (can't fail)
const delay = Effect.promise(() => 
  new Promise(resolve => setTimeout(() => resolve("done"), 1000))
)

// From Promise (can fail)
const fetchData = Effect.tryPromise({
  try: () => fetch(url).then(r => r.json()),
  catch: (error) => new NetworkError(`Fetch failed: ${error}`)
})
```

### Running Effects

Different execution strategies for different scenarios:

```typescript
// Synchronous execution
const syncResult = Effect.runSync(Effect.succeed(42)) // 42

// Asynchronous execution (returns Promise)
const promiseResult = await Effect.runPromise(
  Effect.promise(() => fetch('/api/data'))
)

// Get detailed exit information
const exit = await Effect.runPromiseExit(program)
if (exit._tag === "Success") {
  console.log("Success:", exit.value)
} else {
  console.log("Failure:", exit.cause)
}
```

### Composition Patterns

#### Pipe-based Composition

The pipe function enables left-to-right data flow:

```typescript
import { pipe } from "effect/Function"
import { Effect } from "effect"

const program = pipe(
  Effect.succeed(5),
  Effect.map(n => n * 2),        // 10
  Effect.map(n => n + 1),         // 11  
  Effect.tap(n => Effect.log(`Result: ${n}`))
)
```

#### Generator Syntax

For a more familiar async/await-like experience:

```typescript
const program = Effect.gen(function* () {
  const a = yield* Effect.succeed(5)
  const b = yield* Effect.succeed(10)
  const sum = a + b
  yield* Effect.log(`Sum: ${sum}`)
  return sum
})
```

**Critical**: Always use `yield*` (not `yield`). Forgetting the asterisk is a common mistake that the compiler won't catch!

#### Combining Both Approaches

```typescript
const complexProgram = Effect.gen(function* () {
  const config = yield* Config.load()
  
  const result = yield* pipe(
    fetchUserData(config.apiUrl),
    Effect.retry(retryPolicy),
    Effect.timeout("10 seconds")
  )
  
  return result
})
```

## Error Handling

### Typed Errors as Values

Effect treats errors as values, not exceptions. Every error is explicitly typed:

```typescript
class UserNotFound {
  readonly _tag = "UserNotFound"
  constructor(readonly userId: string) {}
}

class NetworkError {
  readonly _tag = "NetworkError"  
  constructor(readonly message: string) {}
}

const getUser = (id: string): Effect<User, UserNotFound | NetworkError, never> =>
  Effect.gen(function* () {
    const response = yield* fetchUser(id).pipe(
      Effect.mapError(e => new NetworkError(e.message))
    )
    
    if (response.status === 404) {
      return yield* Effect.fail(new UserNotFound(id))
    }
    
    return yield* parseUser(response)
  })
```

### Error Handling Patterns

#### Pattern Matching with catchTags

```typescript
const program = pipe(
  getUser("123"),
  Effect.catchTags({
    UserNotFound: (error) => 
      Effect.succeed({ name: "Default User", id: error.userId }),
    NetworkError: (error) =>
      Effect.fail(new Error(`Network issue: ${error.message}`))
  })
)
```

#### Providing Fallbacks

```typescript
const withFallback = pipe(
  riskyOperation,
  Effect.orElse(() => Effect.succeed(defaultValue))
)
```

#### Retry Strategies

```typescript
import { Schedule } from "effect"

const retryPolicy = Schedule.exponential("100 millis").pipe(
  Schedule.jittered,
  Schedule.either(Schedule.recurs(3))
)

const resilientFetch = pipe(
  fetchData,
  Effect.retry(retryPolicy)
)
```

### Real-World Example

```typescript
const processPayment = (amount: number): Effect<PaymentResult, PaymentError, PaymentGateway> =>
  Effect.gen(function* () {
    // Validate amount
    if (amount <= 0) {
      return yield* Effect.fail(new InvalidAmount(amount))
    }
    
    // Get payment gateway service
    const gateway = yield* PaymentGateway
    
    // Process with retry
    const result = yield* pipe(
      gateway.charge(amount),
      Effect.retry(Schedule.recurs(3)),
      Effect.catchTags({
        NetworkError: () => Effect.fail(new PaymentNetworkError()),
        InvalidCard: (e) => Effect.fail(new PaymentCardError(e.reason))
      })
    )
    
    // Log success
    yield* Effect.log(`Payment processed: ${result.transactionId}`)
    
    return result
  })
```

## Dependency Injection

### Defining Services

Services in Effect are defined using `Context.Tag`:

```typescript
import { Context, Effect } from "effect"

// Define service interface
interface IDatabase {
  query: (sql: string) => Effect<any[], DatabaseError, never>
  execute: (sql: string) => Effect<void, DatabaseError, never>
}

// Create service tag
class Database extends Context.Tag("Database")<Database, IDatabase>() {}

// Define another service that depends on Database
interface IUserRepository {
  findById: (id: string) => Effect<User | null, DatabaseError, never>
  save: (user: User) => Effect<void, DatabaseError, never>
}

class UserRepository extends Context.Tag("UserRepository")<UserRepository, IUserRepository>() {}
```

### Implementing Services

```typescript
// Database implementation
const DatabaseLive = Layer.succeed(
  Database,
  Database.of({
    query: (sql) => Effect.tryPromise({
      try: () => pgClient.query(sql),
      catch: (e) => new DatabaseError(e.message)
    }),
    execute: (sql) => Effect.tryPromise({
      try: () => pgClient.execute(sql),
      catch: (e) => new DatabaseError(e.message)
    })
  })
)

// UserRepository implementation (depends on Database)
const UserRepositoryLive = Layer.effect(
  UserRepository,
  Effect.gen(function* () {
    const db = yield* Database
    
    return UserRepository.of({
      findById: (id) => db.query(`SELECT * FROM users WHERE id = $1`, [id]).pipe(
        Effect.map(rows => rows[0] || null)
      ),
      save: (user) => db.execute(
        `INSERT INTO users (id, name) VALUES ($1, $2)`,
        [user.id, user.name]
      )
    })
  })
)
```

### Using Services

```typescript
const program = Effect.gen(function* () {
  // Services are accessed by yielding their tag
  const userRepo = yield* UserRepository
  
  const user = yield* userRepo.findById("123")
  if (!user) {
    return yield* Effect.fail(new UserNotFound("123"))
  }
  
  return user
})

// Provide all dependencies at the edge
const runnable = pipe(
  program,
  Effect.provide(Layer.mergeAll(DatabaseLive, UserRepositoryLive))
)

Effect.runPromise(runnable)
```

### Testing with Mock Services

```typescript
const DatabaseTest = Layer.succeed(
  Database,
  Database.of({
    query: () => Effect.succeed([{ id: "123", name: "Test User" }]),
    execute: () => Effect.succeed(undefined)
  })
)

// Run tests with mock database
const testProgram = pipe(
  program,
  Effect.provide(Layer.mergeAll(DatabaseTest, UserRepositoryLive))
)
```

## Ecosystem Modules

### Effect Schema

Type-safe validation and serialization:

```typescript
import { Schema } from "@effect/schema"

const User = Schema.struct({
  id: Schema.string,
  name: Schema.string,
  email: Schema.string.pipe(Schema.email),
  age: Schema.number.pipe(Schema.between(0, 150))
})

// Parse unknown data
const parseUser = Schema.parseEither(User)

const result = parseUser({ 
  id: "123", 
  name: "John", 
  email: "john@example.com",
  age: 30 
})
```

### Effect SQL

Type-safe database operations:

```typescript
import { SqlClient } from "@effect/sql"

const program = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  
  const users = yield* sql`
    SELECT * FROM users 
    WHERE age > ${18}
    ORDER BY name
  `
  
  return users
})
```

### Effect Platform

HTTP server and client operations:

```typescript
import { HttpServer, HttpServerRequest } from "@effect/platform"

const app = HttpServer.router.empty.pipe(
  HttpServer.router.get("/users/:id", 
    Effect.gen(function* () {
      const req = yield* HttpServerRequest.HttpServerRequest
      const id = req.params.id
      
      const user = yield* getUserById(id)
      
      return HttpServer.response.json(user)
    })
  )
)
```

### Effect OpenTelemetry

Built-in observability:

```typescript
import { NodeSdk } from "@effect/opentelemetry"

const program = Effect.gen(function* () {
  yield* Effect.log("Starting operation")
  
  const result = yield* Effect.withSpan("fetchUser")(
    fetchUserWithMetrics("123")
  )
  
  return result
})

// Automatic tracing and metrics
NodeSdk.layer.pipe(
  Layer.provide(OtelSdk.layer)
)
```

## Practical Examples

### Example 1: API Client with Comprehensive Error Handling

```typescript
import { Effect, pipe, Schedule } from "effect"

// Error types
class ApiError {
  readonly _tag = "ApiError"
  constructor(readonly status: number, readonly message: string) {}
}

class ParseError {
  readonly _tag = "ParseError"
  constructor(readonly error: unknown) {}
}

class NetworkError {
  readonly _tag = "NetworkError"
  constructor(readonly error: unknown) {}
}

// API client implementation
const apiClient = {
  get: <T>(url: string): Effect<T, ApiError | ParseError | NetworkError, never> =>
    Effect.gen(function* () {
      // Fetch with timeout
      const response = yield* pipe(
        Effect.tryPromise({
          try: () => fetch(url),
          catch: (error) => new NetworkError(error)
        }),
        Effect.timeout("5 seconds"),
        Effect.retry(Schedule.exponential("100 millis", 2).pipe(
          Schedule.recurs(3)
        ))
      )
      
      // Check status
      if (!response.ok) {
        return yield* Effect.fail(
          new ApiError(response.status, response.statusText)
        )
      }
      
      // Parse JSON
      const data = yield* Effect.tryPromise({
        try: () => response.json() as Promise<T>,
        catch: (error) => new ParseError(error)
      })
      
      return data
    })
}

// Usage with error handling
const getWeather = (city: string) => pipe(
  apiClient.get<WeatherData>(`/api/weather/${city}`),
  Effect.catchTags({
    NetworkError: () => Effect.succeed({ 
      temp: 20, 
      description: "Offline - showing cached data" 
    }),
    ApiError: (error) => error.status === 404
      ? Effect.fail(new CityNotFound(city))
      : Effect.fail(error),
    ParseError: () => Effect.fail(new Error("Invalid weather data"))
  })
)
```

### Example 2: Service Composition

```typescript
// Services
interface EmailService {
  send: (to: string, subject: string, body: string) => Effect<void, EmailError, never>
}

class EmailService extends Context.Tag("EmailService")<EmailService, EmailService>() {}

interface NotificationService {
  notifyUser: (userId: string, message: string) => Effect<void, NotificationError, never>
}

class NotificationService extends Context.Tag("NotificationService")<NotificationService, NotificationService>() {}

// Implementation that composes services
const NotificationServiceLive = Layer.effect(
  NotificationService,
  Effect.gen(function* () {
    const userRepo = yield* UserRepository
    const emailService = yield* EmailService
    
    return NotificationService.of({
      notifyUser: (userId, message) => 
        Effect.gen(function* () {
          const user = yield* userRepo.findById(userId)
          if (!user) {
            return yield* Effect.fail(new UserNotFound(userId))
          }
          
          yield* emailService.send(
            user.email,
            "Notification",
            message
          )
        })
    })
  })
)
```

### Example 3: Concurrent Operations

```typescript
const processUserBatch = (userIds: string[]) =>
  Effect.gen(function* () {
    // Process users concurrently with a limit
    const results = yield* Effect.forEach(
      userIds,
      (userId) => pipe(
        processUser(userId),
        Effect.catchAll((error) => 
          Effect.succeed({ userId, status: "failed", error })
        )
      ),
      { concurrency: 5 }
    )
    
    // Aggregate results
    const successful = results.filter(r => r.status === "success")
    const failed = results.filter(r => r.status === "failed")
    
    yield* Effect.log(`Processed ${successful.length} successfully, ${failed.length} failed`)
    
    return { successful, failed }
  })
```

## Common Pitfalls

### 1. Forgetting the Asterisk in yield*

```typescript
// ❌ Wrong - this won't work
const bad = Effect.gen(function* () {
  const value = yield Effect.succeed(42) // Missing *
  return value
})

// ✅ Correct
const good = Effect.gen(function* () {
  const value = yield* Effect.succeed(42)
  return value
})
```

### 2. Running Effects Multiple Times

```typescript
// ❌ Inefficient - runs the effect twice
const program = Effect.gen(function* () {
  if (yield* Effect.runSync(checkCondition)) {
    return yield* Effect.runSync(doSomething)
  }
})

// ✅ Better - compose effects without running
const program = Effect.gen(function* () {
  const condition = yield* checkCondition
  if (condition) {
    return yield* doSomething
  }
})
```

### 3. Ignoring Bundle Size

```typescript
// For smaller bundles, use the Micro module
import { Micro } from "effect"

const lightweight = Micro.gen(function* () {
  // Similar API but smaller bundle
})
```

### 4. Over-engineering Simple Cases

```typescript
// ❌ Over-engineered for simple case
const add = (a: number, b: number): Effect<number, never, never> =>
  Effect.succeed(a + b)

// ✅ Keep it simple when appropriate
const add = (a: number, b: number): number => a + b
```

### 5. Not Leveraging Type Inference

```typescript
// ❌ Explicit types everywhere
const program: Effect<User, ApiError, Database> = Effect.gen(function* (): Generator<any, User, any> {
  // ...
})

// ✅ Let TypeScript infer
const program = Effect.gen(function* () {
  // TypeScript infers the correct types
})
```

## Best Practices

### Code Organization

Structure your application in layers:

```typescript
// domain/models.ts
export class User { ... }
export class UserNotFound { ... }

// domain/repositories.ts
export interface IUserRepository { ... }
export class UserRepository extends Context.Tag(...) {}

// infrastructure/database.ts
export const DatabaseLive = Layer.succeed(...)

// infrastructure/repositories.ts  
export const UserRepositoryLive = Layer.effect(...)

// application/services.ts
export const getUserProfile = (id: string) => Effect.gen(...)

// main.ts
const MainLive = Layer.mergeAll(
  DatabaseLive,
  UserRepositoryLive,
  // ... other layers
)

pipe(
  program,
  Effect.provide(MainLive),
  Effect.runPromise
)
```

### Error Modeling

Design errors as discriminated unions:

```typescript
// ✅ Good - specific, actionable errors
class InvalidEmail {
  readonly _tag = "InvalidEmail"
  constructor(readonly email: string) {}
}

class EmailAlreadyExists {
  readonly _tag = "EmailAlreadyExists"
  constructor(readonly email: string) {}
}

// ❌ Avoid - too generic
class ValidationError {
  constructor(readonly message: string) {}
}
```

### Testing Strategy

```typescript
// Create test layers
const TestContext = Layer.mergeAll(
  MockDatabase,
  MockEmailService,
  UserRepositoryLive // Real implementation with mock dependencies
)

// Test with dependency injection
test("should create user", async () => {
  const program = createUser({ 
    name: "Test", 
    email: "test@example.com" 
  })
  
  const result = await pipe(
    program,
    Effect.provide(TestContext),
    Effect.runPromise
  )
  
  expect(result.name).toBe("Test")
})
```

### When to Use Generators vs Pipes

**Use Generators when:**
- You have sequential operations with intermediate values
- You need standard control flow (if/else, loops)
- Code readability is paramount

**Use Pipes when:**
- You're transforming data through a pipeline
- Operations are more functional (map, filter, etc.)
- You want to emphasize the data flow

```typescript
// Generator - good for sequential logic
const sequential = Effect.gen(function* () {
  const user = yield* getUser(id)
  if (user.isActive) {
    const profile = yield* getProfile(user.id)
    return { ...user, ...profile }
  }
  return user
})

// Pipe - good for transformations
const transformation = pipe(
  getUsers(),
  Effect.map(users => users.filter(u => u.isActive)),
  Effect.flatMap(activeUsers => 
    Effect.forEach(activeUsers, enrichUserData)
  )
)
```

## Conclusion and Further Reading

### Getting Started Recommendations

1. **Start Small**: Begin with basic Effect types and error handling
2. **Learn Incrementally**: Master one concept before moving to the next
3. **Use Types**: Let TypeScript's inference guide you
4. **Practice Composition**: Focus on combining small effects into larger ones
5. **Embrace the Ecosystem**: Gradually adopt Schema, Platform, and other modules

### Key Resources

- **Official Documentation**: [effect.website](https://effect.website)
- **API Reference**: [Effect API Docs](https://effect.website/docs/guides/essentials/effect-type)
- **GitHub Repository**: [github.com/Effect-TS/effect](https://github.com/Effect-TS/effect)
- **Discord Community**: Active community for questions and discussions
- **Course**: ["Effect: Beginners Complete Getting Started"](https://www.typeonce.dev/course/effect-beginners-complete-getting-started) by Sandro Maglione

### Migration from fp-ts

If migrating from fp-ts:
1. Effects are similar to `ReaderTaskEither` but with reversed type parameters
2. Start by migrating leaf functions (those without dependencies)
3. Use proxy patterns to gradually migrate while maintaining compatibility
4. Expect roughly 10% time investment for large codebases

### Final Thoughts

Effect represents a paradigm shift in TypeScript development. While the learning curve is real, the benefits in terms of type safety, error handling, and maintainability make it worthwhile for serious production applications. As JavaScript/TypeScript's missing standard library, Effect is positioned to become an essential tool in the TypeScript ecosystem.

The key is to start simple, be patient with the learning process, and gradually incorporate more advanced features as your comfort level grows. The investment in learning Effect pays dividends in more robust, maintainable, and predictable applications.