import { type Array as Arr, Effect, Option, Schema, Struct } from "effect";
import { HttpMethod, type HttpRouter } from "effect/unstable/http";
import {
  type HttpApi,
  HttpApiBuilder,
  HttpApiEndpoint,
  HttpApiGroup,
} from "effect/unstable/httpapi";
import {
  AdministrationOperationBehavior,
  readOperation,
} from "./administration-operation";
import type {
  NoInput,
  Operation,
  OperationInput,
  OperationOutput,
  Operations,
} from "./campaign-operations";
import { MinimumDhwVersion } from "./dhw-version";
import { administrationOperationGroup } from "./workspace-admin-api";

const strictParseOptions = {
  parseOptions: { errors: "all", onExcessProperty: "error" },
} as const;

/** The names of a path's `:name` segments. */
export type PathParamNames<Path extends string> =
  Path extends `${string}:${infer Param}/${infer Rest}`
    ? Param | PathParamNames<`/${Rest}`>
    : Path extends `${string}:${infer Param}`
      ? Param
      : never;

const pathParamNamesOf = (path: string): ReadonlyArray<string> =>
  Array.from(path.matchAll(/:(\w+)/g), ([, name]) => name ?? "");

interface RouteOptions {
  /**
   * What a mutation does, for `dhw` confirmations and the AI assistant's
   * tools. A query is always a read and declares none.
   */
  readonly behavior?: AdministrationOperationBehavior["Service"];
  /**
   * The one input field the body carries, when the body isn't the rest of
   * the input.
   */
  readonly body?: string;
  /** A read carries its input beyond the path parameters as its query. */
  readonly query?: true;
}

/** Where an operation is served: its method and path, and its request's parts. */
export interface OperationRoute<
  Method extends HttpMethod.HttpMethod = HttpMethod.HttpMethod,
  Path extends HttpRouter.PathInput = HttpRouter.PathInput,
  Options extends RouteOptions = RouteOptions,
> {
  readonly method: Method;
  readonly path: Path;
  readonly options: Options;
}

type ReadOptions = Pick<RouteOptions, "behavior" | "query">;
type WriteOptions = Pick<RouteOptions, "behavior" | "body">;
type NoOptions = Record<never, never>;

type RouteOn<
  Method extends HttpMethod.HttpMethod,
  Allowed extends RouteOptions,
> = <
  const Path extends HttpRouter.PathInput,
  const Options extends Allowed = Extract<NoOptions, Allowed>,
>(
  path: Path,
  options?: Options
) => OperationRoute<Method, Path, Options>;

const routeOn =
  <Method extends HttpMethod.HttpMethod>(
    method: Method
  ): RouteOn<Method, RouteOptions> =>
  (path, options) => ({ method, path, options: options ?? ({} as never) });

/**
 * Routes for an operation's endpoint. Path parameters are the input fields
 * the path names. A read's other fields are absent, or its query with
 * `query: true`; a write's other fields are its body, which is absent when
 * there are none and is the whole input when the path names none.
 */
export const route: {
  readonly get: RouteOn<"GET", ReadOptions>;
  readonly post: RouteOn<"POST", WriteOptions>;
  readonly put: RouteOn<"PUT", WriteOptions>;
  readonly patch: RouteOn<"PATCH", WriteOptions>;
  readonly delete: RouteOn<"DELETE", WriteOptions>;
} = {
  get: routeOn("GET"),
  post: routeOn("POST"),
  put: routeOn("PUT"),
  patch: routeOn("PATCH"),
  delete: routeOn("DELETE"),
};

type FieldsOf<Input> =
  Input extends Schema.Struct<infer Fields extends Schema.Struct.Fields>
    ? Fields
    : Record<never, never>;
type FieldOf<
  Fields extends Schema.Struct.Fields,
  Key,
