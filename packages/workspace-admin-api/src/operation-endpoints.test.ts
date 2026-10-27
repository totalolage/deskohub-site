import { afterAll, describe, expect, expectTypeOf, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { Context, Effect, Layer, Option, Schema } from "effect";
import {
  HttpClient,
  HttpClientRequest,
  HttpClientResponse,
  HttpRouter,
  HttpServer,
} from "effect/unstable/http";
import {
  HttpApi,
  HttpApiBuilder,
  HttpApiClient,
  type HttpApiEndpoint,
  type HttpApiGroup,
} from "effect/unstable/httpapi";
import {
  administrationOperations,
  destructiveOperation,
  readOperation,
  writeOperation,
} from "./administration-operation";
import {
  defineOperations,
  mutation,
  NoInput,
  type OperationInput,
  type OperationOutput,
  query,
} from "./campaign-operations";
import { DhwVersion, MinimumDhwVersion } from "./dhw-version";
import {
  type OperationRequest,
  operationGroup,
  operationGroupHandlers,
  operationRequest,
  route,
} from "./operation-endpoints";
import {
  AdministrationAccountId,
  AdministrationActionRecord,
  AdministrationAuthentication,
  CliClientCompatibility,
  CliInputInvalid,
  CliMutationRequestId,
  CliSessionId,
  CurrentAdministrationCaller,
} from "./workspace-admin-api";

const strictParseOptions = {
  parseOptions: { errors: "all", onExcessProperty: "error" },
} as const;

const NoteId = Schema.NonEmptyString;
const NoteRef = Schema.Struct({ noteId: NoteId }).annotate(strictParseOptions);
/** Each operation answers with the input it received, as JSON. */
const ReceivedInput = Schema.String;

const noteOperations = defineOperations({
  listNotes: query({ input: NoInput, output: ReceivedInput }),
  getNote: query({ input: NoteRef, output: ReceivedInput }),
  searchNotes: query({
    input: Schema.Struct({
      folderId: NoteId,
      text: Schema.optionalKey(Schema.String),
    }).annotate(strictParseOptions),
    output: ReceivedInput,
  }),
  createNote: mutation({
    input: Schema.Struct({
      requestId: CliMutationRequestId,
      text: Schema.String,
    }).annotate(strictParseOptions),
    output: ReceivedInput,
    ledger: true,
  }),
  editNote: mutation({
    input: Schema.Struct({ noteId: NoteId, text: Schema.String }).annotate(
      strictParseOptions
    ),
    output: ReceivedInput,
  }),
  archiveNote: mutation({ input: NoteRef, output: ReceivedInput }),
  renameNote: mutation({
    input: Schema.Struct({
      noteId: NoteId,
      title: Schema.optionalKey(Schema.String),
    }).annotate(strictParseOptions),
    output: ReceivedInput,
  }),
  previewNote: query({
    input: Schema.Struct({
      noteId: NoteId,
      draft: Schema.Union([
        Schema.Struct({ text: Schema.String }),
        Schema.Struct({ copyOf: NoteId }),
      ]),
    }).annotate(strictParseOptions),
    output: ReceivedInput,
  }),
});
type NoteOperations = typeof noteOperations;

const Notes = operationGroup(
  "notes",
  noteOperations,
  {
    listNotes: route.get("/notes"),
    getNote: route.get("/notes/:noteId"),
    searchNotes: route.get("/folders/:folderId/notes", { query: true }),
    createNote: route.post("/notes", {
      behavior: writeOperation({ idempotent: true }),
    }),
    editNote: route.patch("/notes/:noteId", {
      behavior: writeOperation({ idempotent: false }),
    }),
    archiveNote: route.post("/notes/:noteId/archive", {
      behavior: destructiveOperation({ idempotent: true }),
    }),
    renameNote: route.patch("/notes/:noteId/title", {
      behavior: writeOperation({ idempotent: true }),
    }),
    previewNote: route.post("/notes/:noteId/preview", { body: "draft" }),
  },
  { errors: [CliInputInvalid.schema] }
);

const inputs = {
  listNotes: {},
  getNote: { noteId: "note-1" },
  searchNotes: { folderId: "folder-1", text: "tea" },
  createNote: {
    requestId: "01990000-0000-7000-8000-000000000001",
    text: "Tea",
  },
  editNote: { noteId: "note-1", text: "Coffee" },
  archiveNote: { noteId: "note-1" },
  renameNote: { noteId: "note-1", title: "Tea notes" },
  previewNote: { noteId: "note-1", draft: { copyOf: "note-2" } },
} satisfies {
  readonly [Name in keyof NoteOperations]: OperationInput<NoteOperations[Name]>;
};
const names = Object.keys(inputs) as Array<keyof NoteOperations>;

const api = HttpApi.make("notesApi").add(Notes);

const echoInput = <Name extends keyof NoteOperations>(
  _name: Name,
  input: OperationInput<NoteOperations[Name]>
) =>
  Effect.succeed(
    JSON.stringify(input) as OperationOutput<NoteOperations[Name]>
  );

const server = HttpRouter.toWebHandler(
  HttpApiBuilder.layer(api).pipe(
    Layer.provide(
      operationGroupHandlers(api, Notes, Effect.succeed(echoInput), {
        listNotes: (received: string) => Effect.succeed(`adapted ${received}`),
      })
    ),
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(AdministrationAuthentication, {
          bearer: (httpEffect) =>
            Effect.provideService(httpEffect, CurrentAdministrationCaller, {
              actor: {
                accountId: AdministrationAccountId.make("account-1"),
                email: testEmailAddress("notes-administrator"),
              },
              channel: {
                _tag: "CliSession",
                sessionId: CliSessionId.make(
                  "01980000-0000-7000-8000-000000000000"
                ),
              },
            }),
        }),
        Layer.succeed(AdministrationActionRecord, (httpEffect) => httpEffect),
        Layer.succeed(CliClientCompatibility, (httpEffect) => httpEffect)
      )
    ),
    Layer.provide(HttpServer.layerServices)
  ),
  { disableLogger: true }
);
afterAll(() => server.dispose());

