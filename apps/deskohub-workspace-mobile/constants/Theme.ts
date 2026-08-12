/* The shared tokens mirror the approved Workspace App Figma system. */

import type { TextStyle } from "react-native";

export const palette = {
  ink: "#191C1D",
  secondaryInk: "#584236",
  neutralInk: "#454749",
  canvas: "#F8F9FA",
  surface: "#FFFFFF",
  surfaceMuted: "#F3F4F5",
  disabledInk: "#D9DADB",
  navigationActive: "#EF6C00",
  action: "#9C4400",
  actionInk: "#4D1E00",
  warningInk: "#B06000",
  positiveInk: "#137333",
  danger: "#BA1A1A",
  dangerInk: "#93000A",
  dangerSurface: "#FFDAD6",
  warningSurface: "#FEF7E0",
  successSurface: "#E6F4EA",
  infoSurface: "#E7E8E9",
  outline: "#E0C0B0",
  white: "#FFFFFF",
} as const;

export const spacing = {
  xxs: 4,
  xs: 8,
  sm: 12,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

export const radii = {
  sm: 4,
  md: 8,
  lg: 12,
  full: 999,
} as const;

export const type = {
  display: {
    fontFamily: "HankenGrotesk",
    fontSize: 32,
    lineHeight: 40,
    fontWeight: "700",
    letterSpacing: -0.64,
  } satisfies TextStyle,
  headline: {
    fontFamily: "HankenGrotesk",
    fontSize: 24,
    lineHeight: 32,
    fontWeight: "700",
  } satisfies TextStyle,
  title: {
    fontFamily: "HankenGrotesk",
    fontSize: 20,
    lineHeight: 28,
    fontWeight: "600",
  } satisfies TextStyle,
  body: {
    fontFamily: "HankenGrotesk",
    fontSize: 16,
    lineHeight: 24,
    fontWeight: "400",
  } satisfies TextStyle,
  bodyStrong: {
    fontFamily: "HankenGrotesk",
    fontSize: 16,
    lineHeight: 24,
    fontWeight: "600",
  } satisfies TextStyle,
  label: {
    fontFamily: "HankenGrotesk",
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "600",
    letterSpacing: 0.6,
  } satisfies TextStyle,
  caption: {
    fontFamily: "HankenGrotesk",
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "400",
  } satisfies TextStyle,
} as const;
