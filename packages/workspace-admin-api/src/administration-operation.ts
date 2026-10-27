import {
  type Array as Arr,
  Context,
  Match,
  Option,
  type Schema,
  SchemaAST,
} from "effect";
import { HttpApi, type HttpApiGroup } from "effect/unstable/httpapi";

declare module "effect/Schema" {
  namespace Annotations {
    interface Annotations {
      /**
       * Marks a value that lets its holder act, such as a token or a PIN.
       * Only CLI-only operations and the allowlisted disclosures in
       * `disclosedCredentials` may return one.
       */
      readonly credential?: true | undefined;
      /**
       * Marks an input field that identifies one intended change across
       * retries, such as a request ID: a retry repeats it, a new change
       * takes a new one.
       */
      readonly changeKey?: true | undefined;
    }
  }
}

/**
 * What an administration operation does: `read` changes nothing, `write`
 * changes state an administrator can undo or redo, and `destructive` cancels,
 * sends, deletes, revokes, or grants something an administrator should
 * confirm first. `dhw` confirms every destructive operation before it runs.
 */
export type AdministrationOperationKind = "read" | "write" | "destructive";

/** `<group>.<endpoint>`, plus `.<variant>` for a generic mutation variant. */
export type AdministrationOperationReference = `${string}.${string}`;

/**
 * How a caller shows what a destructive operation would change before it
 * runs: the same endpoint with `dryRun: true`, or read operations that show
 * the current state. The read operations take the operation's own
 * arguments, under the names in `arguments` where theirs differ.
 */
export type AdministrationOperationPreview =
  | { readonly _tag: "DryRun" }
  | {
      readonly _tag: "Read";
      readonly operations: Arr.NonEmptyReadonlyArray<AdministrationOperationReference>;
      /** `{ <read operation's argument>: <this operation's argument> }`. */
      readonly arguments?: Readonly<Record<string, string>> | undefined;
    };

/**
 * An endpoint annotation describing what its operation does, so every
 * channel can tell reads from changes and confirm destructive ones.
 */
export class AdministrationOperationBehavior extends Context.Service<
  AdministrationOperationBehavior,
  {
    readonly kind: AdministrationOperationKind;
    /** Repeating the same input, request ID included, has no further effect. */
    readonly idempotent: boolean;
    readonly preview?: AdministrationOperationPreview | undefined;
  }
>()("@deskohub/workspace-admin-api/AdministrationOperationBehavior") {}

/**
 * An endpoint annotation for a generic mutation endpoint: its payload's
 * `field` is a union whose members are separate operations, told apart by
 * their `discriminator` literal.
 */
export class AdministrationOperationVariants extends Context.Service<
  AdministrationOperationVariants,
  {
    readonly field: string;
    readonly discriminator: string;
    readonly operations: Readonly<
      Record<string, AdministrationOperationBehavior["Service"]>
    >;
  }
>()("@deskohub/workspace-admin-api/AdministrationOperationVariants") {}

/**
 * An endpoint annotation for the CLI's own transport: its sign-in handshake
 * and client checks. These aren't administration operations and no other
 * channel serves them.
 */
export class CliOnly extends Context.Service<
  CliOnly,
  { readonly reason: string }
>()("@deskohub/workspace-admin-api/CliOnly") {}

export const readOperation: AdministrationOperationBehavior["Service"] = {
  kind: "read",
  idempotent: true,
};

/** A write; its type keeps whether it is idempotent. */
export const writeOperation = <
  const Options extends { readonly idempotent: boolean },
>(
  options: Options
): { readonly kind: "write" } & Options => ({ kind: "write", ...options });

/** A destructive operation; its type keeps whether it is idempotent. */
export const destructiveOperation = <
  const Options extends {
    readonly idempotent: boolean;
    readonly preview?: AdministrationOperationPreview;
  },
>(
  options: Options
): { readonly kind: "destructive" } & Options => ({
  kind: "destructive",
  ...options,
});

export const dryRunPreview: AdministrationOperationPreview = { _tag: "DryRun" };

export const readPreview = (
  ...operations: Arr.NonEmptyReadonlyArray<AdministrationOperationReference>
): AdministrationOperationPreview => ({ _tag: "Read", operations });

