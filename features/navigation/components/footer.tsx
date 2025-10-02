import Image from "next/image";
import Link from "next/link";
import logoImage from "@/assets/images/logo/for-light-bg.png";
import { getLocale, m } from "@/features/i18n";
import { siteConstants } from "@/shared/utils/constants";

export function Footer() {
  const locale = getLocale();

  return (
    <footer className="bg-white py-8 border-t">
      <div className="max-w-7xl mx-auto px-6">
        <div className="flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center space-x-2">
            <Image
              src={logoImage}
              alt={siteConstants.brand.name}
              width={24}
              height={24}
              className="w-6 h-6"
            />
            <div>
              <div className="font-bold">{siteConstants.brand.name}</div>
              <div className="text-sm text-gray-600">
                {m["footer.tagline"]()}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap justify-center gap-4 md:gap-6 text-sm text-gray-600">
            <a
              href={siteConstants.social.youtube}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-green-500"
            >
              {m["footer.socialLinks.youtube"]()}
            </a>
            <a
              href={siteConstants.social.facebook}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-green-500"
            >
              {m["footer.socialLinks.facebook"]()}
            </a>
            <a
              href={siteConstants.social.instagram}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-green-500"
            >
              {m["footer.socialLinks.instagram"]()}
            </a>
            <Link
              href={`/${locale}/cookie-settings`}
              className="hover:text-green-500"
            >
              {m["cookieSettings.buttons.managePreferences"]()}
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