const notesClient = HttpApiClient.make(api, {
  baseUrl: "https://workspace.deskohub.test",
}).pipe(
  Effect.map(({ notes }) => notes),
  Effect.provideService(
    HttpClient.HttpClient,
    HttpClient.make((request) =>
      HttpClientRequest.toWeb(request).pipe(
        Effect.flatMap((webRequest) =>
          Effect.promise(() => server.handler(webRequest))
        ),
        Effect.map((response) => HttpClientResponse.fromWeb(request, response)),
        Effect.orDie
      )
    )
  )
);

/** What the client sends for `name`'s input, and what the operation receives. */
const call = <Name extends keyof NoteOperations>(
  name: Name,
  input: OperationInput<NoteOperations[Name]> = inputs[name]
) =>
  notesClient.pipe(
    Effect.flatMap((client) =>
      // Each name's method takes that operation's request parts.
      (
        client[name] as unknown as (
          request: OperationRequest
        ) => Effect.Effect<string, unknown>
      )(operationRequest(Notes, name, input))
    ),
    Effect.runPromise
  );

describe("operation endpoints", () => {
  test("a client carries each input in the request parts its route names", () => {
    expect(
      Object.fromEntries(
        names.map((name) => [name, operationRequest(Notes, name, inputs[name])])
      )
    ).toEqual({
      listNotes: {},
      getNote: { params: { noteId: "note-1" } },
      searchNotes: { params: { folderId: "folder-1" }, query: { text: "tea" } },
      createNote: { payload: inputs.createNote },
      editNote: { params: { noteId: "note-1" }, payload: { text: "Coffee" } },
      archiveNote: { params: { noteId: "note-1" } },
      renameNote: {
        params: { noteId: "note-1" },
        payload: { title: "Tea notes" },
      },
      previewNote: {
        params: { noteId: "note-1" },
        payload: { copyOf: "note-2" },
      },
    });
  });

  test("each endpoint's request and success types are the operation's", () => {
    type Endpoint<Name extends string> = HttpApiEndpoint.WithName<
      HttpApiGroup.Endpoints<typeof Notes>,
      Name
    >;
    type Parts<Name extends string> = {
      readonly params: Endpoint<Name>["~Params"]["Type"];
      readonly query: Endpoint<Name>["~Query"]["Type"];
      readonly payload: Endpoint<Name>["~Payload"]["Type"];
      readonly success: Endpoint<Name>["~Success"]["Type"];
    };

    expectTypeOf<Parts<"listNotes">>().toEqualTypeOf<{
      readonly params: never;
      readonly query: never;
      readonly payload: never;
      readonly success: string;
    }>();
    expectTypeOf<Parts<"searchNotes">>().toEqualTypeOf<{
      readonly params: { readonly folderId: string };
      readonly query: { readonly text?: string };
      readonly payload: never;
      readonly success: string;
    }>();
    expectTypeOf<Parts<"createNote">>().toEqualTypeOf<{
      readonly params: never;
      readonly query: never;
      readonly payload: {
        readonly requestId: CliMutationRequestId;
        readonly text: string;
      };
      readonly success: string;
    }>();
    expectTypeOf<Parts<"editNote">>().toEqualTypeOf<{
      readonly params: { readonly noteId: string };
      readonly query: never;
      readonly payload: { readonly text: string };
      readonly success: string;
    }>();
    expectTypeOf<Parts<"archiveNote">>().toEqualTypeOf<{
      readonly params: { readonly noteId: string };
      readonly query: never;
      readonly payload: never;
      readonly success: string;
    }>();
    expectTypeOf<Parts<"previewNote">>().toEqualTypeOf<{
      readonly params: { readonly noteId: string };
      readonly query: never;
      readonly payload: { readonly text: string } | { readonly copyOf: string };
      readonly success: string;
    }>();
  });

  test.each(names.filter((name) => name !== "listNotes"))(
    "%s runs its operation on the input its request carries",
    async (name) => {
      expect(JSON.parse(await call(name))).toEqual(inputs[name]);
    }
  );

  test("a query or body whose fields are all optional is sent empty", async () => {
    const withoutText = { folderId: "folder-1" };
    const withoutTitle = { noteId: "note-1" };

    expect(operationRequest(Notes, "searchNotes", withoutText)).toEqual({
      params: withoutText,
      query: {},
    });
    expect(operationRequest(Notes, "renameNote", withoutTitle)).toEqual({
      params: withoutTitle,
      payload: {},
    });
    expect(JSON.parse(await call("searchNotes", withoutText))).toEqual(
      withoutText
    );
    expect(JSON.parse(await call("renameNote", withoutTitle))).toEqual(
      withoutTitle
    );
  });

  test("an output adapter answers in place of the operation's output", async () => {
    expect(await call("listNotes")).toBe("adapted {}");
  });

  test("a query is a read, and a mutation behaves as its route states", () => {
    expect(
      Object.fromEntries(
        administrationOperations(api).map(({ endpoint, access }) => [
          endpoint,
          access,
        ])
      )
    ).toEqual({
      listNotes: { _tag: "Operation", behavior: readOperation },
      getNote: { _tag: "Operation", behavior: readOperation },
      searchNotes: { _tag: "Operation", behavior: readOperation },
      createNote: {
        _tag: "Operation",
        behavior: { kind: "write", idempotent: true },
      },
      editNote: {
        _tag: "Operation",
        behavior: { kind: "write", idempotent: false },
      },
      archiveNote: {
        _tag: "Operation",
        behavior: { kind: "destructive", idempotent: true },
      },
      renameNote: {
        _tag: "Operation",
        behavior: { kind: "write", idempotent: true },
      },
      previewNote: { _tag: "Operation", behavior: readOperation },
    });
  });

  test("an endpoint requires its operation's minimum dhw", () => {
    const versioned = defineOperations({
      getNote: query({
        input: NoteRef,
        output: ReceivedInput,
        minimumDhwVersion: DhwVersion.make("1.2.3"),
      }),
    });
    const group = operationGroup(
      "versioned",
      versioned,
      { getNote: route.get("/notes/:noteId") },
      { errors: [] }
    );
    const minimums: Array<unknown> = [];
    HttpApi.reflect(HttpApi.make("versionedApi").add(group), {
      onGroup: () => undefined,
      onEndpoint: ({ mergedAnnotations }) => {
        minimums.push(Context.get(mergedAnnotations, MinimumDhwVersion));
      },
    });

    expect(minimums).toEqual([Option.some("1.2.3")]);
  });

  test("a route that can't serve its operation fails the typecheck", () => {
    const refused = () => [
      operationGroup(
        "refused",
        noteOperations,
        {
          // @ts-expect-error a query is a read and declares no behavior
          listNotes: route.get("/notes", { behavior: readOperation }),
          // @ts-expect-error noteId is input beyond the path with no place
          getNote: route.get("/notes"),
          // @ts-expect-error :folder is no input field
          searchNotes: route.get("/folders/:folder/notes", { query: true }),
          // @ts-expect-error a replayed mutation is idempotent
          createNote: route.post("/notes", {
            behavior: writeOperation({ idempotent: false }),
          }),
          // @ts-expect-error a mutation declares its behavior
          editNote: route.patch("/notes/:noteId"),
          archiveNote: route.post("/notes/:noteId/archive", {
            behavior: destructiveOperation({ idempotent: true }),
          }),
          renameNote: route.patch("/notes/:noteId/title", {
            behavior: writeOperation({ idempotent: true }),
          }),
          // @ts-expect-error draft has no place beside a body of text
          previewNote: route.post("/notes/:noteId/preview", { body: "text" }),
        },
        { errors: [] }
      ),
      // @ts-expect-error every operation has a route
      operationGroup("partial", noteOperations, {}, { errors: [] }),
    ];

    expect(refused).toBeFunction();
  });

  test("a mutation without a behavior is refused at run time too", () => {
    expect(() =>
      operationGroup(
        "unchecked",
        defineOperations({
          archiveNote: mutation({ input: NoteRef, output: ReceivedInput }),
        }),
        { archiveNote: route.post("/notes/:noteId/archive") as never },
        { errors: [] }
      )
    ).toThrow("archiveNote is a mutation without a behavior.");
  });
});
