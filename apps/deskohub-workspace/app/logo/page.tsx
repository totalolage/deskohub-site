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

const SIZE = 64;

export default function Page() {
  return (
    <div className="flex flex-wrap gap-4 items-center justify-center bg-gray-500 min-h-screen">
      <Image src={darkBgSmall} alt="small dark background" width={SIZE} />
      <Image src={lightBgSmall} alt="small light background" width={SIZE} />
      <Image src={darkBgPlain} alt="plain dark background" width={SIZE} />
      <Image src={lightBgPlain} alt="plain light background" width={SIZE} />
      <Image src={darkBgCutout} alt="cutout dark background" width={SIZE} />
      <Image src={lightBgCutout} alt="cutout light background" width={SIZE} />
      <Image src={darkBgColor} alt="color dark background" width={SIZE} />
      <Image src={lightBgColor} alt="color light background" width={SIZE} />
      <Image src={darkBgFancy} alt="fancy dark background" width={SIZE} />
      <Image src={lightBgFancy} alt="fancy light background" width={SIZE} />
    </div>
  );
}
