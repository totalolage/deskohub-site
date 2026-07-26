import { Context, Data, Effect, Layer } from "effect";
import { after } from "next/server";
import { defineWorkspaceTask } from "@/shared/backend/workspace-effect";
import {
  isWorkspaceOperation,
  resolveWorkspaceOperation,
  type WorkspaceOperation,
} from "@/shared/backend/workspace-operation";

interface IPostResponseTaskService {
  readonly run: (options: {
    readonly operation: WorkspaceOperation;
    readonly task: Effect.Effect<void, never, never>;
  }) => Effect.Effect<void>;
}

class PostResponseTaskSchedulingError extends Data.TaggedError(
  "PostResponseTaskSchedulingError"
)<{
  readonly cause: unknown;
}> {}

export class PostResponseTaskService extends Context.Service<
  PostResponseTaskService,
  IPostResponseTaskService
>()("PostResponseTaskService") {
  static Live = Layer.effect(
    this,
    Effect.succeed({
      run: ({ operation, task }) =>
        resolveWorkspaceOperation(operation).pipe(
          Effect.flatMap((validOperation) =>
            Effect.try({
              try: () => {
                const runTask = defineWorkspaceTask(validOperation, () =>
                  task.pipe(
                    Effect.catchCause((cause) =>
                      Effect.logWarning("Post-response task failed", { cause })
                    )
                  )
                );
                after(runTask);
              },
              catch: (cause) => new PostResponseTaskSchedulingError({ cause }),
            })
          ),
          Effect.tapError((cause) =>
            Effect.logWarning("Post-response task could not be scheduled", {
              cause,
            }).pipe(
              Effect.annotateLogs({
                operation: isWorkspaceOperation(operation)
                  ? operation
                  : "operation",
              })
            )
          ),
          Effect.ignore
        ),
    })
  );
}
