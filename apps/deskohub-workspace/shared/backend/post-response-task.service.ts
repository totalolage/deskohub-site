import { Context, Data, Effect, Layer } from "effect";
import { after } from "next/server";
import { runWorkspaceEffect } from "@/shared/backend/logging/censorship";

interface IPostResponseTaskService {
  readonly run: (
    task: Effect.Effect<void, never, never>
  ) => Effect.Effect<void>;
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
    run: (task) =>
      Effect.try({
        try: () => {
          after(() => runWorkspaceEffect(task));
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
