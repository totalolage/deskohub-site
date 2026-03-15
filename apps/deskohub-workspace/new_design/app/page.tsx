import { Amenities } from "@/components/amenities";
import { Community } from "@/components/community";
import { Contact } from "@/components/contact";
import { Footer } from "@/components/footer";
import { Header } from "@/components/header";
import { Hero } from "@/components/hero";
import { Pricing } from "@/components/pricing";
import { Spaces } from "@/components/spaces";

export default function Home() {
  return (
    <main className="min-h-screen">
      <Header />
      <Hero />
      <Spaces />
      <Amenities />
      <Community />
      <Pricing />
      <Contact />
      <Footer />
    </main>
  );
}