/**
 * A read preview whose operations take some of this operation's arguments
 * under other names, as `{ <read operation's argument>: <this operation's
 * argument> }`.
 */
export const readPreviewWithArguments = (
  previewArguments: Readonly<Record<string, string>>,
  ...operations: Arr.NonEmptyReadonlyArray<AdministrationOperationReference>
): AdministrationOperationPreview => ({
  _tag: "Read",
  operations,
  arguments: previewArguments,
});

/**
 * The credentials an operation may return to any administration channel.
 * The standalone access-code PIN is shown once, to the administrator who
 * created it, and is never stored for later display.
 */
export const disclosedCredentials: ReadonlyArray<{
  readonly operation: AdministrationOperationReference;
  readonly path: ReadonlyArray<string>;
}> = [
  {
    operation: "administration.createStandaloneAccessCode",
    path: ["pin"],
  },
];

type Mark = "credential" | "changeKey";

const isMarkedCheck =
  (mark: Mark) =>
  (check: SchemaAST.Check<unknown>): boolean =>
    check.annotations?.[mark] === true ||
    (check._tag === "FilterGroup" && check.checks.some(isMarkedCheck(mark)));

/**
 * The mark can sit on the node, on any of its checks, or on the key that
 * holds it: annotating a checked schema stores it on the last check, a later
 * `.check` appends another, and `annotateKey` marks one field of a type
 * other fields share unmarked.
 */
const isMarked = (mark: Mark) => (ast: SchemaAST.AST) =>
  ast.annotations?.[mark] === true ||
  ast.context?.annotations?.[mark] === true ||
  (ast.checks?.some(isMarkedCheck(mark)) ?? false);

/** The property paths at which a value of the schema holds a `mark`ed value. */
const markedPaths = (mark: Mark, schema: Schema.Top) => {
  const isMarkedNode = isMarked(mark);
  const paths: Array<ReadonlyArray<string>> = [];
  const visit = (
    ast: SchemaAST.AST,
    path: ReadonlyArray<string>,
    ancestors: ReadonlySet<SchemaAST.AST>
  ): void => {
    // A recursive schema reaches itself again; its paths are already covered.
    if (ancestors.has(ast)) {
      return;
    }
    const within = new Set(ancestors).add(ast);
    if (isMarkedNode(ast)) {
      paths.push(path);
      return;
    }
    for (const link of ast.encoding ?? []) {
      visit(link.to, path, within);
    }
    if (SchemaAST.isObjects(ast)) {
      for (const property of ast.propertySignatures) {
        visit(property.type, [...path, String(property.name)], within);
      }
      for (const index of ast.indexSignatures) {
        visit(index.type, [...path, "*"], within);
      }
    } else if (SchemaAST.isArrays(ast)) {
      for (const element of [...ast.elements, ...ast.rest]) {
        visit(element, [...path, "*"], within);
      }
    } else if (SchemaAST.isUnion(ast)) {
      for (const member of ast.types) {
        visit(member, path, within);
      }
    } else if (SchemaAST.isSuspend(ast)) {
      visit(ast.thunk(), path, within);
    } else if (SchemaAST.isDeclaration(ast)) {
      for (const parameter of ast.typeParameters) {
        visit(parameter, path, within);
      }
    }
  };
  visit(schema.ast, [], new Set());
  return paths.filter(
    (path, index) =>
      paths.findIndex((other) => other.join(".") === path.join(".")) === index
  );
};

/** The property paths at which a value of the schema can hold a credential. */
export const credentialPaths = (
  schema: Schema.Top
): ReadonlyArray<ReadonlyArray<string>> => markedPaths("credential", schema);

/**
 * The property paths of the schema's change keys, the input fields that
 * identify one intended change across retries.
 */
export const changeKeyPaths = (
  schema: Schema.Top
): ReadonlyArray<ReadonlyArray<string>> => markedPaths("changeKey", schema);

/** How one endpoint, or one variant of a generic mutation endpoint, is served. */
export type AdministrationOperationAccess =
  | {
      readonly _tag: "Operation";
      readonly behavior: AdministrationOperationBehavior["Service"];
    }
  | { readonly _tag: "CliOnly"; readonly reason: string };

export interface AdministrationOperationEntry {
  readonly reference: AdministrationOperationReference;
  readonly group: string;
  readonly endpoint: string;
  readonly variant: Option.Option<string>;
  readonly access: AdministrationOperationAccess;
}

