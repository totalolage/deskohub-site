import Image from "next/image";
import Link from "next/link";
import { siFacebook, siInstagram, siYoutube } from "simple-icons";
import logoImage from "@/assets/images/logo/for-light-bg.png";
import { getLocale, m } from "@/features/i18n";
import { siteConstants } from "@/shared/utils/constants";

export function Footer() {
  const locale = getLocale();

  return (
    <footer className="bg-white py-8 border-t">
      <div className="max-w-7xl mx-auto px-6">
        <div className="flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex space-x-2">
            <Image
              src={logoImage}
              alt={siteConstants.brand.name}
              className="h-12 w-auto"
            />
            <div>
              <div className="font-bold">{siteConstants.brand.name}</div>
              <div className="text-sm text-gray-600">
                {m["footer.tagline"]()}
              </div>
              <div className="flex flex-wrap gap-4 mt-2">
                <a
                  href={siteConstants.social.youtube}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-red-500"
                >
                  <svg height={18} viewBox="0 0 24 24" fill="currentColor">
                    <title>{m["footer.socialLinks.youtube"]()}</title>
                    <path d={siYoutube.path} />
                  </svg>
                </a>
                <a
                  href={siteConstants.social.facebook}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-500"
                >
                  <svg height={18} viewBox="0 0 24 24" fill="currentColor">
                    <title>{m["footer.socialLinks.facebook"]()}</title>
                    <path d={siFacebook.path} />
                  </svg>
                </a>
                <a
                  href={siteConstants.social.instagram}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-pink-500"
                >
                  <svg height={18} viewBox="0 0 24 24" fill="currentColor">
                    <title>{m["footer.socialLinks.instagram"]()}</title>
                    <path d={siInstagram.path} />
                  </svg>
                </a>
              </div>
            </div>
          </div>
          <div className="text-sm text-gray-600 text-right">
            <Link href={`/${locale}/cookie-settings`}>
              {m["cookieSettings.buttons.managePreferences"]()}
            </Link>
            <br />
            <Link href={`/${locale}/gdpr`}>{m["footer.gdprLink"]()}</Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
