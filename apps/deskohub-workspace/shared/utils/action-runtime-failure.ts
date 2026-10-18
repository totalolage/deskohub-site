/**
 * Failures the action runtime reports by itself, in place of a public error
 * from the action. Their messages are the `serverError` text the client
 * receives, so a client can recognise the failure and show its own copy.
 */
export const actionRuntimeFailureMessages = {
  /** The action outlived its deadline. */
  timeout: "Request timed out. Please try again.",
  /** A Zod schema rejected a value inside the action. */
  invalidInput: "Validation error occurred. Please check your input.",
  /** Any failure the action didn't make public, including defects. */
  unexpected: "Something went wrong while executing the operation.",
} as const;

type ActionRuntimeFailure = keyof typeof actionRuntimeFailureMessages;

const actionRuntimeFailures = Object.keys(
  actionRuntimeFailureMessages
) as readonly ActionRuntimeFailure[];

/** The runtime failure a `serverError` reports, if the runtime produced it. */
export const getActionRuntimeFailure = (
  serverError: string
): ActionRuntimeFailure | undefined =>
  actionRuntimeFailures.find(
    (failure) => actionRuntimeFailureMessages[failure] === serverError
  );

/**
 * The text to show for a failed action: the action's own public message, the
 * caller's copy for a runtime failure, or `fallback` when the server sent no
 * message or the caller has no copy for the failure.
 */
export const getActionFailureMessage = (
  serverError: string | undefined,
  copy: {
    readonly fallback: string;
  } & { readonly [Failure in ActionRuntimeFailure]?: string }
) => {
  if (serverError === undefined) return copy.fallback;
  const failure = getActionRuntimeFailure(serverError);
  if (failure === undefined) return serverError;
  return copy[failure] ?? copy.fallback;
};

/** A catalog message without inputs, rendered in the given locale. */
type LocalizedMessage<Locale> = (
  inputs: Record<string, never>,
  options: { readonly locale?: Locale }
) => string;

/**
 * An area's `getActionFailureMessage` in the operator's locale: the area's
 * catalog messages replace the runtime's English timeout and unexpected
 * failure, and anything else behaves as in `getActionFailureMessage`.
 */
export const createActionFailureMessage =
  <Locale extends string>(messages: {
    readonly timeout: LocalizedMessage<Locale>;
    readonly unexpected: LocalizedMessage<Locale>;
  }) =>
  (
    serverError: string | undefined,
    { fallback, locale }: { readonly fallback: string; readonly locale: Locale }
  ) =>
    getActionFailureMessage(serverError, {
      fallback,
      timeout: messages.timeout({}, { locale }),
      unexpected: messages.unexpected({}, { locale }),
    });