> = Key extends keyof Fields ? Fields[Key] : never;
/** `Fields` as struct fields, which TypeScript can't tell of a generic mapped type. */
type AsFields<Fields> = Extract<Fields, Schema.Struct.Fields>;
type PickFields<Fields extends Schema.Struct.Fields, Keys> = AsFields<{
  readonly [Key in Keys & keyof Fields]: Fields[Key];
}>;
type OmitFields<Fields extends Schema.Struct.Fields, Keys> = AsFields<{
  readonly [Key in keyof Fields as Key extends Keys ? never : Key]: Fields[Key];
}>;
type ParamKeysOf<Route extends OperationRoute> = PathParamNames<Route["path"]>;
type RestKeysOf<Op extends Operation, Route extends OperationRoute> = Exclude<
  keyof FieldsOf<Op["input"]> & string,
  ParamKeysOf<Route>
>;
type BodyFieldOf<Route extends OperationRoute> = Route["options"] extends {
  readonly body: infer Field extends string;
}
  ? Field
  : never;

/** The input without the path's parameters. */
type InputWithout<Input, Keys> = Schema.Struct<
  OmitFields<FieldsOf<Input>, Keys>
>;

type ParamsOf<Op extends Operation, Route extends OperationRoute> = [
  ParamKeysOf<Route>,
] extends [never]
  ? never
  : Schema.Struct<PickFields<FieldsOf<Op["input"]>, ParamKeysOf<Route>>>;

type QueryOf<
  Op extends Operation,
  Route extends OperationRoute,
> = Route["options"] extends { readonly query: true }
  ? InputWithout<Op["input"], ParamKeysOf<Route>>
  : never;

type PayloadOf<Op extends Operation, Route extends OperationRoute> = Extract<
  BodyOf<Op, Route>,
  Schema.Top
>;

type BodyOf<Op extends Operation, Route extends OperationRoute> = [
  Route["method"],
] extends [HttpMethod.HttpMethod.NoBody]
  ? never
  : [BodyFieldOf<Route>] extends [never]
    ? [RestKeysOf<Op, Route>] extends [never]
      ? never
      : [ParamKeysOf<Route>] extends [never]
        ? Op["input"]
        : InputWithout<Op["input"], ParamKeysOf<Route>>
    : FieldOf<FieldsOf<Op["input"]>, BodyFieldOf<Route>>;

/**
 * The endpoint an operation's route declares, typed as `HttpApiEndpoint`'s
 * constructors type it: its params, query and payload from the input, its
 * success from the output.
 */
export type OperationEndpoint<
  Name extends string,
  Op extends Operation,
  Route extends OperationRoute,
  Errors extends Schema.Top,
> = HttpApiEndpoint.HttpApiEndpoint<
  Name,
  Route["method"],
  Route["path"],
  HttpApiEndpoint.StringTree<ParamsOf<Op, Route>>,
  HttpApiEndpoint.StringTree<QueryOf<Op, Route>>,
  Route["method"] extends HttpMethod.HttpMethod.WithBody
    ? HttpApiEndpoint.Json<PayloadOf<Op, Route>>
    : HttpApiEndpoint.StringTree<PayloadOf<Op, Route>>,
  HttpApiEndpoint.StringTree<never>,
  HttpApiEndpoint.Json<Op["output"]>,
  HttpApiEndpoint.Json<Errors>
>;

type BehaviorProblem<
  Op extends Operation,
  Options extends RouteOptions,
> = Op["kind"] extends "query"
  ? Options extends { readonly behavior: object }
    ? "is a query, which is a read and declares no behavior"
    : never
  : Options extends { readonly behavior: infer Behavior }
    ? Behavior extends { readonly kind: "read" }
      ? "is a mutation, so its behavior isn't a read"
      : Op["ledger"] extends true
        ? Behavior extends { readonly idempotent: true }
          ? never
          : "replays a retried request, so its behavior is idempotent"
        : never
    : "is a mutation and declares its behavior";

