import Image from "next/image";
import logoImage from "@/assets/images/logo.png";
import { LanguageSwitcher } from "@/components/language-switcher";
import { Button } from "@/components/ui/button";
import { m } from "@/i18n";

export function Header() {
  return (
    <header className="bg-black text-white px-6 sticky top-0 z-20 h-[var(--header-height)] flex items-center justify-center">
      <div className="flex items-center justify-between max-w-7xl w-full">
        <Image src={logoImage} alt="Deskohub" width={100} height={80} />
        <nav className="hidden md:flex space-x-8">
          <a href="#home" className="hover:text-green-400 transition-colors">
            {m["nav.home"]()}
          </a>
          <a href="#" className="hover:text-green-400 transition-colors">
            {m["nav.boardGames"]()}
          </a>
          <a href="#" className="hover:text-green-400 transition-colors">
            {m["nav.gallery"]()}
          </a>
          <a href="#" className="hover:text-green-400 transition-colors">
            {m["nav.menu"]()}
          </a>
          <a href="#" className="hover:text-green-400 transition-colors">
            {m["nav.trainingRoom"]()}
          </a>
          <a href="#" className="hover:text-green-400 transition-colors">
            {m["nav.contact"]()}
          </a>
        </nav>
        <div className="flex items-center space-x-4">
          <LanguageSwitcher />
          <Button className="bg-green-500 hover:bg-green-600 text-white">
            {m["buttons.reservation"]()}
          </Button>
        </div>
      </div>
    </header>
  );
}
