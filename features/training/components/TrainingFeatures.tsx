import { Edit, Layout, Thermometer, Wifi } from "lucide-react";
import { m } from "@/features/i18n";
import { Card, CardContent } from "@/shared/components/ui/card";

export const TrainingFeatures = () => {
  const features = [
    {
      icon: Wifi,
      title: m["training.features.feature1.title"](),
      description: m["training.features.feature1.description"](),
    },
    {
      icon: Layout,
      title: m["training.features.feature2.title"](),
      description: m["training.features.feature2.description"](),
    },
    {
      icon: Thermometer,
      title: m["training.features.feature3.title"](),
      description: m["training.features.feature3.description"](),
    },
    {
      icon: Edit,
      title: m["training.features.feature4.title"](),
      description: m["training.features.feature4.description"](),
    },
  ];

  return (
    <section className="py-20 bg-gray-50">
      <div className="container mx-auto px-4">
        <div className="text-center mb-16">
          <h2 className="text-4xl font-bold text-gray-900 mb-4">
            {m["training.features.title"]()}
          </h2>
          <p className="text-xl text-gray-600 max-w-2xl mx-auto">
            {m["training.features.subtitle"]()}
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-8">
          {features.map((feature) => (
            <Card
              key={feature.title}
              className="border-0 shadow-lg hover:shadow-xl transition-shadow"
            >
              <CardContent className="p-8 text-center">
                <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
                  <feature.icon className="w-8 h-8 text-green-600" />
                </div>
                <h3 className="text-xl font-semibold text-gray-900 mb-4">
                  {feature.title}
                </h3>
                <p className="text-gray-600">{feature.description}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
};
