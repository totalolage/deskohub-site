import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Context, Effect, Layer } from "effect";
import { StorageError } from "@/shared/backend/errors";
import type { BookingData, BookingStorageItem } from "../booking";

export interface IBookingStorage {
  save: (id: string, data: BookingData) => Effect.Effect<string, StorageError>;
  get: (id: string) => Effect.Effect<BookingData | null, StorageError>;
  getAll: () => Effect.Effect<BookingData[], StorageError>;
}

export class BookingStorage extends Context.Tag("BookingStorage")<
  BookingStorage,
  IBookingStorage
>() {}

// File-based storage for bookings that persists across hot reloads
const globalForBookings = globalThis as unknown as {
  bookingStorageFile: string | undefined;
};

// Create or get the temporary storage file
const getStorageFile = (): Effect.Effect<string, StorageError> =>
  Effect.gen(function* () {
    if (!globalForBookings.bookingStorageFile) {
      // Use Node.js tmpdir for cross-platform compatibility
      globalForBookings.bookingStorageFile = join(
        tmpdir(),
        `deskohub-bookings-${Date.now()}.json`
      );

      // Initialize empty storage if file doesn't exist
      const storageFile = globalForBookings.bookingStorageFile;
      yield* Effect.tryPromise({
        try: async () => {
          try {
            await fs.access(storageFile);
          } catch {
            await fs.writeFile(storageFile, "{}");
          }
        },
        catch: (error) =>
          new StorageError(
            `Failed to initialize storage file: ${error}`,
            "initialize"
          ),
      });
    }
    return globalForBookings.bookingStorageFile;
  });

// Load bookings from file
const loadBookings = (): Effect.Effect<
  Record<string, BookingStorageItem>,
  StorageError
> =>
  Effect.gen(function* () {
    const file = yield* getStorageFile();

    const content = yield* Effect.tryPromise({
      try: () => fs.readFile(file, "utf8"),
      catch: (error) =>
        new StorageError(`Failed to read bookings: ${error}`, "read"),
    });

    return yield* Effect.try({
      try: () => JSON.parse(content) as Record<string, BookingStorageItem>,
      catch: (error) =>
        new StorageError(`Failed to parse storage file: ${error}`, "parse"),
    }).pipe(
      Effect.catchTag("StorageError", () =>
        Effect.succeed({} as Record<string, BookingStorageItem>)
      )
    );
  });

// Save bookings to file
const saveBookings = (
  bookings: Record<string, BookingStorageItem>
): Effect.Effect<void, StorageError> =>
  Effect.gen(function* () {
    const file = yield* getStorageFile();

    yield* Effect.tryPromise({
      try: () => fs.writeFile(file, JSON.stringify(bookings, null, 2)),
      catch: (error) =>
        new StorageError(`Failed to write bookings: ${error}`, "write"),
    });
  });

// Clean up old entries (older than 7 days)
const cleanupOldBookings = (
  bookings: Record<string, BookingStorageItem>
): Record<string, BookingStorageItem> => {
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const cleaned: Record<string, BookingStorageItem> = {};
  for (const [id, item] of Object.entries(bookings)) {
    if (new Date(item.createdAt) >= sevenDaysAgo) {
      cleaned[id] = item;
    }
  }

  return cleaned;
};

export const BookingStorageLive = Layer.succeed(
  BookingStorage,
  BookingStorage.of({
    save: (id, data) =>
      Effect.gen(function* () {
        const storageItem: BookingStorageItem = {
          id,
          data,
          createdAt: new Date(),
        };

        const bookings = yield* loadBookings();
        bookings[id] = storageItem;

        const cleaned = cleanupOldBookings(bookings);
        yield* saveBookings(cleaned);

        return id;
      }).pipe(Effect.withSpan("BookingStorage.save", { attributes: { id } })),

    get: (id) =>
      Effect.gen(function* () {
        const bookings = yield* loadBookings();
        const item = bookings[id];
        return item ? item.data : null;
      }).pipe(Effect.withSpan("BookingStorage.get", { attributes: { id } })),

    getAll: () =>
      Effect.gen(function* () {
        const bookings = yield* loadBookings();
        return Object.values(bookings).map((item) => item.data);
      }).pipe(Effect.withSpan("BookingStorage.getAll")),
  })
);
