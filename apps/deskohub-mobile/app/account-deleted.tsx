import { AccountDeletedScreen } from "../src/account/danger/account-deleted-screen";

// Outside the signed-in guard: deleting the account ends the session, and
// this confirmation must still show afterwards.
export default function AccountDeletedRoute() {
  return <AccountDeletedScreen />;
}
