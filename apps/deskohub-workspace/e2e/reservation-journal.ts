import { readFile } from "node:fs/promises";
import { writeJsonAtomically } from "./runtime";

export type ReservationIntent = {
  readonly id: string;
  readonly caseId: string;
  readonly runId: string;
  readonly owner: { readonly email: string } | { readonly customerId: string };
  readonly startDate: string;
  readonly endDate: string;
  readonly orderId?: string;
  readonly reservationId?: string;
};

// A journal has one worker owner. Serialize its fixture and intent writes too.
const pending = new Map<string, Promise<void>>();

export const writeReservationJournal = (
  path: string,
  value: object,
  intent?: ReservationIntent
): Promise<void> => {
  const previous = pending.get(path) ?? Promise.resolve();
  const write = previous.then(async () => {
    const existing = await readReservationJournal(path);
    const intents = existing?.reservationIntents ?? [];
    if (
      !Array.isArray(intents) ||
      !intents.every(
        (entry): entry is { readonly id: string } =>
          typeof entry === "object" &&
          entry !== null &&
          "id" in entry &&
          typeof entry.id === "string"
      )
    )
      throw new Error("Invalid reservation intents");
    await writeJsonAtomically(path, {
      ...existing,
      ...value,
      reservationIntents: intent
        ? [...intents.filter((entry) => entry.id !== intent.id), intent]
        : intents,
    });
  });
  pending.set(path, write);
  return write.finally(() => {
    if (pending.get(path) === write) pending.delete(path);
  });
};

export const readReservationJournal = async (
  path: string
): Promise<Record<string, unknown> | undefined> => {
  try {
    const value: unknown = JSON.parse(await readFile(path, "utf8"));
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new Error("Invalid reservation journal");
    }
    return value as Record<string, unknown>;
  } catch (cause) {
    if (cause instanceof Error && "code" in cause && cause.code === "ENOENT") {
      return undefined;
    }
    throw cause;
  }
};
