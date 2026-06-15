import { Montserrat } from "next/font/google";
import Image from "next/image";
import { cn } from "@/shared/utils";
import mosaicaLabsLogo from "./mosaica-labs.svg";

const montserrat = Montserrat({
  subsets: ["latin"],
  weight: ["800"],
});

function MosaicaLabs({ className }: { className?: string }) {
  return (
    <div className={cn("flex flex-row gap-1 items-center", className)}>
      <Image
        alt="Mosaica Labs"
        src={mosaicaLabsLogo}
        className="size-12"
        style={{
          aspectRatio: `${mosaicaLabsLogo.width} / ${mosaicaLabsLogo.height}`,
        }}
      />
      <h2
        className={cn(
          "leading-none font-extrabold text-[#47060E] mt-1",
          montserrat.className
        )}
      >
        Mosaica
        <br />
        Labs
      </h2>
    </div>
  );
}

export default MosaicaLabs;
