import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import {
  access,
  link,
  mkdir,
  readFile,
  unlink,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { Context, Effect, Layer, Schedule } from "effect";
import {
  toWorkspaceE2EError,
  type WorkspaceE2EError,
  workspaceE2EError,
} from "../errors";
import { log, workspaceDir } from "../runtime";
import { E2ERunContextService } from "../services/telemetry";

// Unbounded hosted sessions produced Nexi sandbox error pages; three per suite
// is the measured operating bound, not a provider guarantee.
const workspaceE2EHostedPaymentConcurrency = 3;

export interface WorkspaceE2EHostedPaymentPermit {
  /**
   * Runs one Nexi hosted-payment session, from payment submission through the
   * return or terminal state, while holding one of the run's hosted slots.
   */
  readonly withPermit: <A, E, R>(
    operation: string,
    effect: Effect.Effect<A, E, R>
  ) => Effect.Effect<A, E | WorkspaceE2EError, R>;
}

export type WorkspaceE2EHostedPaymentPermitOptions = {
  readonly capacity: number;
  readonly directory: string;
  readonly generationCheckIntervalMs: number;
  readonly pollIntervalMs: number;
};

const defaultOptions = {
  capacity: workspaceE2EHostedPaymentConcurrency,
  generationCheckIntervalMs: 1_000,
  pollIntervalMs: 250,
} as const;

/**
 * Playwright runs cases in separate worker processes, so the hosted-payment
 * bound is a FIFO ticket queue in the run's artifact directory: every
 * worker of one run shares it, and other runs never see it. Checkout setup
 * prepares the queue; the permit never recreates it.
 */
export class WorkspaceE2EHostedPaymentPermitService extends Context.Service<
  WorkspaceE2EHostedPaymentPermitService,
  WorkspaceE2EHostedPaymentPermit
>()("WorkspaceE2E/HostedPaymentPermitService") {
  static layer = (
    options: Partial<WorkspaceE2EHostedPaymentPermitOptions> &
      Pick<WorkspaceE2EHostedPaymentPermitOptions, "directory">
  ) =>
    Layer.effect(
      this,
      makeHostedPaymentPermit({ ...defaultOptions, ...options })
    );

  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const { value: runContext } = yield* E2ERunContextService;
      return yield* makeHostedPaymentPermit({
        ...defaultOptions,
        directory: workspaceE2EHostedPaymentPermitDirectory(runContext.runId),
      });
    })
  );
}

export const workspaceE2EHostedPaymentPermitDirectory = (runId: string) =>
  resolve(
    workspaceDir,
    "e2e-artifacts",
    "checkout",
    "hosted-payment-permit",
    createHash("sha256").update(runId).digest("hex").slice(0, 32)
  );

/**
 * Creates the run's queue and its generation marker once, before any case
 * starts. Preparing an existing queue keeps its generation.
 */
export const prepareWorkspaceE2EHostedPaymentPermitQueue = async (
  directory: string
) => {
  await mkdir(directory, { recursive: true });
  const draftPath = join(directory, `draft-${randomUUID()}`);
  await writeFile(draftPath, randomUUID(), { mode: 0o600 });
  try {
    await link(draftPath, generationPath(directory));
  } catch (cause) {
    if (errorCode(cause) !== "EEXIST") throw cause;
  } finally {
    await unlink(draftPath).catch(() => undefined);
  }
};

type Ticket = {
  readonly number: number;
  readonly token: string;
};

type TicketOwner = {
  readonly pid: number;
  // Process start time in clock ticks since boot, where procfs provides it.
  readonly startTime?: string;
  readonly token: string;
};

// Tokens of the tickets this process still owns. A ticket naming this process
// whose token is missing was leaked by an earlier holder, so it is inactive.
const processTicketTokens = new Set<string>();

const procfsAvailable = existsSync("/proc/self/stat");

