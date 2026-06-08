import type { ValueOf } from "next/constants";
import type { CSSProperties } from "react";

export type VariableStyle<T extends string> = CSSProperties & {
  [K in T as `--${K}`]: ValueOf<CSSProperties>;
};
