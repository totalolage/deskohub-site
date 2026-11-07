import { PlaceholderScreen } from "../src/ui/placeholder-screen";

// Outside the signed-in guard: deleting the account ends the session, and
// this confirmation must still show afterwards.
export default function AccountDeletedRoute() {
  return <PlaceholderScreen />;
}