function makeHostedPaymentPermit(
  options: WorkspaceE2EHostedPaymentPermitOptions
): Effect.Effect<WorkspaceE2EHostedPaymentPermit, WorkspaceE2EError> {
  const { directory } = options;
  // Released tickets and exited holders never become active again.
  const inactiveTickets = new Set<number>();
  const owners = new Map<number, TicketOwner>();

  const queueOperation = <A>(operation: string, try_: () => Promise<A>) =>
    Effect.tryPromise({
      catch: (cause) =>
        toWorkspaceE2EError(`${operation} hosted payment permit`, cause),
      try: try_,
    });

  return Effect.gen(function* () {
    const generation = yield* queueOperation("read the generation of the", () =>
      readGeneration(directory)
    );
    const ownStartTime = yield* queueOperation(
      "identify the holder of the",
      () => readProcessStartTime(process.pid)
    );

    // A deleted or replaced queue no longer records the run's holders, so
    // every waiter and holder of the old queue fails instead of re-admitting.
    const assertGeneration = queueOperation(
      "verify the queue of the",
      async () => {
        const current = await readGeneration(directory).catch(() => undefined);
        if (current !== generation) {
          throw workspaceE2EError(
            "Hosted payment permit queue was deleted or replaced during the run"
          );
        }
      }
    );

    const allocateTicket = assertGeneration.pipe(
      Effect.andThen(
        queueOperation(
          "allocate a ticket of the",
          async (): Promise<Ticket> => {
            const token = randomUUID();
            const draftPath = join(directory, `draft-${token}`);
            const owner: TicketOwner = {
              pid: process.pid,
              ...(ownStartTime ? { startTime: ownStartTime } : {}),
              token,
            };
            await writeFile(draftPath, JSON.stringify(owner), { mode: 0o600 });
            processTicketTokens.add(token);
            try {
              // Numbers are dense from zero and never reused: the hard link
              // publishes the complete owner record atomically and fails on an
              // existing number, so a ticket sorts after every earlier one.
              for (let number = 0; ; number += 1) {
                try {
                  await link(draftPath, ticketPath(directory, number));
                  return { number, token };
                } catch (cause) {
                  if (errorCode(cause) !== "EEXIST") throw cause;
                }
              }
            } catch (cause) {
              processTicketTokens.delete(token);
              throw cause;
            } finally {
              await unlink(draftPath).catch(() => undefined);
            }
          }
        )
      )
    );

    const isActive = (number: number) =>
      queueOperation("read a ticket of the", async () => {
        if (inactiveTickets.has(number)) return false;
        if (await exists(releasePath(directory, number))) {
          inactiveTickets.add(number);
          return false;
        }
        let owner = owners.get(number);
        if (!owner) {
          owner = JSON.parse(
            await readFile(ticketPath(directory, number), "utf8")
          ) as TicketOwner;
          owners.set(number, owner);
        }
        const active =
          owner.pid === process.pid
            ? processTicketTokens.has(owner.token)
            : await isHolderRunning(owner);
        if (!active) inactiveTickets.add(number);
        return active;
      });

    // Untraced: a waiter polls this every few hundred milliseconds.
    const isAdmitted = Effect.fnUntraced(function* (ticket: Ticket) {
      yield* assertGeneration;
      let active = 0;
      for (let number = 0; number < ticket.number; number += 1) {
        if (yield* isActive(number)) active += 1;
        if (active >= options.capacity) return false;
      }
      return true;
    });

    const releaseTicket = (ticket: Ticket) =>
      assertGeneration.pipe(
        Effect.andThen(
          queueOperation("release a ticket of the", () =>
            writeFile(releasePath(directory, ticket.number), "", {
              flag: "wx",
              mode: 0o600,
            }).catch((cause: unknown) => {
              if (errorCode(cause) !== "EEXIST") throw cause;
            })
          )
        ),
        // Forgetting the token makes the ticket inactive for this process even
        // when the release marker could not be written; the error still fails
        // the case, and other processes reclaim the ticket when it exits.
        Effect.ensuring(
          Effect.sync(() => {
            processTicketTokens.delete(ticket.token);
          })
        )
      );

    const generationLost = assertGeneration.pipe(
      Effect.repeat(
        Schedule.spaced(`${options.generationCheckIntervalMs} millis`)
      ),
      Effect.andThen(Effect.never)
    );

    const awaitAdmission = Effect.fnUntraced(function* (
      ticket: Ticket,
      operation: string
    ) {
      const waitStartedAt = Date.now();
      yield* isAdmitted(ticket).pipe(
        Effect.repeat({
          schedule: Schedule.spaced(`${options.pollIntervalMs} millis`),
          until: (admitted) => admitted,
        })
      );
      const waitedSeconds = (Date.now() - waitStartedAt) / 1_000;
      log(
        `HOSTED PAYMENT PERMIT ${operation} admitted after ${waitedSeconds.toFixed(1)}s (ticket ${ticket.number})`
      );
    });

    return {
      withPermit: (operation, effect) =>
        Effect.acquireUseRelease(
          allocateTicket,
          (ticket) =>
            awaitAdmission(ticket, operation).pipe(
              Effect.andThen(effect),
              Effect.raceFirst(generationLost)
            ),
          releaseTicket
        ),
    } satisfies WorkspaceE2EHostedPaymentPermit;
  });
}

// A ticket is reclaimed only once its holder process is gone. A live holder,
// even a frozen one, keeps its slot until the case watchdog or Playwright ends
// it, so time alone never admits a replacement.
const isHolderRunning = async (owner: TicketOwner) => {
  if (!procfsAvailable) return isProcessAlive(owner.pid);
  const startTime = await readProcessStartTime(owner.pid);
  // A different start time means the PID now belongs to another process.
  return startTime !== undefined && startTime === owner.startTime;
};

// Reads field 22 of /proc/<pid>/stat. Exited and zombie processes have none.
const readProcessStartTime = async (pid: number) => {
  if (!procfsAvailable) return undefined;
  let stat: string;
  try {
    stat = await readFile(`/proc/${pid}/stat`, "utf8");
  } catch (cause) {
    if (errorCode(cause) === "ENOENT") return undefined;
    throw cause;
  }
  // The command name may contain spaces, so fields count from its ")".
  const [state, ...fields] = stat
    .slice(stat.lastIndexOf(")") + 2)
    .trim()
    .split(" ");
  return state === "Z" || state === "X" ? undefined : fields[18];
};

const isProcessAlive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (cause) {
    // EPERM means the process exists under another user.
    return errorCode(cause) !== "ESRCH";
  }
};

const readGeneration = (directory: string) =>
  readFile(generationPath(directory), "utf8");

const generationPath = (directory: string) => join(directory, "generation");

const ticketPath = (directory: string, number: number) =>
  join(directory, `ticket-${String(number).padStart(6, "0")}`);

const releasePath = (directory: string, number: number) =>
  join(directory, `released-${String(number).padStart(6, "0")}`);

const exists = (path: string) =>
  access(path).then(
    () => true,
    (cause: unknown) => {
      if (errorCode(cause) === "ENOENT") return false;
      throw cause;
    }
  );

const errorCode = (cause: unknown) =>
  cause instanceof Error && "code" in cause ? cause.code : undefined;
