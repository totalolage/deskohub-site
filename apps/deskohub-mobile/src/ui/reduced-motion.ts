import { useEffect, useState } from "react";
import { AccessibilityInfo } from "react-native";

/**
 * Whether the device asks for reduced motion, following changes while the
 * component is mounted; `undefined` until the platform has answered, so a
 * caller can hold its animation until it knows. A query that fails leaves
 * the preference unknown.
 */
export function useReducedMotion(): boolean | undefined {
  const [reduced, setReduced] = useState<boolean>();
  useEffect(() => {
    let mounted = true;
    const subscription = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      setReduced
    );
    AccessibilityInfo.isReduceMotionEnabled().then(
      // A change reported before the query answered is the newer value.
      (enabled) => {
        if (mounted) setReduced((known) => known ?? enabled);
      },
      () => undefined
    );
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);
  return reduced;
}