/** What one endpoint declares about the operations it serves. */
export type AdministrationOperationDeclaration =
  | {
      readonly _tag: "Operation";
      readonly behavior: AdministrationOperationBehavior["Service"];
    }
  | {
      readonly _tag: "Variants";
      readonly variants: AdministrationOperationVariants["Service"];
    }
  | { readonly _tag: "CliOnly"; readonly reason: string };

/**
 * The declaration in an endpoint's merged annotations, or none when it
 * declares no or more than one of `AdministrationOperationBehavior`,
 * `AdministrationOperationVariants` and `CliOnly`.
 */
export const administrationOperationDeclaration = (
  annotations: Context.Context<never>
): Option.Option<AdministrationOperationDeclaration> => {
  const declarations = [
    Context.getOption(annotations, AdministrationOperationBehavior).pipe(
      Option.map(
        (behavior): AdministrationOperationDeclaration => ({
          _tag: "Operation",
          behavior,
        })
      )
    ),
    Context.getOption(annotations, AdministrationOperationVariants).pipe(
      Option.map(
        (variants): AdministrationOperationDeclaration => ({
          _tag: "Variants",
          variants,
        })
      )
    ),
    Context.getOption(annotations, CliOnly).pipe(
      Option.map(
        ({ reason }): AdministrationOperationDeclaration => ({
          _tag: "CliOnly",
          reason,
        })
      )
    ),
  ].filter(Option.isSome);
  const [declaration, ...others] = declarations;
  return declaration !== undefined && others.length === 0
    ? declaration
    : Option.none();
};

/**
 * The variant a generic mutation endpoint's request body selects, read from
 * the undecoded body: none when it names no declared variant.
 */
export const administrationOperationVariantOf = (
  variants: AdministrationOperationVariants["Service"],
  body: unknown
): Option.Option<string> => {
  const member = ownProperty(body, variants.field);
  const variant = ownProperty(member, variants.discriminator);
  return typeof variant === "string" &&
    Object.hasOwn(variants.operations, variant)
    ? Option.some(variant)
    : Option.none();
};

const ownProperty = (value: unknown, key: string): unknown =>
  typeof value === "object" && value !== null && Object.hasOwn(value, key)
    ? (value as Readonly<Record<string, unknown>>)[key]
    : undefined;

/**
 * Every operation of the API, one entry per endpoint and one per generic
 * mutation variant. Fails on an endpoint that doesn't declare exactly one of
 * `AdministrationOperationBehavior`, `AdministrationOperationVariants` and `CliOnly`.
 */
export const administrationOperations = <
  Id extends string,
  Groups extends HttpApiGroup.Any,
>(
  api: HttpApi.HttpApi<Id, Groups>
): ReadonlyArray<AdministrationOperationEntry> => {
  const entries: Array<AdministrationOperationEntry> = [];
  HttpApi.reflect(api, {
    onGroup: () => undefined,
    onEndpoint: ({ group, endpoint, mergedAnnotations }) => {
      const reference: AdministrationOperationReference = `${group.identifier}.${endpoint.name}`;
      const declaration = administrationOperationDeclaration(mergedAnnotations);
      if (Option.isNone(declaration)) {
        throw new Error(
          `${reference} must declare exactly one of AdministrationOperationBehavior, AdministrationOperationVariants and CliOnly.`
        );
      }
      const base = {
        group: group.identifier,
        endpoint: endpoint.name,
      };
      Match.value(declaration.value).pipe(
        Match.tagsExhaustive({
          Operation: ({ behavior }) => {
            entries.push({
              ...base,
              reference,
              variant: Option.none(),
              access: { _tag: "Operation", behavior },
            });
          },
          Variants: ({ variants }) => {
            for (const [variant, behavior] of Object.entries(
              variants.operations
            )) {
              entries.push({
                ...base,
                reference: `${reference}.${variant}`,
                variant: Option.some(variant),
                access: { _tag: "Operation", behavior },
              });
            }
          },
          CliOnly: ({ reason }) => {
            entries.push({
              ...base,
              reference,
              variant: Option.none(),
              access: { _tag: "CliOnly", reason },
            });
          },
        })
      );
    },
  });
  return entries;
};
