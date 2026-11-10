import {
  type LoadingDieMotion,
  loadingDieBox,
  loadingDieBrandGradient,
  loadingDieFrame,
  loadingDieTiming,
} from "@deskohub/brand-motion/loading-die";
import { useEffect, useId, useState } from "react";
import { View } from "react-native";
import {
  type LoadingIndicatorProps,
  loadingIndicatorFill,
  loadingIndicatorLayout,
  loadingIndicatorSemantics,
} from "./loading-indicator-presentation";
import { useReducedMotion } from "./reduced-motion";

/**
 * The Deskohub loading die, drawn as SVG frame by frame: the web has no
 * Lottie player without a renderer fetched from elsewhere, and the frames
 * come from the same document the native player plays. It shows the still
 * logo while the browser asks for reduced motion, and until that is known.
 */
export function LoadingIndicator({ size, tone, label }: LoadingIndicatorProps) {
  const { motion, width, height } = loadingIndicatorLayout(size);
  const box = loadingDieBox(motion);
  const frame = loadingDieFrame(
    motion,
    useLoopFrame(useReducedMotion() === false)
  );
  const fill = loadingIndicatorFill(tone);
  const gradientId = `loading-die-${useId().replace(/[^\w-]/g, "")}`;
  return (
    <View {...loadingIndicatorSemantics(label)} style={{ width, height }}>
      <svg
        aria-hidden
        width={width}
        height={height}
        viewBox={`0 0 ${box.width} ${box.height}`}
      >
        {fill.kind === "brand" && (
          <BrandGradient id={gradientId} motion={motion} />
        )}
        <g
          transform={frame.transform}
          fill={fill.kind === "brand" ? `url(#${gradientId})` : fill.color}
        >
          {frame.faces.map((face, index) => (
            // Only the visible faces are listed, so their order is the key.
            // biome-ignore lint/suspicious/noArrayIndexKey: see above
            <path key={index} d={face} />
          ))}
        </g>
      </svg>
    </View>
  );
}

function BrandGradient({
  id,
  motion,
}: {
  readonly id: string;
  readonly motion: LoadingDieMotion;
}) {
  const { from, to } = loadingDieBrandGradient(motion);
  return (
    <defs>
      <linearGradient
        id={id}
        gradientUnits="userSpaceOnUse"
        x1={from.x}
        y1={from.y}
        x2={to.x}
        y2={to.y}
      >
        <stop offset={0} stopColor={from.color} />
        <stop offset={1} stopColor={to.color} />
      </linearGradient>
    </defs>
  );
}

/**
 * The loop's current frame while `playing`, advanced on each animation frame
 * at the motion's frame rate; frame 0 otherwise.
 */
function useLoopFrame(playing: boolean): number {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    if (!playing) return;
    const { framesPerSecond, frameCount } = loadingDieTiming;
    let start: number | undefined;
    let request = 0;
    const advance = (now: number) => {
      start ??= now;
      setFrame((((now - start) / 1000) * framesPerSecond) % frameCount);
      request = requestAnimationFrame(advance);
    };
    request = requestAnimationFrame(advance);
    return () => cancelAnimationFrame(request);
  }, [playing]);
  return playing ? frame : 0;
}
