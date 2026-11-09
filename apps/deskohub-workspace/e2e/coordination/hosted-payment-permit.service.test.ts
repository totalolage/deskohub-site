import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import {
  chmod,
  mkdtemp,
  readFile,
  rm,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Deferred, Effect, Exit, Fiber } from "effect";
import {
  prepareWorkspaceE2EHostedPaymentPermitQueue,
  type WorkspaceE2EHostedPaymentPermitOptions,
  WorkspaceE2EHostedPaymentPermitService,
} from "./hosted-payment-permit.service";

let directory: string;
let permitDirectory: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "hosted-payment-permit-"));
  permitDirectory = join(directory, "permit");
  await prepareWorkspaceE2EHostedPaymentPermitQueue(permitDirectory);
});

afterEach(async () => {
  await rm(directory, { force: true, recursive: true });
});

const permitLayer = (
  options: Partial<WorkspaceE2EHostedPaymentPermitOptions> = {}
) =>
  WorkspaceE2EHostedPaymentPermitService.layer({
    directory: permitDirectory,
    generationCheckIntervalMs: 20,
    pollIntervalMs: 5,
    ...options,
  });

const runWithPermit = <A, E>(
  effect: Effect.Effect<A, E, WorkspaceE2EHostedPaymentPermitService>,
  options: Partial<WorkspaceE2EHostedPaymentPermitOptions> = {}
) => Effect.runPromise(effect.pipe(Effect.provide(permitLayer(options))));

type HolderEvent = {
  readonly at: number;
  readonly event: "end" | "start";
  readonly label: string;
};

const spawnHolder = (input: {
  readonly capacity: number;
  readonly crashWhileHolding?: boolean;
  readonly holdMs: number;
  readonly label: string;
  readonly sessions: number;
}) =>
  Bun.spawn(
    [
      process.execPath,
      join(import.meta.dir, "hosted-payment-permit.holder-fixture.ts"),
      JSON.stringify({
        ...input,
        directory: permitDirectory,
        logPath: join(directory, "holders.jsonl"),
      }),
    ],
    { stderr: "inherit", stdin: "ignore", stdout: "ignore" }
  );

const readHolderEvents = async (): Promise<HolderEvent[]> =>
  (await readFile(join(directory, "holders.jsonl"), "utf8").catch(() => ""))
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as HolderEvent);

const peakHolders = (events: readonly HolderEvent[]) => {
  let active = 0;
  let peak = 0;
  // A release recorded at the same instant as an admission happened first.
  for (const { event } of [...events].sort(
    (left, right) =>
      left.at - right.at ||
      (left.event === "end" ? 0 : 1) - (right.event === "end" ? 0 : 1)
  )) {
    active += event === "start" ? 1 : -1;
    peak = Math.max(peak, active);
  }
  return peak;
};

test("admits at most three hosted sessions across worker processes", async () => {
  const holders = Array.from({ length: 6 }, (_, index) =>
    spawnHolder({
      capacity: 3,
      holdMs: 120,
      label: `worker-${index}`,
      sessions: 2,
    })
  );
  const exitCodes = await Promise.all(holders.map((holder) => holder.exited));

  const events = await readHolderEvents();
  expect(exitCodes).toEqual([0, 0, 0, 0, 0, 0]);
  expect(events.filter(({ event }) => event === "end")).toHaveLength(12);
  expect(peakHolders(events)).toBe(3);
}, 30_000);