type RequestProblem<Op extends Operation, Route extends OperationRoute> =
  | (Op["input"] extends Schema.Struct<Schema.Struct.Fields> | typeof NoInput
      ? never
      : "takes a struct input")
  | (Exclude<
      ParamKeysOf<Route>,
      keyof FieldsOf<Op["input"]>
    > extends infer Param extends string
      ? [Param] extends [never]
        ? never
        : `names :${Param} in its path, which isn't an input field`
      : never)
  | ([Route["method"]] extends [HttpMethod.HttpMethod.NoBody]
      ? Route["options"] extends { readonly query: true }
        ? [RestKeysOf<Op, Route>] extends [never]
          ? "declares a query without input beyond its path"
          : never
        : [RestKeysOf<Op, Route>] extends [never]
          ? never
          : `has no place for ${RestKeysOf<Op, Route>}; declare query: true`
      : [BodyFieldOf<Route>] extends [never]
        ? never
        : [Exclude<RestKeysOf<Op, Route>, BodyFieldOf<Route>>] extends [never]
          ? BodyFieldOf<Route> extends RestKeysOf<Op, Route>
            ? never
            : `carries ${BodyFieldOf<Route>} as its body, which isn't an input field beyond its path`
          : `has no place for ${Exclude<RestKeysOf<Op, Route>, BodyFieldOf<Route>>} beside its body`);

/** Why a route can't serve its operation, or `never` when it can. */
export type RouteProblem<Op extends Operation, Route extends OperationRoute> =
  | BehaviorProblem<Op, Route["options"]>
  | RequestProblem<Op, Route>;

/** A route for every operation; a route that can't serve one names why. */
export type OperationRoutes<Ops extends Operations> = {
  readonly [Name in keyof Ops]: OperationRoute;
};

type CheckedRoutes<
  Ops extends Operations,
  Routes extends OperationRoutes<Ops>,
> = {
  readonly [Name in keyof Routes]: Name extends keyof Ops
    ? [RouteProblem<Ops[Name], Routes[Name]>] extends [never]
      ? Routes[Name]
      : Routes[Name] & {
          readonly problem: `${Name & string} ${RouteProblem<Ops[Name], Routes[Name]>}`;
        }
    : { readonly problem: `${Name & string} is no operation` };
};

/** Every endpoint of an operation group, by its operation's name. */
export type OperationGroupEndpoints<
  Ops extends Operations,
  Routes extends OperationRoutes<Ops>,
  Errors extends Schema.Top,
> = {
  readonly [Name in keyof Ops & string]: OperationEndpoint<
    Name,
    Ops[Name],
    Routes[Name],
    Errors
  >;
}[keyof Ops & string];

const operationBinding = Symbol.for(
  "@deskohub/workspace-admin-api/OperationBinding"
);

/** The operations a group serves and the route of each. */
export interface OperationBinding<
  Ops extends Operations = Operations,
  Routes extends OperationRoutes<Ops> = OperationRoutes<Ops>,
> {
  readonly [operationBinding]: {
    readonly operations: Ops;
    readonly routes: Routes;
  };
}

const fieldsOf = (input: Schema.Top): Schema.Struct.Fields =>
  Schema.isSchema(input) && "fields" in input
    ? (input as Schema.Struct<Schema.Struct.Fields>).fields
    : {};

/** What a route's body carries: one input field, the rest of the input, or nothing. */
type RequestBody = { readonly field: string } | "rest" | "none";

const bodyOf = (
  { method, options }: OperationRoute,
  restKeys: ReadonlyArray<string>
): RequestBody => {
  if (!HttpMethod.hasBody(method)) return "none";
  if (options.body !== undefined) return { field: options.body };
  return restKeys.length === 0 ? "none" : "rest";
};

/**
 * Where a route places its operation's input, from the input's schema: the
 * path parameters, whether the rest is the query, and what the body is.
 */
const requestLayoutOf = (
  { input }: Operation,
  operationRoute: OperationRoute
) => {
  const fields = fieldsOf(input);
  const paramKeys = pathParamNamesOf(operationRoute.path);
  const restKeys = Object.keys(fields).filter(
    (key) => !paramKeys.includes(key)
  );
  return {
    fields,
    paramKeys,
    query: operationRoute.options.query === true,
    body: bodyOf(operationRoute, restKeys),
  };
};

/** The value `body` names in `rest` or one of `fields`, or none. */
const bodyValue = <A>(
  body: RequestBody,
  rest: () => A,
  field: (name: string) => A
): A | undefined => {
  if (body === "none") return undefined;
  return body === "rest" ? rest() : field(body.field);
};

