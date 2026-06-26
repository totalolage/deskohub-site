"use client";

import { Menu } from "lucide-react";
import Image from "next/image";
import { useState } from "react";
import logoImage from "@/assets/images/logo/for-dark-bg.png";
import { LanguageSwitcher, LocalizedLink, m, setLocale } from "@/features/i18n";
import { useLocale } from "@/features/i18n/utils/use-locale";
import { Button } from "@/shared/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/shared/components/ui/sheet";
import { siteConstants } from "@/shared/utils/constants";
import {
  getWeekdayHours,
  getWeekendHours,
} from "@/shared/utils/working-hours-helpers";
import { ReservationButton } from "./reservation-button";

const navigationItems = [
  { label: "nav.home", href: "/", text: () => m["nav.home"]() },
  {
    label: "nav.boardGames",
    href: "/board-games",
    text: () => m["nav.boardGames"](),
  },
  { label: "nav.gallery", href: "/gallery", text: () => m["nav.gallery"]() },
  { label: "nav.menu", href: "/menu", text: () => m["nav.menu"]() },
  { label: "nav.contact", href: "/contact", text: () => m["nav.contact"]() },
];

export function MobileMenu() {
  const [isOpen, setIsOpen] = useState(false);
  const locale = useLocale();
  const ttrpgRoomHref = `https://workspace.deskohub.cz/${locale}/ttrpg-room`;
  setLocale(locale, { reload: false });

  return (
    <div className="xl:hidden">
      <Sheet open={isOpen} onOpenChange={setIsOpen}>
        <SheetTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="text-white hover:text-white hover:bg-white/10"
          >
            <Menu className="h-6 w-6" />
            <span className="sr-only">{m["nav.openMenu"]()}</span>
          </Button>
        </SheetTrigger>
        <SheetContent
          side="right"
          className="w-80 bg-gray-900 border-gray-800 safe-padding-vertical"
          xClassName="text-white"
        >
          <SheetHeader className="border-b border-gray-800 pb-4">
            <div className="flex items-center gap-3">
              <Image
                src={logoImage}
                alt={m["altText.deskohub"]()}
                width={40}
                height={40}
                className="rounded-lg"
                priority
              />
              <SheetTitle className="text-white text-lg font-bold">
                {siteConstants.brand.name}
              </SheetTitle>
            </div>
          </SheetHeader>

          <nav className="flex flex-col gap-2 mt-6">
            {navigationItems.map((item) => (
              <LocalizedLink
                key={item.label}
                href={item.href}
                className="flex items-center px-4 py-3 text-gray-300 hover:text-white hover:bg-gray-800 rounded-lg transition-colors duration-200 font-medium"
                onClick={() => setIsOpen(false)}
              >
                {item.text()}
              </LocalizedLink>
            ))}
            <a
              href={ttrpgRoomHref}
              className="flex items-center px-4 py-3 text-gray-300 hover:text-white hover:bg-gray-800 rounded-lg transition-colors duration-200 font-medium"
              onClick={() => setIsOpen(false)}
            >
              {m["nav.trainingRoom"]()}
            </a>
          </nav>

          <div className="mt-8 space-y-4">
            <div className="px-4 py-3 bg-gray-800 rounded-lg">
              <h3 className="text-white font-semibold mb-2">
                {m["menu.openingHours.title"]()}
              </h3>
              <div className="text-sm text-gray-300 space-y-1">
                <div className="flex justify-between">
                  <span>{m["menu.openingHours.weekdays"]()}</span>
                  <span className="text-green-400">
                    {m["menu.openingHours.weekdaysTime"]({
                      hours: getWeekdayHours().formatted,
                    })}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>{m["menu.openingHours.weekend"]()}</span>
                  <span className="text-green-400">
                    {m["menu.openingHours.weekendTime"]({
                      hours: getWeekendHours().formatted,
                    })}
                  </span>
                </div>
              </div>
            </div>

            <div className="px-4">
              <LanguageSwitcher />
            </div>

            <div className="px-4">
              <ReservationButton
                variant="full"
                showIcon={true}
                onClick={() => setIsOpen(false)}
              />
            </div>
          </div>

          <div className="absolute bottom-6 left-6 right-6">
            <div className="text-center text-xs text-gray-500">
              <p>{m["footer.tagline"]()}</p>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
