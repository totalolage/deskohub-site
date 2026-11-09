import { useFocusEffect, useRouter } from "expo-router";
import { useCallback } from "react";
import { returnToAccountRoot } from "./account-root";

/**
 * An Account section that has nothing to show for this account sends the
 * customer back to the Account root once it's in view, like a `Redirect`
 * but back down the stack (see `returnToAccountRoot`).
 */
export function ReturnToAccountRoot() {
  const router = useRouter();
  useFocusEffect(
    useCallback(() => {
      returnToAccountRoot(router);
    }, [router])
  );
  return null;
}
