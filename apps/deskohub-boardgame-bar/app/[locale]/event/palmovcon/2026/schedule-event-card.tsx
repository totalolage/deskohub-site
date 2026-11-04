import { CloudinaryImage } from "@deskohub/cloudinary-image";
import { Button } from "@/shared/components/ui/button";
import { cn } from "@/shared/utils";
import type { ScheduleEventImages } from "./event-images";
import type { ScheduleItem } from "./schedule";

/** The mobile layout shows the mobile variant, falling back to the desktop image. */
export const getMobileEventImage = ({
  image,
  blurDataURL,
}: ScheduleEventImages) => {
  if (image.mobile) {
    return { source: image.mobile, blurDataURL: blurDataURL.mobile };
  }
  if (image.desktop) {
    return { source: image.desktop, blurDataURL: blurDataURL.desktop };
  }
  return undefined;
};

function ScheduleEventHeading({
  time,
  title,
  overImage,
}: {
  time: string;
  title: string;
  overImage: boolean;
}) {
  return (
    <div
      className={cn(
        overImage &&
          "absolute top-0 right-0 left-0 z-10 bg-[linear-gradient(#000000E0,transparent)] px-6 pt-6 pb-10 lg:static lg:p-0 lg:[background-image:unset]"
      )}
    >
      <p
        className={cn(
          "font-bold",
          overImage
            ? "text-[#FFFFFE]/85 drop-shadow-[0_1px_10px_rgba(0,0,0,0.65)] lg:text-[#060852]/80 lg:drop-shadow-none"
            : "text-[#060852]/80"
        )}
      >
        {time}
      </p>
      <h3
        className={cn(
          "mt-3 font-black",
          overImage
            ? "text-3xl text-[#FFFFFE] lg:max-w-none md:max-w-[50%] max-w-[66%] drop-shadow-[0_2px_16px_rgba(0,0,0,0.75)] lg:text-2xl lg:text-[#23221E] lg:drop-shadow-none"
            : "text-2xl text-[#23221E]"
        )}
      >
        {title}
      </h3>
    </div>
  );
}

function ScheduleEventActions({
  cta,
  note,
}: Pick<ScheduleItem, "cta" | "note">) {
  return (
    <div className="flex flex-col gap-3 lg:items-end">
      {cta && (
        <Button
          asChild
          className="h-12 rounded-full bg-[#899E28] px-6 font-bold text-[#060852] hover:bg-[#6DAA9C]"
        >
          <a href={cta.href} rel="noreferrer" target="_blank">
            {cta.label}
          </a>
        </Button>
      )}
      {note && (
        <p className="rounded-2xl bg-[#899E28]/20 px-4 py-3 font-semibold text-[#060852] lg:max-w-64">
          {note}
        </p>
      )}
    </div>
  );
}

export function ScheduleEventCard({
  item,
  images,
}: {
  item: ScheduleItem;
  images: ScheduleEventImages;
}) {
  const mobileImage = getMobileEventImage(images);
  const desktopImage = images.image.desktop;

  return (
    <article className="relative overflow-hidden rounded-[1.75rem] border border-[#6DAA9C]/20 bg-[#FFFFFE] text-[#060852] shadow-xl shadow-[#060852]/25">
      {mobileImage && (
        <CloudinaryImage
          aria-hidden="true"
          alt=""
          source={mobileImage.source}
          blurDataURL={mobileImage.blurDataURL}
          className="pointer-events-none absolute inset-x-0 top-0 h-[300px] w-full select-none lg:hidden"
          preload={false}
          sizes="100vw"
          style={{
            objectFit: "cover",
            objectPosition: "center right",
            maskImage:
              "linear-gradient(180deg, black 0%, black 50%, transparent 100%)",
            WebkitMaskImage:
              "linear-gradient(180deg, black 0%, black 50%, transparent 100%)",
          }}
          variant="full"
        />
      )}
      {desktopImage && (
        <CloudinaryImage
          aria-hidden="true"
          alt=""
          source={desktopImage}
          blurDataURL={images.blurDataURL.desktop}
          className="pointer-events-none absolute inset-y-0 left-0 hidden h-full w-auto max-w-full select-none lg:block"
          preload={false}
          sizes="40vw"
          style={{
            objectPosition: "left center",
            maskImage:
              "linear-gradient(90deg, black 0%, black 33%, transparent 100%)",
            WebkitMaskImage:
              "linear-gradient(90deg, black 0%, black 33%, transparent 100%)",
          }}
          variant="full"
        />
      )}
      <div
        className={cn(
          "relative grid gap-6 lg:grid-cols-[1fr_auto] lg:items-center",
          mobileImage
            ? "px-6 pt-80 pb-6 sm:px-8 sm:pt-[300px] sm:pb-8"
            : "p-6 sm:p-8",
          desktopImage
            ? "lg:min-h-[18rem] lg:py-8 lg:pr-8 lg:pl-[40%]"
            : "lg:p-8"
        )}
      >
        <div>
          <ScheduleEventHeading
            time={item.time}
            title={item.title}
            overImage={mobileImage !== undefined}
          />
          <p className="mt-4 max-w-2xl text-[#060852]/75 leading-7">
            {item.description}
          </p>
        </div>
        {(item.cta || item.note) && (
          <ScheduleEventActions cta={item.cta} note={item.note} />
        )}
      </div>
    </article>
  );
}
