"use client";

/*
 * Marks the moment a passkey sign-in has its WebAuthn options. The Better
 * Auth client fetches them and starts the browser ceremony straight after,
 * with no hook of its own in between, so the auth client reports each
 * response here.
 */

const signInOptionsPath = "/passkey/generate-authenticate-options";

const listeners = new Set<() => void>();

/**
 * The auth client's response hook: tells every waiting listener that a
 * passkey sign-in options request has been answered.
 */
export const reportPasskeySignInOptions = ({
  request,
}: {
  readonly request: { readonly url: URL | string };
}) => {
  const { pathname } = new URL(request.url, "http://auth.invalid");
  if (!pathname.endsWith(signInOptionsPath)) return;
  const waiting = [...listeners];
  listeners.clear();
  for (const listener of waiting) listener();
};

/**
 * Runs `listener` once, at the next passkey sign-in options response. The
 * returned function stops waiting.
 */
export const afterNextPasskeySignInOptions = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
