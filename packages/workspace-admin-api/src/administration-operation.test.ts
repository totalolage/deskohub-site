import { describe, expect, test } from "bun:test";
import { Context, Option, Schema, SchemaAST } from "effect";
import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiGroup,
} from "effect/unstable/httpapi";
import {
  AdministrationOperationBehavior,
  AdministrationOperationVariants,
  administrationOperations,
  CliOnly,
  changeKeyPaths,
  credentialPaths,
  disclosedCredentials,
} from "./administration-operation";
import {
  AdministrationAuthentication,
  CliServiceUnavailable,
  CliSessionUnauthorized,
} from "./workspace-admin-api";
import { WorkspaceAdminApi } from "./workspace-admin-http-api";

type ReflectedEndpoint = {
  readonly reference: string;
  readonly group: HttpApiGroup.AnyWithProps;
  readonly endpoint: HttpApiEndpoint.AnyWithProps;
  readonly annotations: Context.Context<never>;
  readonly middleware: ReadonlySet<unknown>;
  readonly outputs: ReadonlyArray<Schema.Top>;
  readonly errors: ReadonlyMap<number, ReadonlyArray<Schema.Top>>;
};

const reflectEndpoints = <Id extends string, Groups extends HttpApiGroup.Any>(
  api: HttpApi.HttpApi<Id, Groups>
) => {
  const endpoints: Array<ReflectedEndpoint> = [];
  HttpApi.reflect(api, {
    onGroup: () => undefined,
    onEndpoint: ({
      group,
      endpoint,
      mergedAnnotations,
      middleware,
      successes,
      errors,
    }) => {
      endpoints.push({
        reference: `${group.identifier}.${endpoint.name}`,
        group,
        endpoint,
        annotations: mergedAnnotations,
        middleware,
        outputs: [...successes.values(), ...errors.values()].flat(),
        errors,
      });
    },
  });
  return endpoints;
};

const endpoints = reflectEndpoints(WorkspaceAdminApi);
const operations = administrationOperations(WorkspaceAdminApi);
const operationByReference = new Map(
  operations.map((operation) => [operation.reference, operation])
);
const isCliOnly = (endpoint: ReflectedEndpoint) =>
  Option.isSome(Context.getOption(endpoint.annotations, CliOnly));

const payloadProperty = (
  endpoint: HttpApiEndpoint.AnyWithProps,
  name: string
) =>
  [...endpoint.payload.values()]
    .flatMap(({ schemas }) => schemas)
    .map((schema) => SchemaAST.toType(schema.ast))
    .filter(SchemaAST.isObjects)
    .flatMap((ast) => ast.propertySignatures)
    .find((property) => property.name === name)?.type;

const literalsOf = (union: SchemaAST.AST, discriminator: string) =>
  (SchemaAST.isUnion(union) ? union.types : [union])
    .filter(SchemaAST.isObjects)
    .flatMap((member) => member.propertySignatures)
    .filter((property) => property.name === discriminator)
    .map((property) => property.type)
    .filter(SchemaAST.isLiteral)
    .map((literal) => String(literal.literal));

