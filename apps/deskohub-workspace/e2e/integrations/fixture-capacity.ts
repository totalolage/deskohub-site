import {
  DotyposReservationSchema,
  DotyposRuntimeConfigSchema,
  DotyposTableSchema,
} from "@deskohub/dotypos";
import {
  PaginatedReservations,
  PaginatedTables,
  TokenResponse,
} from "@deskohub/dotypos/generated";
import { Context, Effect, Layer, Logger, Schema, Stream } from "effect";
import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
} from "effect/unstable/http";
import type { DatasourceConfig } from "../config";
import { type WorkspaceE2EError, workspaceE2EError } from "../errors";
import { fixtureCapacityWindows } from "../fixture-capacity";
import { workspaceE2ETimeouts } from "../timeouts";

export const fixtureCapacityReadLimits = Object.freeze({
  pages: 3,
  pageSize: 100,
  requests: 10,
  requestMilliseconds: workspaceE2ETimeouts.fixtureCapacityRequest,
  elapsedMilliseconds: workspaceE2ETimeouts.fixtureCapacityObservation,
  responseBytes: 1_048_576,
  totalBytes: 16_777_216,
});

const tablesPage = Schema.Struct({
  ...PaginatedTables.fields,
  data: Schema.Array(DotyposTableSchema),
});
const reservationsPage = Schema.Struct({
  ...PaginatedReservations.fields,
  data: Schema.Array(DotyposReservationSchema),
});
const transportOptions = {
  redirect: "error",
  credentials: "omit",
  proxy: null,
} as const;
const unknownCapacity = () =>
  workspaceE2EError("Synthetic fixture capacity observation is Unknown", {
    diagnosticCode: "dotypos_account_fixture_mutation_failed",
    operation: "observe synthetic fixture capacity",
  });
const requireKnown = (condition: unknown) => {
  if (!condition) throw unknownCapacity();
};

type PageMetadata = Omit<typeof tablesPage.Type, "data">;
const paginationInteger = (value: string | undefined) => {
  requireKnown(typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value));
  const parsed = Number(value);
  requireKnown(Number.isSafeInteger(parsed));
  return parsed;
};

const validatePage = (input: {
  readonly metadata: PageMetadata;
  readonly page: number;
  readonly length: number;
  readonly total: number | undefined;
}) => {
  const total = paginationInteger(input.metadata.totalItemsCount);
  const last = Math.max(
    1,
    Math.ceil(total / fixtureCapacityReadLimits.pageSize)
  );
  requireKnown(
    last <= fixtureCapacityReadLimits.pages &&
      (input.total === undefined || total === input.total)
  );
  requireKnown(
    paginationInteger(input.metadata.currentPage) === input.page &&
      paginationInteger(input.metadata.perPage) ===
        fixtureCapacityReadLimits.pageSize
  );
  requireKnown(
    paginationInteger(input.metadata.firstPage) === 1 &&
      paginationInteger(input.metadata.lastPage) === last &&
      input.page <= last
  );
  requireKnown(
    paginationInteger(input.metadata.totalItemsOnPage) === input.length
  );
  requireKnown(
    input.length ===
      (input.page < last
        ? fixtureCapacityReadLimits.pageSize
        : total - (last - 1) * fixtureCapacityReadLimits.pageSize)
  );
  requireKnown(
    input.metadata.prevPage ===
      (input.page === 1 ? null : String(input.page - 1))
  );
  requireKnown(
    input.metadata.nextPage ===
      (input.page === last ? null : String(input.page + 1))
  );
  return { total, last };
};

interface FixtureCapacityRead {
  readonly config: DatasourceConfig;
  readonly startMillis: number;
  readonly endMillis: number;
}

