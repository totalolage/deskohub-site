import { Context, Data, Effect, Layer } from "effect";
import { after } from "next/server";
import { WorkspaceEffect } from "@/shared/backend/workspace-effect";

interface IPostResponseTaskService {
  readonly run: (options: {
    readonly operation: string;
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
  static Live = Layer.succeed(this, {
    run: ({ operation, task }) =>
      Effect.try({
        try: () => {
          const runTask = WorkspaceEffect.task({ operation }, () =>
            task.pipe(
              Effect.catchCause((cause) =>
                Effect.logWarning("Post-response task failed", { cause })
              )
            )
          );
          after(runTask);
        },
        catch: (cause) => new PostResponseTaskSchedulingError({ cause }),
      }).pipe(
        Effect.tapError((cause) =>
          Effect.logWarning("Post-response task could not be scheduled", {
            cause,
          })
        ),
        Effect.ignore
      ),
  });
}
