export interface MenuItem {
  name: string;
  description?: string;
  price: number;
  weight?: string;
}

export interface MenuSection {
  title: string;
  items: MenuItem[];
}

export const foodMenu: MenuSection[] = [
  {
    title: "Občerstvení",
    items: [
      { name: "Popcorn", price: 85, weight: "2,3L" },
      { name: "Nachos", price: 149, weight: "300g" },
      { name: "Hermelín", price: 105, description: "1 kus s chlebem" },
      {
        name: "Klobása černá",
        price: 105,
        description: "s hořčicí, kečupem a chlebem",
      },
    ],
  },
  {
    title: "Teplá jídla",
    items: [
      {
        name: "Toast klasický",
        price: 89,
        description: "2 kusy se šunkou a sýrem",
      },
      { name: "Toast s prosciuttem/chorizo", price: 99, description: "2 kusy" },
      {
        name: "Sandwich s mletým masem",
        price: 158,
        description: "2 kusy, 150g masa, salát, sýr",
      },
      { name: "Quesadilla", price: 115, description: "základní" },
      {
        name: "Quesadilla s masem",
        price: 158,
        description: "s kuřecím masem",
      },
    ],
  },
  {
    title: "Sladké",
    items: [
      {
        name: "Palačinky",
        price: 85,
        description: "3 kusy s džemem nebo Nutellou",
      },
    ],
  },
];

export const drinkMenu: MenuSection[] = [
  {
    title: "Káva a Čokoláda",
    items: [
      { name: "Espresso", price: 55 },
      { name: "Americano", price: 55 },
      { name: "Cappuccino", price: 75 },
      { name: "Horká čokoláda", price: 75 },
    ],
  },
  {
    title: "Čaje Sypané a Máta",
    items: [
      { name: "Čínský - Zelený", price: 69 },
      { name: "Oolong Vietnam", price: 69 },
      { name: "Máta", price: 69 },
    ],
  },
  {
    title: "Nealko",
    items: [
      { name: "Kofola", price: 54 },
      { name: "Targo Orange", price: 33 },
      { name: "Tonic", price: 45 },
      { name: "Džus pomeranč", price: 45 },
    ],
  },
  {
    title: "Alkoholické",
    items: [
      { name: "Modrý Portugal", price: 89 },
      { name: "Gin Gordon", price: 105 },
      { name: "Vodka Finlandia", price: 89 },
      { name: "Rum Bacardi", price: 89 },
    ],
  },
  {
    title: "Cocktails",
    items: [
      { name: "Cuba Libre", price: 110 },
      { name: "Pina Colada", price: 110 },
      { name: "Mojito", price: 110 },
      { name: "Gin Tonic", price: 110 },
    ],
  },
];