test("admits waiting sessions in arrival order", async () => {
  const admitted: string[] = [];

  await runWithPermit(
    Effect.gen(function* () {
      const permit = yield* WorkspaceE2EHostedPaymentPermitService;
      const firstHolding = yield* Deferred.make<void>();
      const releaseFirst = yield* Deferred.make<void>();
      const session = (label: string) =>
        permit.withPermit(
          label,
          Effect.sync(() => {
            admitted.push(label);
          })
        );
      const first = yield* Effect.forkChild(
        permit.withPermit(
          "first",
          Deferred.succeed(firstHolding, undefined).pipe(
            Effect.andThen(Deferred.await(releaseFirst))
          )
        )
      );
      yield* Deferred.await(firstHolding);
      const waiters = [];
      for (const label of ["second", "third", "fourth"]) {
        waiters.push(yield* Effect.forkChild(session(label)));
        // Each waiter takes its ticket before the next one arrives.
        yield* Effect.sleep("30 millis");
      }
      yield* Deferred.succeed(releaseFirst, undefined);
      yield* Fiber.join(first);
      for (const waiter of waiters) yield* Fiber.join(waiter);
    }),
    { capacity: 1 }
  );

  expect(admitted).toEqual(["second", "third", "fourth"]);
});

test("releases the slot when the hosted session fails", async () => {
  const result = await runWithPermit(
    Effect.gen(function* () {
      const permit = yield* WorkspaceE2EHostedPaymentPermitService;
      const failed = yield* Effect.exit(
        permit.withPermit(
          "failing",
          Effect.fail(new Error("Nexi rejected the card"))
        )
      );
      const next = yield* permit
        .withPermit("next", Effect.succeed("admitted"))
        .pipe(Effect.timeout("2 seconds"));
      return { failed, next };
    }),
    { capacity: 1 }
  );

  expect(Exit.isFailure(result.failed)).toBe(true);
  expect(result.next).toBe("admitted");
});

test("releases the slot when the case watchdog times out the session", async () => {
  const next = await runWithPermit(
    Effect.gen(function* () {
      const permit = yield* WorkspaceE2EHostedPaymentPermitService;
      yield* Effect.exit(
        permit
          .withPermit("stuck", Effect.never)
          .pipe(Effect.timeout("50 millis"))
      );
      return yield* permit
        .withPermit("next", Effect.succeed("admitted"))
        .pipe(Effect.timeout("2 seconds"));
    }),
    { capacity: 1 }
  );

  expect(next).toBe("admitted");
});

test("releases holding and waiting tickets on interruption", async () => {
  const next = await runWithPermit(
    Effect.gen(function* () {
      const permit = yield* WorkspaceE2EHostedPaymentPermitService;
      const holding = yield* Deferred.make<void>();
      const holder = yield* Effect.forkChild(
        permit.withPermit(
          "holder",
          Deferred.succeed(holding, undefined).pipe(
            Effect.andThen(Effect.never)
          )
        )
      );
      yield* Deferred.await(holding);
      const waiter = yield* Effect.forkChild(
        permit.withPermit("waiter", Effect.never)
      );
      yield* Effect.sleep("30 millis");
      yield* Fiber.interrupt(waiter);
      yield* Fiber.interrupt(holder);
      return yield* permit
        .withPermit("next", Effect.succeed("admitted"))
        .pipe(Effect.timeout("2 seconds"));
    }),
    { capacity: 1 }
  );

  expect(next).toBe("admitted");
});

test("reclaims the slot of a holder process that crashed", async () => {
  const crashed = spawnHolder({
    capacity: 1,
    crashWhileHolding: true,
    holdMs: 60_000,
    label: "crashed",
    sessions: 1,
  });
  expect(await crashed.exited).not.toBe(0);
  expect((await readHolderEvents()).map(({ event }) => event)).toEqual([
    "start",
  ]);

  const next = await runWithPermit(
    Effect.gen(function* () {
      const permit = yield* WorkspaceE2EHostedPaymentPermitService;
      return yield* permit
        .withPermit("next", Effect.succeed("admitted"))
        .pipe(Effect.timeout("2 seconds"));
    }),
    // The lease alone would block for a minute; process exit frees the slot.
    { capacity: 1, leaseMs: 60_000 }
  );

  expect(next).toBe("admitted");
}, 30_000);

