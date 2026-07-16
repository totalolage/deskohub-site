import { Context, Effect, Layer } from "effect";
import { after } from "next/server";
import { runWorkspaceEffect } from "@/shared/backend/logging/censorship";

interface IPostResponseTaskService {
  readonly run: (
    task: Effect.Effect<void, never, never>
  ) => Effect.Effect<void>;
}

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
        catch: (cause) => cause,
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
