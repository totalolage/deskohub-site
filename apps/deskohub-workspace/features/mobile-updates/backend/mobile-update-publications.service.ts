import { and, desc, eq, max, sql } from "drizzle-orm";
import { Context, Data, Effect, Layer, Option, Schedule, Schema } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { mobileUpdatePublications as publications } from "@/db/schema";
import {
  findViolatedConstraint,
  isDatabaseQueryError,
} from "@/db/sql-constraint";
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

interface PublicationTarget {
  readonly platform: MobileUpdatePlatform;
  readonly runtimeVersion: string;
}

/** Another publication already holds the id. */
class MobileUpdatePublicationConflict extends Data.TaggedError(
  "MobileUpdatePublicationConflict"
)<{ readonly id: string }> {}

class MobileUpdatePublicationsUnavailable extends Data.TaggedError(
  "MobileUpdatePublicationsUnavailable"
)<{ readonly cause: unknown }> {}

interface IMobileUpdatePublications {
  /**
   * Records a publication strictly after every earlier one for its platform
   * and runtime version, at millisecond precision: apps take an update only
   * when it is newer than the one they run. Publishing the same publication
   * again is a no-op, so the release pipeline can retry.
   */
  readonly publish: (
    publication: MobileUpdatePublication
  ) => Effect.Effect<
    MobileUpdatePublishOutcome,
    MobileUpdatePublicationConflict | MobileUpdatePublicationsUnavailable
  >;
  /** The newest publication for the platform and runtime version. */
  readonly latest: (
    target: PublicationTarget
  ) => Effect.Effect<
    Option.Option<PublishedMobileUpdate>,
    MobileUpdatePublicationsUnavailable
  >;
}

const decodePublication = Schema.decodeUnknownEffect(MobileUpdatePublication);
const isSamePublication = Schema.toEquivalence(MobileUpdatePublication);

/** Concurrent publications that picked the same instant; one retries. */
const isPublicationTimeTaken = <E>(error: E) =>
  isDatabaseQueryError(error) &&
  Option.contains(
    findViolatedConstraint(error),
    "mobile_update_publications_published_at_key"
  );

const unavailable = (cause: unknown) =>
  new MobileUpdatePublicationsUnavailable({ cause });

const targetIs = ({ platform, runtimeVersion }: PublicationTarget) =>
  and(
    eq(publications.platform, platform),
    eq(publications.runtimeVersion, runtimeVersion)
  );

const currentMillisecond = currentInstant.pipe(
  Effect.map((now) =>
    now.round({ smallestUnit: "millisecond", roundingMode: "trunc" })
  )
);

export class MobileUpdatePublications extends Context.Service<
  MobileUpdatePublications,
  IMobileUpdatePublications
>()("@deskohub-workspace/mobile-updates/MobileUpdatePublications") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const { db } = yield* WorkspaceDatabase;

      /**
       * Inserts at the current millisecond, or one millisecond after the
       * target's newest publication when that is not earlier. `false` when
       * the id is already taken.
       */
      const insert = (publication: MobileUpdatePublication) =>
        Effect.succeed(publication).pipe(
          Effect.bindTo("publication"),
          Effect.bind("now", () => currentMillisecond),
          Effect.flatMap(({ now }) =>
            db
              .insert(publications)
              .values({
                id: publication.id,
                platform: publication.platform,
                runtimeVersion: publication.runtimeVersion,
                publication,
                publishedAt: sql`greatest(${now.toString()}::timestamptz, (${db
                  .select({
                    next: sql`${max(publications.publishedAt)} + interval '1 millisecond'`,
                  })
                  .from(publications)
                  .where(targetIs(publication))}))`,
              })
              .onConflictDoNothing({ target: publications.id })
              .returning({ id: publications.id })
          ),
          Effect.retry({
            while: isPublicationTimeTaken,
            schedule: Schedule.recurs(10),
          }),
          Effect.map((inserted) => inserted.length > 0)
        );

      const stored = (id: string) =>
        db
          .select({ publication: publications.publication })
          .from(publications)
          .where(eq(publications.id, id))
          .limit(1)
          .pipe(Effect.flatMap(([row]) => decodePublication(row?.publication)));

      /** The outcome of a publication whose id was already taken. */
      const republished = (publication: MobileUpdatePublication) =>
        stored(publication.id).pipe(
          Effect.mapError(unavailable),
          Effect.filterOrFail(
            (existing) => isSamePublication(existing, publication),
            () => new MobileUpdatePublicationConflict({ id: publication.id })
          ),
          Effect.as<MobileUpdatePublishOutcome>("already-published")
        );

      const publish = Effect.fn("MobileUpdatePublications.publish")(
        (publication: MobileUpdatePublication) =>
          insert(publication).pipe(
            Effect.mapError(unavailable),
            Effect.flatMap((inserted) =>
              inserted
                ? Effect.succeed<MobileUpdatePublishOutcome>("published")
                : republished(publication)
            )
          )
      );

      const latest = Effect.fn("MobileUpdatePublications.latest")(
        (target: PublicationTarget) =>
          db
            .select({
              publication: publications.publication,
              publishedAt: publications.publishedAt,
            })
            .from(publications)
            .where(targetIs(target))
            .orderBy(desc(publications.publishedAt))
            .limit(1)
            .pipe(
              Effect.flatMap(([row]) =>
                Option.match(Option.fromNullishOr(row), {
                  onNone: () => Effect.succeedNone,
                  onSome: (found) =>
                    decodePublication(found.publication).pipe(
                      Effect.map((publication) =>
                        Option.some<PublishedMobileUpdate>({
                          publication,
                          publishedAt: found.publishedAt,
                        })
                      )
                    ),
                })
              ),
              Effect.mapError(unavailable)
            )
      );

      return MobileUpdatePublications.of({ publish, latest });
    })
  );

  static Live = this.Default.pipe(Layer.provide(WorkspaceDatabase.Default));
}
