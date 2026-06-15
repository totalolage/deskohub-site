import Image from "next/image";
import ErasmusPlus from "@/assets/images/partners/erasmus-plus-logo.png";
import PivoABurger from "@/assets/images/partners/pivo-a-burger-logo.png";
import UDKH from "@/assets/images/partners/udkh-logo.png";
import ZazitMestoJinak from "@/assets/images/partners/zazit-mesto-jinak-logo.svg";
import { m } from "@/features/i18n";
import MosaicaLabs from "@/features/partner-logos/mosaica-labs/MosaicaLabs";

/**
 * Partners banner section displaying partner logos and links
 * Displayed above the footer on the homepage
 */
export function PartnersBanner() {
  const partners = [
    <a
      key="Kudyznudy.cz"
      href="https://www.kudyznudy.cz/?utm_source=kzn&utm_medium=partneri_kzn&utm_campaign=banner"
      title="Kudyznudy.cz – tipy na výlet"
      target="_blank"
      rel="noopener noreferrer"
      className="transition-opacity hover:opacity-75"
    >
      <Image
        alt="Kudyznudy.cz – tipy na výlet"
        src="https://www.kudyznudy.cz/App_Themes/KzN/CSS/Images/svg/new-logo.svg"
        width={155}
        height={50}
      />
    </a>,
    <a
      key="UDKH"
      href="https://www.udkh.cz/"
      target="_blank"
      rel="noopener noreferrer"
    >
      <Image
        alt="UDKH"
        className="h-auto object-contain"
        src={UDKH}
        width={64}
        height={50.5}
      />
    </a>,
    <MosaicaLabs key="Mosaica Labs" />,
    <a
      key="Zazit mesto jinak"
      href="https://zazitmestojinak.cz/"
      target="_blank"
      rel="noopener noreferrer"
    >
      <Image
        alt="Zazit mesto jinak"
        className="h-auto object-contain"
        src={ZazitMestoJinak}
        width={41}
        height={64}
      />
    </a>,
    <a
      key="Erasmus Plus"
      href="https://erasmus-plus.ec.europa.eu/"
      target="_blank"
      rel="noopener noreferrer"
    >
      <Image
        alt="Erasmus Plus"
        className="h-auto object-contain"
        src={ErasmusPlus}
        width={155}
        height={50}
      />
    </a>,
    <a
      key="Pivo a Burger"
      href="http://www.pivoaburger.cz/"
      target="_blank"
      rel="noopener noreferrer"
    >
      <Image
        alt="Pivo a Burger"
        className="h-auto object-contain"
        src={PivoABurger}
        width={64}
        height={64}
      />
    </a>,
  ];

  return (
    <section className="pt-6 pb-12 bg-gray-50">
      <div className="container">
        <h2 className="text-center text-2xl font-bold mb-5 text-gray-800/30">
          {m["partners.title"]()}
        </h2>
        <div className="flex flex-wrap justify-center items-center gap-x-8 gap-y-4">
          {partners}
        </div>
      </div>
    </section>
  );
}
