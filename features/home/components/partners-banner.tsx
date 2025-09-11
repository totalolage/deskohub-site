import Image from "next/image";
import { m } from "@/features/i18n";

const partners = [
  {
    name: "Kudyznudy.cz",
    title: "Kudyznudy.cz – tipy na výlet",
    url: "https://www.kudyznudy.cz/?utm_source=kzn&utm_medium=partneri_kzn&utm_campaign=banner",
    logoUrl:
      "https://www.kudyznudy.cz/App_Themes/KzN/CSS/Images/svg/new-logo.svg",
    width: 150,
    height: 33,
  },
];

/**
 * Partners banner section displaying partner logos and links
 * Displayed above the footer on the homepage
 */
export function PartnersBanner() {
  return (
    <section className="pt-6 pb-12 bg-gray-50">
      <div className="container">
        <h2 className="text-center text-2xl font-bold mb-5 text-gray-800/30">
          {m["partners.title"]()}
        </h2>
        <div className="flex flex-wrap justify-evenly items-center gap-8">
          {partners.map((partner) => (
            <a
              key={partner.name}
              href={partner.url}
              title={partner.title}
              target="_blank"
              rel="noopener noreferrer"
              className="transition-opacity hover:opacity-75"
            >
              <Image
                src={partner.logoUrl}
                alt={partner.title}
                width={partner.width}
                height={partner.height}
                className="h-auto"
                unoptimized
              />
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}
