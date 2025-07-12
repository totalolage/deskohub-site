import Image from "next/image";
import placeholderImage from "@/assets/images/placeholder/placeholder.svg";
import { Button } from "@/shared/components/ui/button";
import { m } from "@/i18n";

export function Location() {
  return (
    <section className="py-16 bg-white">
      <div className="max-w-7xl mx-auto px-6">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
          <div>
            <h2 className="text-4xl md:text-5xl font-bold text-gray-900 mb-8 leading-tight">
              {m["locationSection.title"]()}
              <br />
              {m["locationSection.subtitle"]()}
            </h2>
            <Button className="bg-transparent border-2 border-gray-900 text-gray-900 hover:bg-gray-900 hover:text-white px-8 py-3 rounded-full">
              {m["buttons.ourLocation"]()}
            </Button>
          </div>
          <div className="rounded-lg overflow-hidden">
            <Image
              src={placeholderImage}
              alt={m["altText.barLocation"]()}
              width={600}
              height={400}
              className="w-full h-full object-cover"
            />
          </div>
        </div>
      </div>
    </section>
  );
}
