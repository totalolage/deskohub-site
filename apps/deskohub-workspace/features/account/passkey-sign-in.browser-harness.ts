import {
  type PasskeySignInResponse,
  requestPasskeySignIn,
} from "./passkey-sign-in";

/*
 * The page side of the passkey sign-in browser test: `armAutofill` starts an
 * autofill attempt the way a sign-in card does, `pressButton` the button's,
 * and `passkeyOutcomes` lists how each settled.
 */

const passkeyOutcomes: string[] = [];

const readOutcome = ({ error }: PasskeySignInResponse) =>
  error === null ? "signed in" : (error.code ?? "failed");

const start = (name: string, autoFill: boolean) => {
  void requestPasskeySignIn({ autoFill }).then(
    (response) => passkeyOutcomes.push(`${name} ${readOutcome(response)}`),
    () => passkeyOutcomes.push(`${name} threw`)
  );
};

Object.assign(globalThis, {
  passkeyOutcomes,
  armAutofill: () => start("autofill", true),
  pressButton: () => start("button", false),
});
