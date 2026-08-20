import { Context, Data, Effect, Exit, Layer, Schedule } from "effect";
import type { AllocationOwner } from "./allocation";
import { AllocationRepository } from "./allocation.repository";
import { GithubRunStatusService } from "./github-run-status.service";

export class AllocationError extends Data.TaggedError("AllocationError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

interface AcquireInput {
  readonly owner: AllocationOwner;
  readonly preferredShard: number;
  readonly waitSeconds: number;
}

interface IAllocationService {
  readonly acquire: (
    input: AcquireInput
  ) => Effect.Effect<number, AllocationError>;
  readonly release: (
    owner: AllocationOwner
  ) => Effect.Effect<void, AllocationError>;
}

export class AllocationService extends Context.Service<
  AllocationService,
  IAllocationService
>()("WorkspaceE2E/AllocationService") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const repository = yield* AllocationRepository;
      const runStatus = yield* GithubRunStatusService;

      const terminalOwners = Effect.fn("AllocationService.terminalOwners")(
        function* () {
          const owners = yield* repository.listOwners;
          const terminal = yield* Effect.all(
            owners.map((owner) =>
              runStatus
                .isTerminal(owner)
                .pipe(Effect.map((isTerminal) => ({ isTerminal, owner })))
            ),
            { concurrency: "inherit" }
          );
          return terminal.flatMap(({ isTerminal, owner }) =>
            isTerminal ? [owner] : []
          );
        }
      );

      const release = Effect.fn("AllocationService.release")(
        function* (owner: AllocationOwner) {
          const completed = yield* terminalOwners();
          yield* repository.release({ owner, terminalOwners: completed });
        },
        Effect.mapError(
          (cause) =>
            new AllocationError({
              cause,
              message: "Workspace E2E allocation release failed.",
            })
        )
      );

      const acquire = Effect.fn("AllocationService.acquire")(
        function* (input: AcquireInput) {
          const attempt = Effect.Do.pipe(
            Effect.bind("terminalOwners", terminalOwners),
            Effect.bind("shard", ({ terminalOwners: completed }) =>
              repository.acquire({
                owner: input.owner,
                preferredShard: input.preferredShard,
                terminalOwners: completed,
              })
            ),
            Effect.map(({ shard }) => shard)
          );
          const shard = yield* attempt.pipe(
            Effect.repeat({
              schedule: Schedule.spaced("10 seconds"),
              until: (value): value is number => value !== undefined,
            }),
            Effect.timeoutOrElse({
              duration: `${input.waitSeconds} seconds`,
              orElse: () =>
                Effect.fail(
                  new AllocationError({
                    message:
                      "Workspace E2E allocation exhausted: all 3 shards remained leased for supported concurrency 3.",
                  })
                ),
            })
          );
          return shard;
        },
        Effect.mapError((cause) =>
          cause instanceof AllocationError
            ? cause
            : new AllocationError({
                cause,
                message: "Workspace E2E allocation acquisition failed.",
              })
        )
      );

      return { acquire, release } satisfies IAllocationService;
    })
  );
}

export const releaseAllocationOnFailure = <A, E, R, E2, R2>(
  operation: Effect.Effect<A, E, R>,
  release: Effect.Effect<void, E2, R2>
) =>
  operation.pipe(
    Effect.onExit((exit) => (Exit.isSuccess(exit) ? Effect.void : release))
  );
