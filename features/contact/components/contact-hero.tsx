import Image from "next/image";
import { m } from "@/i18n";

export function ContactHero() {
  return (
    <div className="relative py-32 overflow-hidden">
      <Image
        src="/images/hero.jpg"
        alt={m["contact.heroImageAlt"]()}
        fill
        className="object-cover"
      />
      <div className="absolute inset-0 bg-black/60" />
      <div className="relative z-10 flex items-center justify-center h-full">
        <div className="text-center">
          <h1 className="text-5xl md:text-6xl font-bold text-green-400 mb-4">
            {m["contact.heroTitle"]()}
          </h1>
          <p className="text-xl text-white max-w-2xl mx-auto">
            {m["contact.heroSubtitle"]()}
          </p>
        </div>
      </div>
    </div>
  );
}
