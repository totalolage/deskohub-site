import "server-only";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  BookingData,
  BookingStorageItem,
} from "@/features/booking/booking";

// File-based storage for bookings that persists across hot reloads
const globalForBookings = globalThis as unknown as {
  bookingStorageFile: string | undefined;
};

// Create or get the temporary storage file
const getStorageFile = async (): Promise<string> => {
  if (!globalForBookings.bookingStorageFile) {
    // Use Node.js tmpdir for cross-platform compatibility
    globalForBookings.bookingStorageFile = join(
      tmpdir(),
      `deskohub-bookings-${Date.now()}.json`
    );

    // Initialize empty storage if file doesn't exist
    try {
      await fs.access(globalForBookings.bookingStorageFile);
    } catch {
      await fs.writeFile(globalForBookings.bookingStorageFile, "{}");
    }
  }
  return globalForBookings.bookingStorageFile;
};

// Load bookings from file
const loadBookings = async (): Promise<Record<string, BookingStorageItem>> => {
  const file = await getStorageFile();
  try {
    const content = await fs.readFile(file, "utf8");
    return JSON.parse(content) as Record<string, BookingStorageItem>;
  } catch {
    return {};
  }
};

// Save bookings to file
const saveBookings = async (
  bookings: Record<string, BookingStorageItem>
): Promise<void> => {
  const file = await getStorageFile();
  await fs.writeFile(file, JSON.stringify(bookings, null, 2));
};

export const storeBooking = async (booking: BookingData): Promise<void> => {
  const storageItem: BookingStorageItem = {
    id: booking.id,
    data: booking,
    createdAt: new Date(),
  };

  const bookings = await loadBookings();
  bookings[booking.id] = storageItem;

  // Clean up old entries (older than 7 days) to prevent memory leaks
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  for (const [id, item] of Object.entries(bookings)) {
    if (new Date(item.createdAt) < sevenDaysAgo) {
      delete bookings[id];
    }
  }

  await saveBookings(bookings);
};

export const getBooking = async (id: string): Promise<BookingData | null> => {
  const bookings = await loadBookings();
  const item = bookings[id];
  return item ? item.data : null;
};

export const getAllBookings = async (): Promise<BookingData[]> => {
  const bookings = await loadBookings();
  return Object.values(bookings).map((item) => item.data);
};
