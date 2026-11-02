import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type ReservationIntent,
  readReservationJournal,
  writeReservationJournal,
} from "./reservation-journal";
import { workspaceE2ERunIdSchema } from "./run-identifiers";
import { parseReservationIntents } from "./soak-ownership";

const intent = (id: string): ReservationIntent => ({
  id,
  caseId: "account-reservation-transitions",
  runId: "12345-1",
  owner: { customerId: "synthetic-owner" },
  startDate: "2027-05-01T08:00:00Z",
  endDate: "2027-05-01T10:00:00Z",
});

test("each account-pair intent survives fixture/finalizer rewrites and serializes concurrent writes privately", async () => {
  const directory = await mkdtemp(join(tmpdir(), "reservation-intent-"));
  const path = join(directory, "account-lane.json");
  try {
    await writeReservationJournal(path, {
      completed: false,
      laneId: "account-lane",
    });
    await Promise.all([
      writeReservationJournal(path, {}, intent("first")),
      writeReservationJournal(path, {}, intent("second")),
    ]);
    await writeReservationJournal(
      path,
      {},
      { ...intent("first"), reservationId: "returned-first" }
    );
    await writeReservationJournal(path, {
      completed: true,
      laneId: "account-lane",
    });
    const value = await readReservationJournal(path);
    const intents = parseReservationIntents(
      value?.reservationIntents,
      { runId: workspaceE2ERunIdSchema.make("12345-1") },
      ["account-reservation-transitions"]
    );
    expect(intents).toHaveLength(2);
    expect(intents.find(({ id }) => id === "first")?.reservationId).toBe(
      "returned-first"
    );
    expect(value?.completed).toBe(true);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(await readFile(path, "utf8")).not.toContain("undefined");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("unknown owner/case/run/interval and missing pre-create coverage are rejected", () => {
  const parse = (value: unknown) =>
    parseReservationIntents(
      value,
      { runId: workspaceE2ERunIdSchema.make("12345-1") },
      ["account-reservation-transitions"]
    );
  for (const value of [
    undefined,
    null,
    [{ ...intent("x"), owner: {} }],
    [{ ...intent("x"), caseId: "unregistered" }],
    [{ ...intent("x"), runId: "other" }],
    [{ ...intent("x"), endDate: "invalid" }],
  ]) {
    expect(() => parse(value)).toThrow();
  }
  expect(parse([intent("valid")])).toHaveLength(1);
});

test("malformed persisted intent identities cannot be overwritten", async () => {
  const directory = await mkdtemp(join(tmpdir(), "reservation-intent-"));
  const path = join(directory, "account-lane.json");
  try {
    for (const entry of [null, "unknown", {}, { id: 1 }]) {
      const contents = JSON.stringify({ reservationIntents: [entry] });
      await writeFile(path, contents, { mode: 0o600 });
      const failure = await writeReservationJournal(
        path,
        {},
        intent("next")
      ).then(
        () => undefined,
        (cause: unknown) => cause
      );
      expect(failure).toBeInstanceOf(Error);
      expect(await readFile(path, "utf8")).toBe(contents);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
