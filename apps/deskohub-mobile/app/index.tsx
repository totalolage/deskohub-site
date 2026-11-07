import { Redirect } from "expo-router";

/** The signed-in app opens on the customer's reservations. */
export default function IndexRoute() {
  return <Redirect href="/reservations" />;
}
