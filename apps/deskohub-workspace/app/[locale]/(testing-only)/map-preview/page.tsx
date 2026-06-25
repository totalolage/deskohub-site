import { generateStaticMapImage } from "osm";
import { isLocale, m } from "@/features/i18n";
import { workspaceSiteConstants } from "@/shared/utils";

type WorkspaceMapPreviewPageProps = {
  params: Promise<{ locale: string }>;
};

export const dynamic = "force-dynamic";

const workspaceLocationMapWidth = 1200;
const workspaceLocationMapHeight = 640;
const workspaceMapUrl = `https://www.google.com/maps/dir/?api=1&destination=${workspaceSiteConstants.contact.coordinates.lat},${workspaceSiteConstants.contact.coordinates.lng}`;

export default async function WorkspaceMapPreviewPage({
  params,
}: WorkspaceMapPreviewPageProps) {
  const { locale } = await params;
  if (!isLocale(locale)) return null;

  const image = await generateStaticMapImage({
    lat: workspaceSiteConstants.contact.coordinates.lat,
    lng: workspaceSiteConstants.contact.coordinates.lng,
    width: workspaceLocationMapWidth,
    height: workspaceLocationMapHeight,
    zoom: 16,
    quality: 84,
  });
  const imageSrc = `data:image/jpeg;base64,${image.toString("base64")}`;

  return (
    <main className="min-h-screen bg-[#f4f1ea] px-4 py-10 text-[#00024f]">
      <div className="mx-auto max-w-[600px] rounded-[20px] border border-[#e6ded2] bg-[#f4f1ea] shadow-2xl shadow-navy-blue/12">
        <div className="px-5 py-[18px]">
          <div className="mb-[7px] font-extrabold text-[#006b55] text-xs uppercase tracking-[0.16em]">
            {m.checkoutEmailLocationHeading({}, { locale })}
          </div>
          <a
            className="inline-block font-bold text-[#00024f] text-[17px] leading-[1.45] no-underline"
            href={workspaceMapUrl}
            rel="noopener noreferrer"
            target="_blank"
          >
            {workspaceSiteConstants.contact.address.street},{" "}
            {workspaceSiteConstants.contact.address.postalCode}{" "}
            {workspaceSiteConstants.contact.address.city} -{" "}
            {workspaceSiteConstants.contact.address.cityDistrict}
          </a>
        </div>
        {/* biome-ignore lint/performance/noImgElement: Mirrors email HTML image attributes. */}
        <img
          alt={m.checkoutEmailLocationHeading({}, { locale })}
          src={imageSrc}
          style={{
            border: 0,
            display: "block",
            height: "auto",
            width: "100%",
          }}
          width="560"
        />
        <div className="bg-[#f4f1ea] px-5 pt-0 pb-[22px] text-center">
          <a
            className="relative z-[1] mt-[-24px] inline-block rounded-full border border-[#00024f] bg-[#00024f] px-7 py-3.5 text-center font-extrabold text-[#f4f1ea] text-[15px] leading-5 no-underline"
            href={workspaceMapUrl}
            rel="noopener noreferrer"
            target="_blank"
          >
            {m.checkoutEmailLocationMapLink({}, { locale })}
          </a>
        </div>
      </div>
    </main>
  );
}
