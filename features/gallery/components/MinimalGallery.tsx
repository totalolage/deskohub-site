"use client";

import Image from "next/image";
import barFront from "@/assets/images/photos/bar_front_1.jpeg";

// Import all images
import barWithStaff1 from "@/assets/images/photos/bar_with_staff_1.jpeg";
import barWithStaff2 from "@/assets/images/photos/bar_with_staff_2.jpeg";
import barWithStaff3 from "@/assets/images/photos/bar_with_staff_3.jpeg";
import barWithStaff4 from "@/assets/images/photos/bar_with_staff_4.jpeg";
import barWithStaff5 from "@/assets/images/photos/bar_with_staff_5.jpeg";
import barWithStaffAesthetic from "@/assets/images/photos/bar_with_staff_aesthetic_photo_front.jpeg";
import boardgameInProgress from "@/assets/images/photos/boardgame_in_progress_1.jpeg";
import boardgameShelves1 from "@/assets/images/photos/boardgame_shelves_1.jpeg";
import boardgameShelves2 from "@/assets/images/photos/boardgame_shelves_2.jpeg";
import customersPlaying1 from "@/assets/images/photos/customers_playing_1.jpeg";
import customersPlaying2 from "@/assets/images/photos/customers_playing_2.jpeg";
import customersPlaying3 from "@/assets/images/photos/customers_playing_3.jpeg";
import customersPlaying4 from "@/assets/images/photos/customers_playing_4.jpeg";
import customersPlaying5 from "@/assets/images/photos/customers_playing_5.jpeg";
import customersPlaying6 from "@/assets/images/photos/customers_playing_6.jpeg";
import customersPlaying7 from "@/assets/images/photos/customers_playing_7.jpeg";
import customersPlaying8 from "@/assets/images/photos/customers_playing_8.jpeg";
import customersPlaying9 from "@/assets/images/photos/customers_playing_9.jpeg";
import customersPlaying10 from "@/assets/images/photos/customers_playing_10.jpeg";
import customersPlaying11 from "@/assets/images/photos/customers_playing_11.jpeg";
import liquorShelf from "@/assets/images/photos/liquor_shelf_1.jpeg";
import mainRoom1 from "@/assets/images/photos/main_room_1.jpeg";
import mainRoom2 from "@/assets/images/photos/main_room_2.jpeg";
import mainRoom3 from "@/assets/images/photos/main_room_3.jpeg";
import menuAndCoffee from "@/assets/images/photos/menu_and_coffee_mug_with_games_in_background.jpeg";
import outsideRenovations1 from "@/assets/images/photos/outside_renovations_1.jpeg";
import outsideRenovations2 from "@/assets/images/photos/outside_renovations_2.jpeg";
import outsideRenovations3 from "@/assets/images/photos/outside_renovations_3.jpeg";
import outsideRenovations4 from "@/assets/images/photos/outside_renovations_4.jpeg";
import outsideRenovations5 from "@/assets/images/photos/outside_renovations_5.jpeg";
import outsideRenovations6 from "@/assets/images/photos/outside_renovations_6.jpeg";
import product from "@/assets/images/photos/product_1.jpeg";
import teambuildingRoom1 from "@/assets/images/photos/teambuilding_room_1.jpeg";
import teambuildingRoom2 from "@/assets/images/photos/teambuilding_room_2.jpeg";
import teambuildingRoom3 from "@/assets/images/photos/teambuilding_room_3.jpeg";
import teambuildingRoom4 from "@/assets/images/photos/teambuilding_room_4.jpeg";
import trainingRoom5 from "@/assets/images/photos/training_room_5.jpeg";
import viewBehindBar from "@/assets/images/photos/view_behind_bar.jpeg";
import viewFromBar from "@/assets/images/photos/view_from_bar.jpeg";
import viewOfDoor from "@/assets/images/photos/view_of_door_from_behind_bar_with_staff.jpeg";
import { m } from "@/i18n";

export function MinimalGallery() {
  const galleryImages = [
    // Main areas
    { src: mainRoom1, alt: "Main room" },
    { src: mainRoom2, alt: "Main room" },
    { src: mainRoom3, alt: "Main room" },
    { src: viewFromBar, alt: "View from bar" },

    // Bar area
    { src: barFront, alt: "Bar front" },
    { src: barWithStaff1, alt: "Bar with staff" },
    { src: barWithStaff2, alt: "Bar with staff" },
    { src: barWithStaff3, alt: "Bar with staff" },
    { src: barWithStaff4, alt: "Bar with staff" },
    { src: barWithStaff5, alt: "Bar with staff" },
    { src: barWithStaffAesthetic, alt: "Bar aesthetic photo" },
    { src: viewBehindBar, alt: "View behind bar" },
    { src: viewOfDoor, alt: "View of door from bar" },
    { src: liquorShelf, alt: "Liquor shelf" },

    // Customers playing
    { src: customersPlaying1, alt: "Customers playing games" },
    { src: customersPlaying2, alt: "Customers playing games" },
    { src: customersPlaying3, alt: "Customers playing games" },
    { src: customersPlaying4, alt: "Customers playing games" },
    { src: customersPlaying5, alt: "Customers playing games" },
    { src: customersPlaying6, alt: "Customers playing games" },
    { src: customersPlaying7, alt: "Customers playing games" },
    { src: customersPlaying8, alt: "Customers playing games" },
    { src: customersPlaying9, alt: "Customers playing games" },
    { src: customersPlaying10, alt: "Customers playing games" },
    { src: customersPlaying11, alt: "Customers playing games" },

    // Games
    { src: boardgameInProgress, alt: "Board game in progress" },
    { src: boardgameShelves1, alt: "Board game shelves" },
    { src: boardgameShelves2, alt: "Board game shelves" },

    // Training/Team building room
    { src: teambuildingRoom1, alt: "Team building room" },
    { src: teambuildingRoom2, alt: "Team building room" },
    { src: teambuildingRoom3, alt: "Team building room" },
    { src: teambuildingRoom4, alt: "Team building room" },
    { src: trainingRoom5, alt: "Training room" },

    // Other
    { src: menuAndCoffee, alt: "Menu and coffee" },
    { src: product, alt: "Product" },

    // Outside/Renovations
    { src: outsideRenovations1, alt: "Outside renovations" },
    { src: outsideRenovations2, alt: "Outside renovations" },
    { src: outsideRenovations3, alt: "Outside renovations" },
    { src: outsideRenovations4, alt: "Outside renovations" },
    { src: outsideRenovations5, alt: "Outside renovations" },
    { src: outsideRenovations6, alt: "Outside renovations" },
  ];

  return (
    <div className="container mx-auto px-4 py-16">
      <div className="text-center mb-12">
        <h1 className="text-4xl font-bold mb-4">{m["gallery.hero.title"]()}</h1>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {galleryImages.map((image, index) => (
          <div
            key={index}
            className="relative aspect-square overflow-hidden rounded-lg shadow-md hover:shadow-xl transition-shadow duration-300"
          >
            <Image
              src={image.src}
              alt={image.alt}
              fill
              className="object-cover hover:scale-105 transition-transform duration-300"
              sizes="(max-width: 640px) 100vw, (max-width: 768px) 50vw, (max-width: 1024px) 33vw, 25vw"
            />
          </div>
        ))}
      </div>
    </div>
  );
}