const endpointOf = (
  operation: Operation,
  operationRoute: OperationRoute,
  error: ReadonlyArray<Schema.Top>
) => {
  const { input } = operation;
  const { fields, paramKeys, query, body } = requestLayoutOf(
    operation,
    operationRoute
  );
  const rest = (): Schema.Top =>
    paramKeys.length === 0
      ? input
      : (input as Schema.Struct<Schema.Struct.Fields>)
          .mapFields(Struct.omit(paramKeys))
          .annotate(strictParseOptions);
  const behavior =
    operation.kind === "query"
      ? readOperation
      : operationRoute.options.behavior;
  if (behavior === undefined) {
    throw new Error(`${operation.name} is a mutation without a behavior.`);
  }
  const endpoint = HttpApiEndpoint.make(operationRoute.method)(
    operation.name,
    operationRoute.path,
    {
      params:
        paramKeys.length === 0 ? undefined : Struct.pick(fields, paramKeys),
      query: query ? rest() : undefined,
      payload: bodyValue(body, rest, (name) => fields[name]),
      success: operation.output,
      error,
    }
  ).annotate(AdministrationOperationBehavior, behavior);
  return operation.minimumDhwVersion === undefined
    ? endpoint
    : endpoint.annotate(
        MinimumDhwVersion,
        Option.some(operation.minimumDhwVersion)
      );
};

/**
 * The `/api/v1/cli` group serving `operations`, one endpoint per operation
 * named after it. Each endpoint's request parts come from the operation's
 * input as its route places them, its success is the operation's output,
 * and it requires the operation's minimum `dhw`. A query is a read; a
 * mutation's route states its behavior. The group records each action as
 * the authenticated administrator's, refusing an outdated `dhw` before
 * reading its session. The group carries its operations and routes for
 * `operationGroupHandlers` and `operationRequest`; add it to the API as
 * returned, since `prefix`, `middleware` and `annotate` copy a group without
 * them.
 */
export const operationGroup = <
  const Id extends string,
  Ops extends Operations,
  const Routes extends OperationRoutes<Ops>,
  const Errors extends ReadonlyArray<Schema.Top>,
>(
  identifier: Id,
  operations: Ops,
  routes: Routes & CheckedRoutes<Ops, Routes>,
  { errors }: { readonly errors: Errors }
) => {
  const endpoints = Object.entries(routes).map(([name, operationRoute]) =>
    endpointOf(operations[name] as Operation, operationRoute, errors)
  ) as unknown as Arr.NonEmptyReadonlyArray<
    OperationGroupEndpoints<Ops, Routes, Errors[number]>
  >;
  const group = administrationOperationGroup(
    HttpApiGroup.make(identifier).add(...endpoints),
    { checkDhwVersionBeforeAuthentication: true }
  );
  const binding: OperationBinding<Ops, Routes> = {
    [operationBinding]: { operations, routes },
  };
  return Object.assign(group, binding);
};

/** Runs an operation by name; `operationGroupHandlers` serves a group with it. */
export type OperationInvoke<Ops extends Operations, Failure, Services> = <
  Name extends keyof Ops & string,
>(
  name: Name,
  input: OperationInput<Ops[Name]>
) => Effect.Effect<OperationOutput<Ops[Name]>, Failure, Services>;

/**
 * What serving `Endpoint` requires, as `HttpApiBuilder`'s `handle` adds it:
 * its middleware and their services, and the handler's own services that
 * the request doesn't provide.
 */
type ServedRequirements<Endpoint extends HttpApiEndpoint.Any, Services> =
  | HttpApiEndpoint.Middleware<Endpoint>
  | HttpApiEndpoint.MiddlewareServices<Endpoint>
  | (HttpApiEndpoint.ExcludeProvided<
      Endpoint,
      Services | HttpApiEndpoint.ServerServices<Endpoint>
    > extends infer Required
      ? Required extends never
        ? never
        : HttpRouter.Request<"Requires", Required>
      : never);

/** The parts of a request that carry an operation's input. */
export type OperationRequest = {
  readonly params?: Readonly<Record<string, unknown>>;
  readonly query?: Readonly<Record<string, unknown>>;
  readonly payload?: unknown;
};