test("ignores tickets this process leaked without a release", async () => {
  await writeFile(
    join(permitDirectory, "ticket-000000"),
    JSON.stringify({ pid: process.pid, token: "leaked" })
  );
  const now = new Date();
  await utimes(join(permitDirectory, "ticket-000000"), now, now);

  const next = await runWithPermit(
    Effect.gen(function* () {
      const permit = yield* WorkspaceE2EHostedPaymentPermitService;
      return yield* permit
        .withPermit("next", Effect.succeed("admitted"))
        .pipe(Effect.timeout("2 seconds"));
    }),
    { capacity: 1, leaseMs: 60_000 }
  );

  expect(next).toBe("admitted");
});

// Regressions: a ticket is reclaimed only when its holder process is gone,
// and a lost queue fails its waiters and holders instead of re-admitting.

const procfsAvailable = existsSync("/proc/self/stat");

const ticketFile = (number: number) =>
  join(permitDirectory, `ticket-${String(number).padStart(6, "0")}`);

// Ages a ticket as a forward clock jump, a missed heartbeat, or a long
// freeze would, so only time could make it look abandoned.
const ageTicket = (number: number) => {
  const longAgo = new Date(Date.now() - 10 * 60_000);
  return utimes(ticketFile(number), longAgo, longAgo);
};

const waitForHolderEvent = async (event: HolderEvent["event"]) => {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if ((await readHolderEvents()).some((entry) => entry.event === event))
      return;
    await Bun.sleep(5);
  }
  throw new Error(`holder never recorded ${event}`);
};

// Starts a single-slot session and resolves with the time it was admitted.
const startWaiter = () => {
  let admittedAt: number | undefined;
  const done = runWithPermit(
    Effect.gen(function* () {
      const permit = yield* WorkspaceE2EHostedPaymentPermitService;
      yield* permit.withPermit(
        "waiter",
        Effect.sync(() => {
          admittedAt = performance.timeOrigin + performance.now();
        })
      );
    }),
    { capacity: 1 }
  );
  return { admittedAt: () => admittedAt, done };
};

const holderEnd = async () =>
  (await readHolderEvents()).find(({ event }) => event === "end")?.at ?? 0;

test("keeps the slot of a frozen holder that resumes after any lease", async () => {
  const holder = spawnHolder({
    capacity: 1,
    holdMs: 200,
    label: "frozen",
    sessions: 1,
  });
  await waitForHolderEvent("start");
  process.kill(holder.pid, "SIGSTOP");
  try {
    await ageTicket(0);
    const waiter = startWaiter();
    await Bun.sleep(300);
    expect(waiter.admittedAt()).toBeUndefined();

    process.kill(holder.pid, "SIGCONT");
    expect(await holder.exited).toBe(0);
    await waiter.done;
    expect(waiter.admittedAt()).toBeGreaterThan(await holderEnd());
  } finally {
    if (holder.exitCode === null) process.kill(holder.pid, "SIGCONT");
  }
}, 30_000);

test("keeps exclusion across a forward clock change", async () => {
  let active = 0;
  let peak = 0;
  let started = 0;
  const session = (holdMs: number) =>
    runWithPermit(
      Effect.gen(function* () {
        const permit = yield* WorkspaceE2EHostedPaymentPermitService;
        yield* permit.withPermit(
          "session",
          Effect.gen(function* () {
            active += 1;
            started += 1;
            peak = Math.max(peak, active);
            yield* Effect.sleep(`${holdMs} millis`);
            active -= 1;
          })
        );
      }),
      { capacity: 3 }
    );
  const holders = [session(300), session(300), session(300)];
  while (started < 3) await Bun.sleep(5);
  await Promise.all([0, 1, 2].map(ageTicket));

  await session(20);
  await Promise.all(holders);

  expect(peak).toBe(3);
});