describe("administration operations", () => {
  test("every endpoint declares exactly one behavior, variant map or CLI-only reason", () => {
    const undeclared = endpoints
      .filter(
        ({ annotations }) =>
          [
            Context.getOption(annotations, AdministrationOperationBehavior),
            Context.getOption(annotations, AdministrationOperationVariants),
            Context.getOption(annotations, CliOnly),
          ].filter((option) => Option.isSome<unknown>(option)).length !== 1
      )
      .map(({ reference }) => reference);

    expect(undeclared).toEqual([]);
  });

  test("refuses an endpoint that declares neither or both", () => {
    const groupWith = (endpoint: HttpApiEndpoint.Any) =>
      HttpApi.make("test").add(HttpApiGroup.make("test").add(endpoint));
    const bare = groupWith(
      HttpApiEndpoint.get("bare", "/bare", { success: Schema.String })
    );
    const both = groupWith(
      HttpApiEndpoint.get("both", "/both", { success: Schema.String })
        .annotate(AdministrationOperationBehavior, {
          kind: "read",
          idempotent: true,
        })
        .annotate(CliOnly, { reason: "test" })
    );

    expect(() => administrationOperations(bare)).toThrow("test.bare");
    expect(() => administrationOperations(both)).toThrow("test.both");
  });

  test("each variant map names exactly the variants its payload union has", () => {
    const mismatched = endpoints.flatMap(
      ({ reference, endpoint, annotations }) =>
        Option.match(
          Context.getOption(annotations, AdministrationOperationVariants),
          {
            onNone: () => [],
            onSome: ({ field, discriminator, operations }) => {
              const union = payloadProperty(endpoint, field);
              const literals = union ? literalsOf(union, discriminator) : [];
              return literals.length > 0 &&
                [...literals].sort().join() ===
                  Object.keys(operations).sort().join()
                ? []
                : [reference];
            },
          }
        )
    );

    expect(mismatched).toEqual([]);
  });

  test("only destructive operations declare a preview, and each preview exists", () => {
    const invalid = operations.flatMap((operation) => {
      if (operation.access._tag !== "Operation") {
        return [];
      }
      const { kind, preview } = operation.access.behavior;
      if (preview === undefined) {
        return [];
      }
      if (kind !== "destructive") {
        return [`${operation.reference}: preview on a ${kind} operation`];
      }
      if (preview._tag === "DryRun") {
        const endpoint = endpoints.find(
          ({ reference }) =>
            reference === `${operation.group}.${operation.endpoint}`
        );
        return endpoint && payloadProperty(endpoint.endpoint, "dryRun")
          ? []
          : [`${operation.reference}: dry-run preview without dryRun`];
      }
      return preview.operations.flatMap((reference) => {
        const target = operationByReference.get(reference);
        return target?.access._tag === "Operation" &&
          target.access.behavior.kind === "read"
          ? []
          : [`${operation.reference}: ${reference} isn't a read operation`];
      });
    });

    expect(invalid).toEqual([]);
  });

  // `administrationOperationGroup` refuses CLI-only endpoints; this finds an
  // operation in a group declared without it.
  test("every operation is served by an administration operation group", () => {
    const unauthenticated = endpoints
      .filter(
        (endpoint) =>
          !isCliOnly(endpoint) &&
          !endpoint.middleware.has(AdministrationAuthentication)
      )
      .map(({ reference }) => reference);

    expect(unauthenticated).toEqual([]);
  });

  test("operations keep the authentication errors released dhw decodes", () => {
    const changed = endpoints
      .filter((endpoint) => !isCliOnly(endpoint))
      .filter(
        ({ errors }) =>
          !errors.get(401)?.includes(CliSessionUnauthorized.schema) ||
          !errors.get(503)?.includes(CliServiceUnavailable.schema)
      )
      .map(({ reference }) => reference);

    expect(changed).toEqual([]);
  });
});

describe("credentials in operation outputs", () => {
  test("only CLI-only endpoints and the allowlisted disclosures return one", () => {
    const leaks = endpoints
      .filter((endpoint) => !isCliOnly(endpoint))
      .flatMap(({ reference, outputs }) =>
        outputs.flatMap(credentialPaths).map((path) => ({
          operation: reference,
          path,
        }))
      );

    expect(leaks).toEqual(
      disclosedCredentials.map(({ operation, path }) => ({ operation, path }))
    );
  });

  test("the CLI sign-in hands out its credentials", () => {
    const handedOut = endpoints
      .filter(isCliOnly)
      .filter(({ outputs }) =>
        outputs.some((schema) => credentialPaths(schema).length > 0)
      )
      .map(({ reference }) => reference);

    expect(handedOut).toEqual([
      "cli.startAuthentication",
      "cli.getAuthenticationStatus",
      "cli.exchangeGrant",
    ]);
  });

  test("finds a mark behind later checks, nesting and unions", () => {
    const Token = Schema.String.annotate({ credential: true }).check(
      Schema.isMinLength(1)
    );
    const schema = Schema.Struct({
      safe: Schema.String,
      nested: Schema.Struct({ token: Schema.NullOr(Token) }),
      list: Schema.Array(Schema.Union([Schema.Number, Token])),
    });

    expect(credentialPaths(schema)).toEqual([
      ["nested", "token"],
      ["list", "*"],
    ]);
  });
});

describe("change keys in operation inputs", () => {
  test("the operations that replay a retried change mark their change keys", () => {
    const keyed = endpoints.flatMap(({ reference, endpoint }) =>
      [...endpoint.payload.values()]
        .flatMap(({ schemas }) => schemas)
        .flatMap(changeKeyPaths)
        .map((path) => `${reference} ${path.join(".")}`)
    );

    expect(keyed).toEqual([
      "administration.mutateReservationAccess requestId",
      "administration.previewInvoice invoiceId",
      "administration.createInvoice invoiceId",
      "administration.createStandaloneAccessCode attemptId",
      "administration.mutateDiscounts requestId",
      "campaigns.createCampaignAudience requestId",
      "campaigns.createCampaign requestId",
      "campaigns.duplicateCampaign requestId",
    ]);
  });

  test("marks the field, not every value of its type", () => {
    const Id = Schema.String.check(Schema.isUUID());
    const schema = Schema.Struct({
      attemptId: Id.annotateKey({ changeKey: true }),
      previousAttemptId: Schema.optionalKey(Id),
    });

    expect(changeKeyPaths(schema)).toEqual([["attemptId"]]);
  });
});
