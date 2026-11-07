import { PasskeySignInOption } from "../src/auth/passkey/passkey-sign-in-option";
import { SignInScreen } from "../src/auth/sign-in-screen";

export default function SignInRoute() {
  return (
    <SignInScreen
      passkeyOption={(option) => <PasskeySignInOption {...option} />}
    />
  );
}
