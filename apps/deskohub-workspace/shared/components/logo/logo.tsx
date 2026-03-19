import darkBgColor from "assets/logo/color-bg:dark.svg";
import lightBgColor from "assets/logo/color-bg:light.svg";
import darkBgCutout from "assets/logo/cutout-bg:dark.svg";
import lightBgCutout from "assets/logo/cutout-bg:light.svg";
import darkBgFancy from "assets/logo/fancy-bg:dark.svg";
import lightBgFancy from "assets/logo/fancy-bg:light.svg";
import darkBgPlain from "assets/logo/plain-bg:dark.svg";
import lightBgPlain from "assets/logo/plain-bg:light.svg";
import darkBgSmall from "assets/logo/small-bg:dark.svg";
import lightBgSmall from "assets/logo/small-bg:light.svg";
import Image from "next/image";
import type { ComponentProps } from "react";

const logo = [
  {
    color: "dark" as const,
    variant: "color" as const,
    image: darkBgColor,
  },
  {
    color: "dark" as const,
    variant: "cutout" as const,
    image: darkBgCutout,
  },
  {
    color: "dark" as const,
    variant: "fancy" as const,
    image: darkBgFancy,
  },
  {
    color: "dark" as const,
    variant: "plain" as const,
    image: darkBgPlain,
  },
  {
    color: "dark" as const,
    variant: "small" as const,
    image: darkBgSmall,
  },
  {
    color: "light" as const,
    variant: "color" as const,
    image: lightBgColor,
  },
  {
    color: "light" as const,
    variant: "cutout" as const,
    image: lightBgCutout,
  },
  {
    color: "light" as const,
    variant: "fancy" as const,
    image: lightBgFancy,
  },
  {
    color: "light" as const,
    variant: "plain" as const,
    image: lightBgPlain,
  },
  {
    color: "light" as const,
    variant: "small" as const,
    image: lightBgSmall,
  },
];

export type LogoStyling = {
  color: (typeof logo)[number]["color"];
  variant: (typeof logo)[number]["variant"];
};

export default function Logo({
  styling,
  width: passedWidth,
  height: passedHeight,
  ...props
}: {
  styling: LogoStyling;
} & Omit<ComponentProps<typeof Image>, "src" | "alt">) {
  const {
    image: { src, width: imageWidth, height: imageHeight },
  } = logo.find(
    (l) => l.color === styling.color && l.variant === styling.variant
  )!;

  const aspectRatio = imageWidth / imageHeight;

  const width =
    passedWidth ||
    (passedHeight ? Number(passedHeight) * aspectRatio : imageWidth);
  const height =
    passedHeight ||
    (passedWidth ? Number(passedWidth) / aspectRatio : imageHeight);

  return (
    <Image src={src} alt="logo" {...props} width={width} height={height} />
  );
}
