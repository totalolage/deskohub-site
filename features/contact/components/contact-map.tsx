import { MapPin } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { m } from "@/i18n";

export function ContactMap() {
  return (
    <div className="mt-16">
      <h2 className="text-3xl font-bold text-white mb-8 text-center">
        {m["contact.mapTitle"]()}
      </h2>
      <Card className="bg-gray-900 border-gray-700">
        <CardContent className="p-0">
          <div className="h-96 bg-gray-800 rounded-lg flex items-center justify-center">
            <div className="text-center text-gray-400">
              <MapPin className="w-12 h-12 mx-auto mb-4" />
              <p className="text-lg">{m["contact.mapPlaceholder"]()}</p>
              <p className="text-sm">{m["contact.mapAddress"]()}</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
