import { describe, expect, mock, test } from "bun:test";
import {
  afterNextPasskeySignInOptions,
  reportPasskeySignInOptions,
} from "./passkey-sign-in-options";

const response = (url: string) => ({ request: { url } });

describe("passkey sign-in options", () => {
  test("tells each waiting listener once, at the next options response", () => {
    // Better Auth reports a relative or an absolute request URL.
    const first = mock(() => undefined);
    const second = mock(() => undefined);
    afterNextPasskeySignInOptions(first);
    afterNextPasskeySignInOptions(second);

    reportPasskeySignInOptions(
      response("/api/auth/passkey/generate-authenticate-options")
    );
    reportPasskeySignInOptions(
      response(
        "https://workspace.invalid/api/auth/passkey/generate-authenticate-options"
      )
    );

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  test("ignores other auth responses and listeners that stopped waiting", () => {
    const stopped = mock(() => undefined);
    const waiting = mock(() => undefined);
    afterNextPasskeySignInOptions(stopped)();
    const stopWaiting = afterNextPasskeySignInOptions(waiting);

    reportPasskeySignInOptions(
      response("/api/auth/passkey/generate-register-options")
    );
    reportPasskeySignInOptions(response("/api/auth/get-session"));
    expect(waiting).not.toHaveBeenCalled();

    reportPasskeySignInOptions(
      response(
        new URL(
          "https://workspace.invalid/api/auth/passkey/generate-authenticate-options"
        )
      )
    );
    expect(waiting).toHaveBeenCalledTimes(1);
    expect(stopped).not.toHaveBeenCalled();
    stopWaiting();
  });
});
