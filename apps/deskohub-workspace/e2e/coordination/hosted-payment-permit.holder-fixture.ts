// Child process for hosted-payment-permit.service.test.ts: holds the permit
// from a separate process the way a Playwright worker does.
import { appendFile } from "node:fs/promises";
import { Effect } from "effect";
import { WorkspaceE2EHostedPaymentPermitService } from "./hosted-payment-permit.service";

type HolderInput = {
  readonly capacity: number;
  readonly crashWhileHolding?: boolean;
  readonly directory: string;
  readonly holdMs: number;
  readonly label: string;
  readonly logPath: string;
  readonly sessions: number;
};

const input = JSON.parse(process.argv[2] ?? "{}") as HolderInput;

const record = (event: string) =>
  Effect.promise(() =>
    appendFile(
      input.logPath,
      `${JSON.stringify({ at: performance.timeOrigin + performance.now(), event, label: input.label })}\n`
    )
  );

await Effect.runPromise(
  Effect.gen(function* () {
    const permit = yield* WorkspaceE2EHostedPaymentPermitService;
    for (let session = 0; session < input.sessions; session += 1) {
      yield* permit.withPermit(
        `${input.label}-${session}`,
        Effect.gen(function* () {
          yield* record("start");
          if (input.crashWhileHolding) process.kill(process.pid, "SIGKILL");
          yield* Effect.sleep(`${input.holdMs} millis`);
          yield* record("end");
        })
      );
    }
  }).pipe(
    Effect.provide(
      WorkspaceE2EHostedPaymentPermitService.layer({
        capacity: input.capacity,
        directory: input.directory,
        pollIntervalMs: 10,
      })
    )
  )
);
