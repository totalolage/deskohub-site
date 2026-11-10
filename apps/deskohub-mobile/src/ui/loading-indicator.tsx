import { loadingDieAnimation } from "@deskohub/brand-motion/loading-die";
import LottieView, { type AnimationObject } from "lottie-react-native";
import { useEffect, useRef } from "react";
import { View } from "react-native";
import {
  type LoadingIndicatorProps,
  loadingIndicatorFill,
  loadingIndicatorLayout,
  loadingIndicatorSemantics,
} from "./loading-indicator-presentation";
import { useReducedMotion } from "./reduced-motion";

/**
 * The Deskohub loading die, played by Lottie. It shows the still logo while
 * the device asks for reduced motion, and until it is known whether it does.
 */
export function LoadingIndicator({ size, tone, label }: LoadingIndicatorProps) {
  const { motion, width, height } = loadingIndicatorLayout(size);
  const animates = useReducedMotion() === false;
  const player = useRef<LottieView>(null);
  // Autoplay applies only when the player loads its document, and turning it
  // off doesn't stop a playing animation, so the player is told either way.
  useEffect(() => {
    if (animates) player.current?.play();
    else player.current?.reset();
  }, [animates]);
  // The same motion and fill give the same document, so the player keeps it.
  const animation = loadingDieAnimation({
    motion,
    fill: loadingIndicatorFill(tone),
  });
  return (
    <View {...loadingIndicatorSemantics(label)} style={{ width, height }}>
      <LottieView
        ref={player}
        // A Lottie document; the player's type lists only some of its fields.
        source={animation as unknown as AnimationObject}
        autoPlay={animates}
        loop
        // The hardware path skips anti-aliasing on some GPUs; the die is small.
        renderMode="SOFTWARE"
        style={{ width, height }}
      />
    </View>
  );
}
