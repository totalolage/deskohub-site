import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { m } from "@/i18n";
import { Price } from "@/shared/components/price";
import { cn } from "@/shared/utils";
import { constants } from "@/shared/utils/constants";

export const TrainingPackages = () => {
  const packages = [
    {
      name: m["training.packages.halfDay.title"](),
      price: constants.pricing.training.halfDay,
      duration: m["training.packages.halfDay.duration"](),
      features: [
        m["training.packages.halfDay.features.feature1"](),
        m["training.packages.halfDay.features.feature2"](),
        m["training.packages.halfDay.features.feature3"](),
        m["training.packages.halfDay.features.feature4"](),
      ],
    },
    {
      name: m["training.packages.fullDay.title"](),
      price: constants.pricing.training.fullDay,
      duration: m["training.packages.fullDay.duration"](),
      features: [
        m["training.packages.fullDay.features.feature1"](),
        m["training.packages.fullDay.features.feature2"](),
        m["training.packages.fullDay.features.feature3"](),
        m["training.packages.fullDay.features.feature4"](),
      ],
      popular: true,
    },
    {
      name: m["training.packages.custom.title"](),
      price: constants.pricing.training.custom,
      duration: m["training.packages.custom.duration"](),
      features: [
        m["training.packages.custom.features.feature1"](),
        m["training.packages.custom.features.feature2"](),
        m["training.packages.custom.features.feature3"](),
        m["training.packages.custom.features.feature4"](),
      ],
    },
  ];

  return (
    <section className="py-20 bg-white">
      <div className="container mx-auto px-4">
        <div className="text-center mb-16">
          <h2 className="text-4xl font-bold text-gray-900 mb-4">
            {m["training.packages.title"]()}
          </h2>
          <p className="text-xl text-gray-600">
            {m["training.packages.subtitle"]()}
          </p>
        </div>

        <div className="grid lg:grid-cols-3 gap-8 max-w-6xl mx-auto">
          {packages.map((pkg) => (
            <Card
              key={pkg.name}
              className={cn(
                "relative flex flex-col",
                pkg.popular
                  ? "border-green-501 border-2 shadow-xl"
                  : "border-gray-200"
              )}
            >
              {pkg.popular && (
                <div className="absolute -top-4 left-1/2 transform -translate-x-1/2">
                  <span className="bg-green-500 text-white px-4 py-2 rounded-full text-sm font-semibold">
                    {m["training.packages.fullDay.popular"]()}
                  </span>
                </div>
              )}

              <CardHeader className="text-center pb-8">
                <CardTitle className="text-2xl font-bold text-gray-900 mb-2">
                  {pkg.name}
                </CardTitle>
                <div className="text-4xl font-bold text-green-600 mb-2">
                  {pkg.price !== null ? (
                    <Price amount={pkg.price} />
                  ) : (
                    <span>{m["training.packages.custom.customPrice"]()}</span>
                  )}
                </div>
                <p className="text-gray-600">{pkg.duration}</p>
              </CardHeader>

              <CardContent className="grow flex flex-col justify-end">
                <ul className="space-y-4 mb-8">
                  {pkg.features.map((feature) => (
                    <li key={feature} className="flex items-center">
                      <Check className="w-5 h-5 text-green-500 mr-3 flex-shrink-0" />
                      <span className="text-gray-700">{feature}</span>
                    </li>
                  ))}
                </ul>

                <Button
                  className={cn(
                    "w-full text-white",
                    pkg.popular
                      ? "bg-green-500 hover:bg-green-600"
                      : "bg-gray-900 hover:bg-gray-800"
                  )}
                  size="lg"
                >
                  {m["training.packages.contactButton"]()}
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
};