test("keeps the slot of a running holder whose ticket stops being refreshed", async () => {
  const holder = spawnHolder({
    capacity: 1,
    holdMs: 300,
    label: "unrefreshed",
    sessions: 1,
  });
  await waitForHolderEvent("start");
  let refreshing = true;
  // Keeps the ticket stale for the whole hold, as failing heartbeats would.
  const staleness = (async () => {
    while (refreshing) {
      await ageTicket(0).catch(() => undefined);
      await Bun.sleep(5);
    }
  })();
  const waiter = startWaiter();

  expect(await holder.exited).toBe(0);
  await waiter.done;
  refreshing = false;
  await staleness;
  expect(waiter.admittedAt()).toBeGreaterThan(await holderEnd());
}, 30_000);

test("fails waiting and holding sessions when the queue is deleted", async () => {
  let active = 0;
  let peak = 0;
  const result = await runWithPermit(
    Effect.gen(function* () {
      const permit = yield* WorkspaceE2EHostedPaymentPermitService;
      const session = (holdMs: number) =>
        Effect.exit(
          permit.withPermit(
            "session",
            Effect.sync(() => {
              active += 1;
              peak = Math.max(peak, active);
            }).pipe(
              Effect.andThen(Effect.sleep(`${holdMs} millis`)),
              Effect.ensuring(
                Effect.sync(() => {
                  active -= 1;
                })
              )
            )
          )
        );
      const holders = yield* Effect.forEach([0, 1, 2], () =>
        Effect.forkChild(session(600))
      );
      while (active < 3) yield* Effect.sleep("5 millis");
      yield* Effect.promise(() =>
        rm(permitDirectory, { force: true, recursive: true })
      );

      const late = yield* session(20);
      const holderExits = yield* Effect.forEach(holders, Fiber.join);
      return { holderExits, late };
    }),
    { capacity: 3 }
  );

  expect(peak).toBe(3);
  expect(Exit.isFailure(result.late)).toBe(true);
  for (const exit of result.holderExits) {
    expect(Exit.isFailure(exit)).toBe(true);
  }
});

test.skipIf(!procfsAvailable)(
  "reclaims a ticket whose PID now belongs to another process",
  async () => {
    // The parent process is alive, but it never took this ticket.
    await writeFile(
      ticketFile(0),
      JSON.stringify({ pid: process.ppid, startTime: "1", token: "recycled" })
    );

    const next = await runWithPermit(
      Effect.gen(function* () {
        const permit = yield* WorkspaceE2EHostedPaymentPermitService;
        return yield* permit
          .withPermit("next", Effect.succeed("admitted"))
          .pipe(Effect.timeout("2 seconds"));
      }),
      { capacity: 1 }
    );

    expect(next).toBe("admitted");
  }
);

test.skipIf(!procfsAvailable)(
  "keeps the ticket of a live holder whose start time matches",
  async () => {
    const stat = await readFile(`/proc/${process.ppid}/stat`, "utf8");
    const startTime = stat
      .slice(stat.lastIndexOf(")") + 2)
      .trim()
      .split(" ")[19];
    await writeFile(
      ticketFile(0),
      JSON.stringify({ pid: process.ppid, startTime, token: "live" })
    );

    const exit = await runWithPermit(
      Effect.gen(function* () {
        const permit = yield* WorkspaceE2EHostedPaymentPermitService;
        return yield* Effect.exit(
          permit
            .withPermit("next", Effect.void)
            .pipe(Effect.timeout("300 millis"))
        );
      }),
      { capacity: 1 }
    );

    expect(Exit.isFailure(exit)).toBe(true);
  }
);

test("fails the session when its release cannot be recorded", async () => {
  const exit = await runWithPermit(
    Effect.gen(function* () {
      const permit = yield* WorkspaceE2EHostedPaymentPermitService;
      return yield* Effect.exit(
        permit.withPermit(
          "unreleasable",
          Effect.promise(() => chmod(permitDirectory, 0o500))
        )
      );
    }),
    { capacity: 1 }
  ).finally(() => chmod(permitDirectory, 0o700));

  expect(Exit.isFailure(exit)).toBe(true);
});
