import { and, desc, eq } from "drizzle-orm";
import { Context, Data, Effect, Layer, Option, Schema } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { toStoredInstant } from "@/db/instant";
import { mobileUpdatePublications } from "@/db/schema";
import { currentInstant } from "@/shared/utils/temporal";
import {
  type MobileUpdatePlatform,
  MobileUpdatePublication,
} from "../mobile-update-publication";

/** A publication as installed apps receive it, with its server-side time. */
export interface PublishedMobileUpdate {
  readonly publication: MobileUpdatePublication;
  readonly publishedAt: Temporal.Instant;
}

type MobileUpdatePublishOutcome = "published" | "already-published";

/** Another publication already holds the id. */
class MobileUpdatePublicationConflict extends Data.TaggedError(
  "MobileUpdatePublicationConflict"
)<{ readonly id: string }> {}

class MobileUpdatePublicationsUnavailable extends Data.TaggedError(
  "MobileUpdatePublicationsUnavailable"
)<{ readonly cause: unknown }> {}

interface IMobileUpdatePublications {
  /**
   * Records a publication at the current time. Publishing the same
   * publication again is a no-op, so the release pipeline can retry.
   */
  readonly publish: (
    publication: MobileUpdatePublication
  ) => Effect.Effect<
    MobileUpdatePublishOutcome,
    MobileUpdatePublicationConflict | MobileUpdatePublicationsUnavailable
  >;
  /** The newest publication for the platform and runtime version. */
  readonly latest: (target: {
    readonly platform: MobileUpdatePlatform;
    readonly runtimeVersion: string;
  }) => Effect.Effect<
    Option.Option<PublishedMobileUpdate>,
    MobileUpdatePublicationsUnavailable
  >;
}

const decodePublication = Schema.decodeUnknownEffect(MobileUpdatePublication);
const isSamePublication = Schema.toEquivalence(MobileUpdatePublication);

export class MobileUpdatePublications extends Context.Service<
  MobileUpdatePublications,
  IMobileUpdatePublications
>()("@deskohub-workspace/mobile-updates/MobileUpdatePublications") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const { db } = yield* WorkspaceDatabase;

      const findPublication = (id: string) =>
        db
          .select({ publication: mobileUpdatePublications.publication })
          .from(mobileUpdatePublications)
          .where(eq(mobileUpdatePublications.id, id))
          .limit(1)
          .pipe(
            Effect.flatMap(([row]) =>
              row ? decodePublication(row.publication) : Effect.die(row)
            )
          );

      const publish = Effect.fn("MobileUpdatePublications.publish")(function* (
        publication: MobileUpdatePublication
      ) {
        const publishedAt = toStoredInstant(yield* currentInstant);
        const inserted = yield* db
          .insert(mobileUpdatePublications)
          .values({
            id: publication.id,
            platform: publication.platform,
            runtimeVersion: publication.runtimeVersion,
            publication,
            publishedAt,
          })
          .onConflictDoNothing()
          .returning({ id: mobileUpdatePublications.id })
          .pipe(
            Effect.mapError(
              (cause) => new MobileUpdatePublicationsUnavailable({ cause })
            )
          );
        if (inserted.length > 0) return "published" as const;

        const existing = yield* findPublication(publication.id).pipe(
          Effect.mapError(
            (cause) => new MobileUpdatePublicationsUnavailable({ cause })
          )
        );
        return isSamePublication(existing, publication)
          ? ("already-published" as const)
          : yield* new MobileUpdatePublicationConflict({ id: publication.id });
      });

      const latest = Effect.fn("MobileUpdatePublications.latest")(
        ({
          platform,
          runtimeVersion,
        }: {
          readonly platform: MobileUpdatePlatform;
          readonly runtimeVersion: string;
        }) =>
          db
            .select({
              publication: mobileUpdatePublications.publication,
              publishedAt: mobileUpdatePublications.publishedAt,
            })
            .from(mobileUpdatePublications)
            .where(
              and(
                eq(mobileUpdatePublications.platform, platform),
                eq(mobileUpdatePublications.runtimeVersion, runtimeVersion)
              )
            )
            .orderBy(desc(mobileUpdatePublications.publishedAt))
            .limit(1)
            .pipe(
              Effect.flatMap(([row]) =>
                row
                  ? decodePublication(row.publication).pipe(
                      Effect.map((publication) =>
                        Option.some({
                          publication,
                          publishedAt: row.publishedAt,
                        })
                      )
                    )
                  : Effect.succeedNone
              ),
              Effect.mapError(
                (cause) => new MobileUpdatePublicationsUnavailable({ cause })
              )
            )
      );

      return MobileUpdatePublications.of({ publish, latest });
    })
  );

  static Live = this.Default.pipe(Layer.provide(WorkspaceDatabase.Default));
}