const readInventory = Effect.fn("E2E.FixtureCapacityReader.read")(
  function* (input: FixtureCapacityRead) {
    const http = yield* HttpClient.HttpClient;
    const config = yield* Effect.try({
      try: () =>
        Schema.decodeUnknownSync(DotyposRuntimeConfigSchema)({
          ...input.config.dotypos,
          reservationTableIds: [],
        }),
      catch: unknownCapacity,
    });
    yield* Effect.try({
      try: () => {
        requireKnown(
          config.apiUrl === "https://api.dotykacka.cz/v2" ||
            config.apiUrl === "https://api.dotykacka.cz/v2/"
        );
        requireKnown(
          /^[1-9][0-9]{0,9}$/.test(config.cloudId) &&
            Number(config.cloudId) <= 2147483647
        );
        requireKnown(
          Number.isSafeInteger(input.startMillis) &&
            Number.isSafeInteger(input.endMillis) &&
            input.endMillis > input.startMillis
        );
      },
      catch: unknownCapacity,
    });
    const base = config.apiUrl.replace(/\/$/, "");
    const counts = {
      requests: 0,
      tokenRequests: 0,
      tablePages: 0,
      reservationPages: 0,
      bytes: 0,
      traversals: 0,
    };
    const started = performance.now();
    const request = Effect.fn("E2E.fixtureCapacity.request")(
      function* (request: HttpClientRequest.HttpClientRequest) {
        if (counts.requests >= fixtureCapacityReadLimits.requests)
          return yield* unknownCapacity();
        counts.requests++;
        const response = yield* http.execute(request);
        let responseBytes = 0;
        const parts = yield* response.stream.pipe(
          Stream.runFoldEffect(
            (): Uint8Array[] => [],
            (parts, chunk) => {
              responseBytes += chunk.length;
              counts.bytes += chunk.length;
              if (
                responseBytes > fixtureCapacityReadLimits.responseBytes ||
                counts.bytes > fixtureCapacityReadLimits.totalBytes
              )
                return Effect.fail(unknownCapacity());
              parts.push(chunk);
              return Effect.succeed(parts);
            }
          )
        );
        const body = Buffer.concat(parts).toString("utf8");
        return { status: response.status, body };
      },
      Effect.timeout(fixtureCapacityReadLimits.requestMilliseconds),
      Effect.mapError(unknownCapacity)
    );

    counts.tokenRequests++;
    const tokenReply = yield* request(
      HttpClientRequest.post(`${base}/signin/token`).pipe(
        HttpClientRequest.setHeader(
          "authorization",
          `User ${config.refreshToken}`
        ),
        HttpClientRequest.bodyJsonUnsafe({ _cloudId: config.cloudId })
      )
    );
    const token = yield* Effect.try({
      try: () => {
        requireKnown(tokenReply.status >= 200 && tokenReply.status < 300);
        const token = Schema.decodeUnknownSync(TokenResponse)(
          JSON.parse(tokenReply.body)
        );
        requireKnown(/^[!-~]{1,65536}$/.test(token.accessToken));
        return token.accessToken;
      },
      catch: unknownCapacity,
    });

    const load = <A extends { readonly id: string; readonly _cloudId: string }>(
      resource: "tables" | "reservations",
      schema: Schema.Decoder<PageMetadata & { readonly data: readonly A[] }>,
      filter?: string
    ) =>
      Effect.gen(function* () {
        counts.traversals++;
        const records: A[] = [];
        const ids = new Set<string>();
        let total: number | undefined;
        for (let page = 1; page <= fixtureCapacityReadLimits.pages; page++) {
          if (resource === "tables") counts.tablePages++;
          else counts.reservationPages++;
          const reply = yield* request(
            HttpClientRequest.get(
              `${base}/clouds/${config.cloudId}/${resource}`
            ).pipe(
              HttpClientRequest.setHeader("authorization", `Bearer ${token}`),
              HttpClientRequest.setUrlParams({
                page: String(page),
                limit: String(fixtureCapacityReadLimits.pageSize),
                ...(filter ? { filter } : {}),
              })
            )
          );
          // Only a first reservation-page null 404, after a successful independent table/cloud read, proves emptiness.
          if (
            resource === "reservations" &&
            page === 1 &&
            reply.status === 404 &&
            (reply.body.trim() === "" || reply.body.trim() === "null")
          )
            return records;
          const decoded = yield* Effect.try({
            try: () => {
              requireKnown(reply.status >= 200 && reply.status < 300);
              const decoded = Schema.decodeUnknownSync(schema)(
                JSON.parse(reply.body)
              );
              const pagination = validatePage({
                metadata: decoded,
                page,
                length: decoded.data.length,
                total,
              });
              for (const record of decoded.data) {
                requireKnown(
                  record._cloudId === config.cloudId &&
                    record.id === record.id.trim() &&
                    record.id.length > 0 &&
                    !ids.has(record.id)
                );
                ids.add(record.id);
              }
              return { records: decoded.data, ...pagination };
            },
            catch: unknownCapacity,
          });
          records.push(...decoded.records);
          total = decoded.total;
          if (page === decoded.last) return records;
        }
        return yield* unknownCapacity();
      });
    const tables = yield* load("tables", tablesPage);
    if (tables.length === 0) return yield* unknownCapacity();
    const windows = fixtureCapacityWindows(input.startMillis, input.endMillis);
    const loadReservations = (window: {
      readonly startDate: Date;
      readonly endDate: Date;
    }) =>
      load(
        "reservations",
        reservationsPage,
        [
          "status|in|NEW,CONFIRMED",
          `startDate|lt|${window.endDate.getTime()}`,
          `endDate|gt|${window.startDate.getTime()}`,
        ].join(";")
      );
    const past = yield* loadReservations(windows.past);
    const future = yield* loadReservations(windows.future);
    return {
      tables,
      past,
      future,
      counts,
      elapsedMilliseconds: Math.ceil(performance.now() - started),
    };
  },
  Effect.timeout(fixtureCapacityReadLimits.elapsedMilliseconds),
  Effect.mapError(unknownCapacity),
  Effect.provide(Logger.layer([])),
  Effect.provideService(HttpClient.TracerDisabledWhen, () => true),
  Effect.provideService(FetchHttpClient.RequestInit, transportOptions)
);

interface IFixtureCapacityReader {
  readonly read: (
    input: FixtureCapacityRead
  ) => Effect.Effect<
    Effect.Success<ReturnType<typeof readInventory>>,
    WorkspaceE2EError
  >;
}

export class FixtureCapacityReader extends Context.Service<
  FixtureCapacityReader,
  IFixtureCapacityReader
>()("E2E.FixtureCapacityReader") {
  static Default = Layer.effect(
    this,
    Effect.map(HttpClient.HttpClient, (http) => ({
      read: (input: FixtureCapacityRead) =>
        readInventory(input).pipe(
          Effect.provideService(HttpClient.HttpClient, http)
        ),
    }))
  );
  static Live = this.Default.pipe(Layer.provide(FetchHttpClient.layer));
}
