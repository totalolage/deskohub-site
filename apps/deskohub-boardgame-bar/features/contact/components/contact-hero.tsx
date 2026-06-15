import Interpolate from "@doist/react-interpolate";
import Link from "next/link";
import { m } from "@/features/i18n";
import { Hero } from "@/shared/components";

export function ContactHero() {
  return (
    <Hero tags="Kontakt" alignment="left">
      <div>
        <h1 className="text-5xl md:text-6xl font-bold text-green-400 mb-4">
          {m["contact.heroTitle"]()}
        </h1>
        <p className="text-xl text-white max-w-2xl">
          {m["contact.heroSubtitle"]()}
        </p>
        <p className="text-sm text-muted max-w-2xl mt-6">
          <Interpolate
            string={m["contact.heroTip"]()}
            mapping={{
              link: (text) => (
                <Link
                  href="#contact-form"
                  className="text-green-400 hover:text-green-300 underline"
                >
                  {text}
                </Link>
              ),
            }}
          />
        </p>
      </div>
    </Hero>
  );
}
