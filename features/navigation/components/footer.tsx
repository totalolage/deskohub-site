import Image from "next/image";
import logoImage from "@/assets/images/logo/for-light-bg.png";
import { m } from "@/i18n";
import { siteConstants } from "@/shared/utils/constants";

export function Footer() {
  return (
    <footer className="bg-white py-8 border-t">
      <div className="max-w-7xl mx-auto px-6">
        <div className="flex flex-col md:flex-row items-center justify-between">
          <div className="flex items-center space-x-2 mb-4 md:mb-0">
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
          <div className="flex space-x-6 text-sm text-gray-600">
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
          </div>
        </div>
      </div>
    </footer>
  );
}