/** The request parts that carry an operation's input, as its route places them. */
const requestOf = (
  operation: Operation,
  operationRoute: OperationRoute,
  input: Readonly<Record<string, unknown>>
): OperationRequest => {
  const { paramKeys, query, body } = requestLayoutOf(operation, operationRoute);
  const rest = Struct.omit(input, paramKeys);
  return {
    ...(paramKeys.length === 0
      ? {}
      : { params: Struct.pick(input, paramKeys) }),
    ...(query ? { query: rest } : {}),
    ...(body === "none"
      ? {}
      : {
          payload: bodyValue(
            body,
            () => rest,
            (name) => input[name]
          ),
        }),
  };
};

/**
 * The request parts, params, query and payload, that carry the input of the
 * operation `name` to its endpoint in `group`: what a client of the group
 * sends.
 */
export const operationRequest = <
  Ops extends Operations,
  Name extends keyof Ops & string,
>(
  group: OperationBinding<Ops>,
  name: Name,
  input: OperationInput<Ops[Name]>
): OperationRequest => {
  const { operations, routes } = group[operationBinding];
  const operation: Operation | undefined = operations[name];
  const operationRoute: OperationRoute | undefined = routes[name];
  if (operation === undefined || operationRoute === undefined) {
    throw new Error(`${name} has no route in this group.`);
  }
  return requestOf(
    operation,
    operationRoute,
    input as Readonly<Record<string, unknown>>
  );
};

/** The operation's input from the request parts its route placed it in. */
const inputOf = ({ options }: OperationRoute, request: OperationRequest) =>
  options.body === undefined
    ? {
        ...request.params,
        ...request.query,
        ...(request.payload as object | undefined),
      }
    : { ...request.params, [options.body]: request.payload };

type OperationsOf<Group extends OperationBinding> =
  Group[typeof operationBinding]["operations"];

type OutputAdapter<Output = unknown, Services = unknown> = (
  output: Output
) => Effect.Effect<Output, never, Services>;

/** Adapts some operations' outputs for the caller. */
type OutputAdapters<Ops extends Operations> = {
  readonly [Name in keyof Ops & string]?: OutputAdapter<
    OperationOutput<Ops[Name]>
  >;
};

type OutputServices<Outputs> = {
  readonly [Name in keyof Outputs]: Outputs[Name] extends (
    output: never
  ) => Effect.Effect<infer _Output, infer _Error, infer Services>
    ? Services
    : never;
}[keyof Outputs];

/**
 * Serves every endpoint of an operation group by running the operation of
 * its name on the input its request carries. `outputs` adapts an
 * operation's output for the caller, as withholding what an older `dhw`
 * can't decode.
 */
export const operationGroupHandlers = <
  ApiId extends string,
  Groups extends HttpApiGroup.Any,
  Group extends Groups & OperationBinding,
  Failure extends HttpApiEndpoint.Errors<HttpApiGroup.Endpoints<Group>>,
  E,
  R,
  Services,
  Outputs extends OutputAdapters<OperationsOf<Group>> = NoOptions,
>(
  api: HttpApi.HttpApi<ApiId, Groups>,
  group: Group,
  invoker: Effect.Effect<
    OperationInvoke<OperationsOf<Group>, Failure, Services>,
    E,
    R
  >,
  outputs?: Outputs
) => {
  const { routes } = group[operationBinding];
  const serve =
    (invoke: OperationInvoke<OperationsOf<Group>, Failure, Services>) =>
    ([name, operationRoute]: [string, OperationRoute]) =>
    (request: OperationRequest) => {
      const output = invoke(name, inputOf(operationRoute, request) as never);
      const adapt: OutputAdapter | undefined = outputs?.[name];
      return adapt === undefined ? output : Effect.flatMap(output, adapt);
    };
  type Served = HttpApiBuilder.Handlers<
    ServedRequirements<
      HttpApiGroup.Endpoints<Group>,
      Services | OutputServices<Outputs>
    >,
    never
  >;
  return HttpApiBuilder.group(
    api,
    group.identifier as HttpApiGroup.Name<Group>,
    (handlers) =>
      Effect.map(invoker, (invoke) =>
        // `HttpApiBuilder` types each `handle` by an endpoint name known at
        // compile time; these are the group's own routes, read at run time.
        Object.entries<OperationRoute>(routes).reduce<Served>(
          (served, entry): Served =>
            served.handle(
              entry[0] as never,
              serve(invoke)(entry) as never
            ) as never,
          handlers as never
        )
      )
  );
};
