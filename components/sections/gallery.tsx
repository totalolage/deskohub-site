import Image from "next/image";
import placeholderImage from "@/assets/images/placeholder/placeholder.svg";
import { m } from "@/i18n";

export function Gallery() {
  return (
    <section className="py-16 bg-amber-50">
      <div className="max-w-7xl mx-auto px-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-16">
          <div className="rounded-full overflow-hidden aspect-square">
            <Image
              src={placeholderImage}
              alt="Board games"
              width={300}
              height={300}
              className="w-full h-full object-cover"
            />
          </div>
          <div className="rounded-full overflow-hidden aspect-square">
            <Image
              src={placeholderImage}
              alt="Gaming area"
              width={300}
              height={300}
              className="w-full h-full object-cover"
            />
          </div>
          <div className="rounded-full overflow-hidden aspect-square">
            <Image
              src={placeholderImage}
              alt="Bar atmosphere"
              width={300}
              height={300}
              className="w-full h-full object-cover"
            />
          </div>
        </div>

        <div className="text-center max-w-4xl mx-auto">
          <p className="text-lg text-gray-700 leading-relaxed">
            {m["about.description"]()}
          </p>
        </div>
      </div>
    </section>
  );
}
