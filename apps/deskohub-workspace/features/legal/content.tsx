import type { ReactNode } from "react";
import type { Locale } from "@/features/i18n";
import { workspaceSiteConstants } from "@/shared/utils";

export type LegalDocumentKey =
  | "privacy-policy"
  | "marketing-communications"
  | "terms-and-conditions"
  | "cookie-policy"
  | "operating-rules";

type LegalSection = {
  heading: string;
  body: ReactNode[];
};

export type LegalDocumentContent = {
  title: string;
  lead: string;
  updatedAt: string;
  sections: LegalSection[];
};

const companyName = workspaceSiteConstants.brand.legalName;
const contactEmail = workspaceSiteConstants.contact.infoEmail;
const companyAddress = `${workspaceSiteConstants.location.address.street}, ${workspaceSiteConstants.location.address.postalCode} ${workspaceSiteConstants.location.address.city} - ${workspaceSiteConstants.location.address.cityDistrict}`;
const commercialRegisterDisclosure = {
  "en-US":
    "Commercial register details are available in the linked official company extract.",
  "cs-CZ":
    "Údaje o zápisu v obchodním rejstříku jsou k dispozici v odkazovaném oficiálním výpisu společnosti.",
} as const;

const termsAndConditionsSections: LegalSection[] = [
  {
    heading: "1. Úvodní ustanovení",
    body: [
      <>
        1.1 Tyto všeobecné obchodní podmínky (dále jen „VOP“) upravují vzájemná
        práva a povinnosti smluvních stran vznikající v souvislosti s
        poskytováním služeb společností {companyName}, IČO:{" "}
        {workspaceSiteConstants.company.identificationNumber}, se sídlem
        Turnovská 430/10, Praha 8, zapsané v obchodním rejstříku vedeném
        Městským soudem v Praze (dále jen „Poskytovatel“), a klientem (dále jen
        „Klient“).
      </>,
      "1.2 Tyto VOP se vztahují na coworkingové vstupy, online rezervace zasedací místnosti a soukromé kanceláře a na krátkodobé užívání prostor pro akce sjednané individuálně.",
      "1.3 Ustanovení těchto VOP jsou nedílnou součástí každé smlouvy uzavřené mezi Poskytovatelem a Klientem.",
      "1.4 Právní vztahy neupravené těmito VOP se řídí právním řádem České republiky, zejména zákonem č. 89/2012 Sb., občanský zákoník.",
      "1.5 Je-li Klient spotřebitelem, nejsou těmito VOP omezena práva, kterých se podle kogentních právních předpisů nemůže vzdát.",
    ],
  },
  {
    heading: "2. Vymezení pojmů",
    body: [
      "2.1 Klientem se rozumí fyzická nebo právnická osoba, která využívá služby Poskytovatele.",
      "2.2 Spotřebitelem se rozumí Klient, který jedná mimo rámec své podnikatelské činnosti.",
      "2.3 Prostory jsou coworkingové prostory, zasedací místnost, soukromá kancelář a eventové prostory provozované Poskytovatelem.",
      "2.4 Službami se rozumí časově omezené umožnění užívání zvolených Prostor a související služby uvedené v objednávce.",
      "2.5 Tarifem se rozumí konkrétní rozsah coworkingových služeb a podmínek jejich čerpání dle aktuálního Ceníku Poskytovatele.",
      "2.6 Přístupovým PIN kódem se rozumí aktuální kód umožňující vstup do prostor Poskytovatele.",
      "2.7 Rezervací se rozumí objednávka konkrétního coworkingového vstupu, termínu zasedací místnosti nebo termínu, počtu dnů a počtu míst v soukromé kanceláři.",
    ],
  },
  {
    heading: "3. Předmět smlouvy",
    body: [
      "3.1 Poskytovatel poskytuje Klientovi coworkingové služby spočívající v dočasném umožnění užívání sdíleného pracovního prostoru v prostorách Poskytovatele, a to v rozsahu zvoleného tarifu. Sdíleným pracovním prostorem se rozumí nevýhradně určené pracovní místo nebo část coworkingových prostor určená k běžné práci, bez garance konkrétního stolu či místa, není-li u konkrétního tarifu výslovně uvedeno jinak.",
      "3.2 Rezervace zasedací místnosti opravňuje Klienta k výhradnímu užívání vybrané místnosti v potvrzeném termínu a rozsahu jedné hodiny, čtyř hodin nebo jednoho pražského kalendářního dne. Celodenní Rezervace trvá od půlnoci vybraného dne do půlnoci následujícího dne v časovém pásmu Europe/Prague.",
      "3.3 Rezervace soukromé kanceláře opravňuje Klienta k výhradnímu užívání kanceláře v potvrzeném počtu míst po celé zvolené kalendářní dny. Každý den trvá od půlnoci do následující půlnoci v časovém pásmu Europe/Prague a poslední den uvedený v potvrzení je do Rezervace zahrnut.",
      "3.4 Konkrétní kapacita, vybavení, cena, termín a rozsah Rezervace jsou uvedeny na rezervační stránce a v souhrnu objednávky. Klient nesmí překročit potvrzenou kapacitu a odpovídá za své hosty a další osoby, kterým umožní vstup.",
      "3.5 Poskytovatel dále umožňuje Klientovi krátkodobé užívání prostor pro účely pořádání akcí, a to vždy na základě individuální dohody.",
      "3.6 Služby představují krátkodobé oprávnění užívat určené Prostory a související služby; nezakládají nájemní právo, sídlo, provozovnu ani jiné věcné právo k Prostorám. Klient nesmí bez samostatné písemné dohody používat adresu Prostor jako sídlo, místo podnikání, provozovnu nebo doručovací adresu.",
    ],
  },
  {
    heading: "4. Uzavření smlouvy",
    body: [
      "4.1 Údaje o Službách na webu představují výzvu k podání objednávky. Klient před odesláním objednávky zkontroluje vybranou Službu, termín, rozsah, konečnou cenu a kontaktní nebo fakturační údaje a aktivně přijme tyto VOP a Provozní řád.",
      "4.2 Kliknutím na tlačítko „Objednat a zaplatit“ Klient odesílá závaznou objednávku s povinností zaplatit uvedenou konečnou cenu. Smlouva je uzavřena doručením potvrzení Poskytovatele po úspěšné platbě, nebo u objednávky s nulovou konečnou cenou doručením potvrzení jejího dokončení. Potvrzení obsahuje sjednané údaje Rezervace a bezpečný odkaz na její stav a přístupové informace.",
      "4.3 Do uzavření smlouvy jde pouze o dočasné držení kapacity. Poskytovatel může objednávku odmítnout zejména při nedostupnosti, zjevné chybě v ceně, podezření na podvod nebo nesplnění podmínek Rezervace; přijatou platbu v takovém případě vrátí bez zbytečného odkladu.",
      "4.4 Požadavky na kávu, konkrétní pracovní místo, monitor, vybavení nebo jiné doplňky podléhají dostupnosti a jsou závazné pouze tehdy, jsou-li uvedeny v potvrzení.",
      "4.5 Smlouva o prostoru pro individuálně sjednanou akci je uzavřena přijetím konkrétní nabídky Poskytovatele Klientem.",
    ],
  },
  {
    heading: "5. Cena a platební podmínky",
    body: [
      "5.1 Poskytovatel není plátcem daně z přidané hodnoty. Veškeré ceny jsou konečné.",
      "5.2 Rozhodující je konečná cena zobrazená v souhrnu objednávky bezprostředně před jejím odesláním. Cena je splatná před poskytnutím Služby prostřednictvím nabídnutého způsobu platby.",
      "5.3 Cena soukromé kanceláře se počítá za každý vybraný den jako denní cena za kancelář plus denní cena za každé potvrzené místo. Cena zasedací místnosti odpovídá vybranému jednohodinovému, čtyřhodinovému nebo celodennímu produktu.",
      "5.4 Slevy se uplatní pouze tehdy, jsou-li uvedeny v souhrnu objednávky. Změní-li se před zahájením platby cena nebo použitelná sleva, Poskytovatel zobrazí nový souhrn a vyžádá nové potvrzení Klienta.",
      "5.5 Cena prostoru pro individuálně sjednanou akci je stanovena v nabídce podle charakteru akce.",
    ],
  },
  {
    heading: "6. Dostupnost a změny Rezervace",
    body: [
      "6.1 Dostupnost je potvrzena pouze pro termín, rozsah, kapacitu a produkt uvedený v potvrzení. Změna data, času, délky, počtu dnů, počtu míst nebo produktu vyžaduje novou Rezervaci nebo výslovné potvrzení Poskytovatele.",
      "6.2 Rezervaci nelze převést ani dále prodávat bez předchozího souhlasu Poskytovatele.",
      "6.3 Nabídku, ceny a obsah Služeb může Poskytovatel měnit pro budoucí objednávky. Změna nemá vliv na již uzavřenou smlouvu.",
      "6.4 Nemůže-li Poskytovatel potvrzenou Službu poskytnout, nabídne Klientovi podle okolností srovnatelný náhradní termín nebo prostor, přiměřenou slevu, anebo vrátí cenu za neposkytnutou část Služby. Tím nejsou dotčena další zákonná práva Klienta.",
    ],
  },
  {
    heading: "7. Přístup a užívání služeb",
    body: [
      "7.1 Potvrzovací email obsahuje bezpečný odkaz na přístupovou stránku Rezervace. Aktuální přístupový PIN kód se na této stránce zobrazuje od 30 minut před začátkem Rezervace do 30 minut po jejím skončení. PIN není obsažen přímo v potvrzovacím emailu.",
      "7.2 Poskytovatel může přístupový PIN změnit; Klient použije kód aktuálně zobrazený na přístupové stránce Rezervace. Doba zobrazení PIN kódu je pouze technickou rezervou pro příchod a odchod, neprodlužuje potvrzenou dobu užívání Prostor a nezakládá právo na přístup mimo tuto dobu nebo do jiných prostor.",
      "7.3 Klient smí PIN kód sdělit pouze osobám oprávněným účastnit se jeho Rezervace, musí jej chránit před dalšími osobami a odpovídá za jeho použití svými hosty. Podezření na zneužití neprodleně oznámí Poskytovateli.",
      "7.4 Klient a jeho hosté jsou povinni dodržovat kapacitu, účel Rezervace, potvrzený čas a Provozní řád. Klient zajistí, aby hosté Prostory opustili nejpozději na konci Rezervace.",
    ],
  },
  {
    heading: "8. Storno Rezervace",
    body: [
      <>
        8.1 Klient může požádat o zrušení Rezervace e-mailem na{" "}
        <a
          className="text-burned-orange underline underline-offset-4"
          href={`mailto:${contactEmail}`}
        >
          {contactEmail}
        </a>
        . Poskytovatel žádost zpracuje podle podmínek uvedených v souhrnu
        objednávky nebo individuální nabídce a podle kogentních právních
        předpisů.
      </>,
      "8.2 Není-li v souhrnu objednávky nebo individuální nabídce uvedeno jinak, samotné storno nezakládá zvláštní smluvní nárok na vrácení ceny. Tím nejsou dotčena práva z vadného plnění, zákonné právo Spotřebitele odstoupit od smlouvy ani případ, kdy Službu neposkytl Poskytovatel.",
      "8.3 Individuálně sjednané akce se ruší podle podmínek konkrétní nabídky.",
      "8.4 Klient není oprávněn k vrácení ceny pouze proto, že Prostory nevyužil, přišel pozdě nebo odešel předčasně, nejsou-li splněny podmínky pro vrácení podle tohoto článku nebo kogentního právního předpisu.",
    ],
  },
  {
    heading: "9. Právo Spotřebitele odstoupit od smlouvy",
    body: [
      "9.1 Spotřebitel může od smlouvy uzavřené online odstoupit bez uvedení důvodu do 14 dnů od jejího uzavření, ledaže je právo na odstoupení v konkrétním případě zákonem vyloučeno nebo již zaniklo.",
      "9.2 Má-li Služba začít před uplynutím této lhůty, Spotřebitel v rámci potvrzení objednávky výslovně žádá, aby Poskytovatel začal plnit před uplynutím lhůty, a bere na vědomí, že po úplném poskytnutí Služby právo odstoupit zaniká. Odstoupí-li po zahájení, ale před úplným poskytnutím Služby, uhradí poměrnou část ceny za již poskytnuté plnění, jsou-li splněny zákonné podmínky.",
      <>
        9.3 Odstoupení lze zaslat jednoznačným prohlášením na adresu sídla
        Poskytovatele nebo e-mailem na{" "}
        <a
          className="text-burned-orange underline underline-offset-4"
          href={`mailto:${contactEmail}`}
        >
          {contactEmail}
        </a>
        . Lhůta je zachována, je-li oznámení odesláno před jejím uplynutím.
      </>,
      "9.4 Po platném odstoupení vrátí Poskytovatel přijaté peněžní prostředky bez zbytečného odkladu, nejpozději do 14 dnů, stejným způsobem, kterým byly přijaty, nedohodnou-li se strany jinak bez vzniku dalších nákladů Spotřebitele.",
      "9.5 Vzor oznámení: „Oznamuji, že odstupuji od smlouvy na tuto Službu: [popis a číslo Rezervace], objednanou dne [datum]. Jméno a příjmení Spotřebitele: [doplnit]. Adresa Spotřebitele: [doplnit]. Datum: [doplnit]. Podpis pouze při listinném podání.“ Použití vzoru není povinné.",
      "9.6 Práva podle tohoto článku náleží pouze Spotřebiteli a platí vedle případných výhodnějších storno podmínek uvedených v souhrnu objednávky nebo individuální nabídce.",
    ],
  },
  {
    heading: "10. Pravidla užívání a odpovědnost Klienta",
    body: [
      "10.1 Klient je povinen užívat Prostory řádně, pouze k potvrzenému účelu a v souladu s těmito VOP, Provozním řádem, bezpečnostními pokyny a právními předpisy.",
      "10.2 Klient odpovídá za jednání svých hostů a za škodu, kterou on nebo jeho hosté způsobí porušením povinnosti. Běžné opotřebení se za škodu nepovažuje. Škodu nebo závadu Klient oznámí bez zbytečného odkladu.",
      "10.3 Poskytovatel může přiměřeně omezit nebo ukončit poskytování Služby při závažném nebo opakovaném porušení VOP či Provozního řádu, překročení kapacity, nebezpečném nebo protiprávním jednání nebo zneužití přístupu. Tím nejsou dotčena práva Klienta, pokud opatření nebylo oprávněné.",
    ],
  },
  {
    heading: "11. Odpovědnost Poskytovatele",
    body: [
      "11.1 Poskytovatel odpovídá za řádné poskytnutí potvrzené Služby a za újmu v rozsahu stanoveném právními předpisy. Nic v těchto VOP nevylučuje ani neomezuje odpovědnost, kterou nelze platně vyloučit, ani zákonná práva Spotřebitele.",
      "11.2 Klient odpovídá za svou podnikatelskou činnost, vlastní data a věci vnesené do Prostor. Poskytovatel odpovídá za ztrátu nebo poškození věci pouze v rozsahu stanoveném právními předpisy; Klient proto nenechává věci bez dozoru a přiměřeně je zabezpečí.",
      "11.3 Poskytovatel neodpovídá za překážku vzniklou nezávisle na jeho vůli, kterou nemohl rozumně předvídat ani odvrátit. Trvá-li taková překážka nebo dočasná nedostupnost tak, že podstatná část potvrzené Služby nemůže být poskytnuta, postupuje se podle článku 6.4.",
      "11.4 Vůči Klientovi, který není Spotřebitelem, Poskytovatel v maximálním rozsahu dovoleném zákonem neodpovídá za nepřímou újmu, ušlý zisk nebo ztrátu dat, pokud je nezpůsobil úmyslně nebo z hrubé nedbalosti.",
    ],
  },
  {
    heading: "12. Vady a reklamace",
    body: [
      "12.1 Klient oznámí vadu Služby bez zbytečného odkladu, aby ji bylo možné napravit, a uvede alespoň své kontaktní údaje, číslo Rezervace, popis vady a požadovaný způsob vyřízení.",
      <>
        12.2 Reklamaci lze uplatnit v provozovně, na adrese Poskytovatele nebo
        e-mailem na{" "}
        <a
          className="text-burned-orange underline underline-offset-4"
          href={`mailto:${contactEmail}`}
        >
          {contactEmail}
        </a>
        . Poskytovatel vydá Spotřebiteli potvrzení o jejím přijetí a vyřízení.
      </>,
      "12.3 O reklamaci Spotřebitele Poskytovatel rozhodne ihned, ve složitých případech do tří pracovních dnů; reklamaci včetně odstranění vady vyřídí bez zbytečného odkladu, nejpozději do 30 dnů, nedohodne-li se se Spotřebitelem na delší lhůtě.",
      "12.4 Podle povahy vady může Klient požadovat nápravu, náhradní plnění, přiměřenou slevu nebo odstoupit od smlouvy, jsou-li splněny zákonné podmínky.",
    ],
  },
  {
    heading: "13. Mimosoudní řešení spotřebitelských sporů",
    body: [
      "13.1 Vznikne-li mezi Poskytovatelem a Spotřebitelem spor ze smlouvy o poskytování Služeb, který se nepodaří vyřešit přímo, může Spotřebitel podat návrh na mimosoudní řešení sporu České obchodní inspekci, Ústřední inspektorát – oddělení ADR, Gorazdova 1969/24, 120 00 Praha 2.",
      <>
        13.2 Informace a elektronický formulář jsou dostupné na{" "}
        <a
          className="text-burned-orange underline underline-offset-4"
          href="https://coi.gov.cz/informace-o-adr/"
          rel="noreferrer"
          target="_blank"
        >
          coi.gov.cz/informace-o-adr/
        </a>
        . Návrh musí Spotřebitel podat nejpozději do jednoho roku ode dne, kdy
        své právo u Poskytovatele uplatnil poprvé.
      </>,
    ],
  },
  {
    heading: "14. Zvláštní ustanovení pro akce",
    body: [
      "14.1 Klient odpovídá za průběh individuálně sjednané akce a za osoby, které se jí účastní.",
      "14.2 Poskytovatel je oprávněn akci ukončit v případě porušení právních předpisů, konkrétní nabídky, těchto VOP nebo Provozního řádu.",
    ],
  },
  {
    heading: "15. Závěrečná ustanovení",
    body: [
      "15.1 Poskytovatel může tyto VOP měnit pro smlouvy uzavřené po účinnosti nového znění. Na již uzavřenou Rezervaci se použije znění přijaté Klientem při objednávce, není-li pozdější změna pro Klienta výhodnější nebo ji výslovně nepřijme.",
      "15.2 Odchylné individuální ujednání má přednost před těmito VOP. Neplatnost nebo neúčinnost jednoho ustanovení nemá vliv na ostatní ustanovení.",
      "15.3 Tyto VOP nabývají účinnosti dne 12. 8. 2026.",
    ],
  },
];

const operatingRulesSections: LegalSection[] = [
  {
    heading: "1. Úvodní ustanovení",
    body: [
      <>
        1.1 Tento provozní řád (dále jen „Provozní řád“) upravuje pravidla
        chování a užívání coworkingových prostor, zasedací místnosti, soukromé
        kanceláře a eventových prostor provozovaných společností {companyName},
        IČO: {workspaceSiteConstants.company.identificationNumber}, se sídlem
        Turnovská 430/10, Praha 8 (dále jen „Provozovatel“).
      </>,
      "1.2 Tento Provozní řád je závazný pro všechny osoby nacházející se v prostorách Provozovatele (dále jen „Uživatel“).",
      "1.3 Klient, který vytvořil rezervaci, zajistí, aby se s Provozním řádem seznámili a dodržovali jej také jeho hosté a další osoby, kterým umožní vstup.",
    ],
  },
  {
    heading: "2. Základní pravidla chování",
    body: [
      "2.1 Uživatel je povinen chovat se v prostorách ohleduplně a s respektem k ostatním osobám.",
      "2.2 Ve sdílených a společných prostorách Uživatel zachovává klid odpovídající běžné tiché konverzaci. V zasedací místnosti nebo soukromé kanceláři udržuje hluk uvnitř rezervovaného prostoru.",
      "2.3 Uživatel nesmí svým jednáním nadměrně rušit ostatní uživatele ani omezovat jejich užívání prostor. Klient odpovídá za chování svých hostů.",
    ],
  },
  {
    heading: "3. Zákazy v prostorách",
    body: [
      "3.1 V prostorách je zakázáno:",
      "a) kouřit, včetně používání elektronických cigaret,",
      "b) užívat omamné nebo psychotropní látky,",
      "c) vstupovat do prostor pod vlivem alkoholu nebo jiných návykových látek v míře omezující schopnost bezpečného chování,",
      "d) vykonávat činnosti v rozporu s právními předpisy,",
      "e) poškozovat vybavení nebo zařízení prostor,",
      "f) obtěžovat ostatní uživatele nevhodným nebo agresivním chováním,",
      "g) překročit potvrzenou kapacitu, přenechat nebo dále prodat rezervaci neoprávněné osobě,",
      "h) bez písemné dohody používat adresu prostor jako sídlo, místo podnikání, provozovnu nebo doručovací adresu.",
    ],
  },
  {
    heading: "4. Užívání prostor",
    body: [
      "4.1 Uživatel je povinen užívat prostory výhradně k účelům odpovídajícím jejich povaze a určení.",
      "4.2 Zasedací místnost a soukromá kancelář smějí být užívány pouze po potvrzenou dobu a v potvrzené kapacitě. Uživatelé je včetně svých věcí opustí nejpozději na konci rezervace.",
      "4.3 Uživatel je povinen udržovat pořádek a čistotu a po skončení užívání uvést využívané místo a společné vybavení do odpovídajícího stavu.",
      "4.4 Uživatel nesmí bez souhlasu Provozovatele přemisťovat vybavení, provádět úpravy, instalovat zařízení nebo zasahovat do technických rozvodů.",
      "4.5 Uživatel používá audiovizuální, konferenční a jiné vybavení podle pokynů a bez zbytečného odkladu oznámí závadu. Po skončení rezervace zařízení bezpečně vypne, vyžaduje-li to jeho povaha.",
    ],
  },
  {
    heading: "5. Občerstvení",
    body: [
      "5.1 Uživatel je povinen využívat občerstvení přiměřeně a s ohledem na ostatní uživatele.",
      "5.2 Uživatel nesmí občerstvení zneužívat nebo s ním neodůvodněně plýtvat.",
    ],
  },
  {
    heading: "6. Bezpečnost",
    body: [
      "6.1 Uživatel je povinen dbát na bezpečnost svou i ostatních osob.",
      "6.2 Uživatel nesmí blokovat únikové cesty ani jinak ohrožovat bezpečný provoz prostor.",
      "6.3 Uživatel je povinen bez zbytečného odkladu upozornit Provozovatele na vznik nebezpečné situace nebo závady.",
      "6.4 Přístupový PIN kód smí Klient sdělit pouze osobám oprávněným účastnit se jeho rezervace. Uživatelé jej chrání před zpřístupněním nebo odpozorováním neoprávněnou osobou a při zadávání dbají zvýšené opatrnosti.",
      "6.5 Doba, po kterou přístupová stránka Rezervace PIN zobrazuje, neprodlužuje dobu oprávněného užívání prostor. Uživatelé smějí vstoupit a pobývat v prostorách pouze v potvrzené době Rezervace.",
      "6.6 Dveře ani jiné zabezpečené vstupy nesmějí být ponechány otevřené. Podezření na zneužití kódu nebo vstup neoprávněné osoby Uživatel neprodleně oznámí Provozovateli.",
      "6.7 Klient zajistí bezpečný příchod a odchod svých hostů a nesmí jim umožnit přístup mimo potvrzenou dobu nebo do jiných než oprávněně užívaných prostor.",
      "6.8 Provozovatel nebo jím pověřená osoba může vstoupit do rezervovaného prostoru, je-li to nutné kvůli mimořádné události, bezpečnosti, odvrácení škody nebo nezbytné údržbě; pokud to okolnosti dovolují, Klienta předem informuje.",
    ],
  },
  {
    heading: "7. Odpovědnost za škodu",
    body: [
      "7.1 Uživatel odpovídá za škodu, kterou způsobí na majetku Provozovatele nebo třetích osob.",
      "7.2 Klient odpovídá také za škodu způsobenou jeho hosty. Běžné opotřebení se za škodu nepovažuje.",
      "7.3 Uživatel je povinen vznik škody, ztrátu klíče nebo přístupového prostředku a závadu neprodleně oznámit Provozovateli.",
    ],
  },
  {
    heading: "8. Porušení Provozního řádu",
    body: [
      "8.1 V případě porušení tohoto Provozního řádu je Provozovatel oprávněn přijmout přiměřená opatření k zajištění pořádku a ochrany ostatních uživatelů.",
      "8.2 Tato opatření mohou zahrnovat zejména výzvu k nápravě, omezení přístupu, vykázání Uživatele z prostor nebo ukončení rezervace, pokud je to přiměřené povaze a závažnosti porušení.",
      "8.3 Je-li to možné a porušení není závažné ani nebezpečné, poskytne Provozovatel před ukončením rezervace přiměřenou možnost nápravy.",
    ],
  },
  {
    heading: "9. Závěrečná ustanovení",
    body: [
      "9.1 Provozovatel může tento Provozní řád měnit pro budoucí rezervace. Pro již potvrzenou rezervaci je rozhodné znění přijaté při objednávce, nejsou-li bezodkladná opatření nutná z důvodu bezpečnosti nebo kogentního právního předpisu.",
      "9.2 Tento Provozní řád nabývá účinnosti dne 12. 8. 2026.",
    ],
  },
];

const termsAndConditionsSectionsEn: LegalSection[] = [
  {
    heading: "1. Introductory Provisions",
    body: [
      <>
        1.1 These General Terms and Conditions (hereinafter referred to as
        "GTC") govern the mutual rights and obligations of the contracting
        parties arising in connection with the provision of services by{" "}
        {companyName}, ID No.:{" "}
        {workspaceSiteConstants.company.identificationNumber}, with its
        registered office at Turnovská 430/10, Prague 8, registered in the
        Commercial Register maintained by the Municipal Court in Prague
        (hereinafter referred to as the "Provider"), and the client (hereinafter
        referred to as the "Client").
      </>,
      "1.2 These GTC apply to coworking entries, online bookings of the meeting room and private office, and individually agreed short-term use of premises for events.",
      "1.3 The provisions of these GTC are an integral part of every contract concluded between the Provider and the Client.",
      "1.4 Legal relationships not regulated by these GTC are governed by the laws of the Czech Republic, in particular Act No. 89/2012 Coll., the Civil Code.",
      "1.5 If the Client is a Consumer, these GTC do not limit rights that cannot be waived under mandatory law.",
    ],
  },
  {
    heading: "2. Definition of Terms",
    body: [
      "2.1 Client means a natural or legal person who uses the Provider's services.",
      "2.2 Consumer means a Client acting outside the scope of their business activity.",
      "2.3 Premises means the coworking spaces, meeting room, private office, and event spaces operated by the Provider.",
      "2.4 Services means time-limited use of the selected Premises and the related services stated in the order.",
      "2.5 Tariff means the specific scope of coworking services and the conditions for their use according to the Provider's current Price List.",
      "2.6 Access PIN Code means the current code enabling entry into the Provider's premises.",
      "2.7 Booking means an order for a specific coworking entry, a meeting-room time slot, or a private-office date range, day count, and seat count.",
    ],
  },
  {
    heading: "3. Subject of the Contract",
    body: [
      "3.1 The Provider provides the Client with coworking services consisting of temporarily enabling the use of a shared workspace in the Provider's premises, within the scope of the selected tariff. Shared workspace means a non-exclusively designated workstation or part of the coworking space intended for routine work, without a guarantee of a specific desk or seat, unless expressly stated otherwise for a specific tariff.",
      "3.2 A meeting-room Booking entitles the Client to exclusive use of the selected room for the confirmed time and duration of one hour, four hours, or one Prague calendar day. A whole-day Booking runs from midnight on the selected day to midnight on the following day in the Europe/Prague time zone.",
      "3.3 A private-office Booking entitles the Client to exclusive use of the office for the confirmed number of seats throughout the selected calendar days. Each day runs from midnight to the following midnight in the Europe/Prague time zone, and the last date stated in the confirmation is included in the Booking.",
      "3.4 The specific capacity, equipment, price, time, and scope of a Booking are stated on the reservation page and in the order summary. The Client must not exceed the confirmed capacity and is responsible for guests and any other persons to whom the Client grants access.",
      "3.5 The Provider also enables short-term use of premises for events, always under an individual agreement.",
      "3.6 The Services grant a limited right to use the designated Premises and related services; they do not create a tenancy, registered office, establishment, or other real-property interest. Without a separate written agreement, the Client must not use the Premises' address as a registered office, business address, establishment, or mailing address.",
    ],
  },
  {
    heading: "4. Conclusion of the Contract",
    body: [
      "4.1 Service information on the website is an invitation to place an order. Before submitting the order, the Client reviews the selected Service, time, scope, final price, and contact or billing details and actively accepts these GTC and the House Rules.",
      '4.2 By selecting the "Order and pay" button, the Client submits a binding order with an obligation to pay the stated final price. The contract is concluded when the Provider sends confirmation after successful payment or, for an order with a zero final price, confirmation that the order has been completed. The confirmation contains the agreed Booking details and a secure link to its status and access information.',
      "4.3 Until the contract is concluded, capacity is held only temporarily. The Provider may reject an order in particular because of unavailability, an obvious pricing error, suspected fraud, or failure to meet the Booking conditions; any payment received will then be refunded without undue delay.",
      "4.4 Requests for coffee, a particular workstation, monitor, equipment, or other extras are subject to availability and are binding only if stated in the confirmation.",
      "4.5 A contract for an individually arranged event space is concluded when the Client accepts the Provider's specific offer.",
    ],
  },
  {
    heading: "5. Price and Payment Conditions",
    body: [
      "5.1 The Provider is not a payer of Value Added Tax (VAT). All prices are final.",
      "5.2 The final price shown in the order summary immediately before submission is decisive. The price is payable before the Service is provided using the offered payment method.",
      "5.3 The private-office price is calculated for each selected day as the daily office price plus the daily price for each confirmed seat. The meeting-room price corresponds to the selected one-hour, four-hour, or whole-day product.",
      "5.4 A discount applies only if shown in the order summary. If the price or an applicable discount changes before payment starts, the Provider will show a new summary and obtain the Client's renewed confirmation.",
      "5.5 The price of an individually arranged event space is stated in the offer according to the nature of the event.",
    ],
  },
  {
    heading: "6. Availability and Booking Changes",
    body: [
      "6.1 Availability is confirmed only for the time, scope, capacity, and product stated in the confirmation. A change of date, time, duration, day count, seat count, or product requires a new Booking or the Provider's express confirmation.",
      "6.2 A Booking may not be transferred or resold without the Provider's prior consent.",
      "6.3 The Provider may change the range, prices, and content of Services for future orders. A change does not affect an already concluded contract.",
      "6.4 If the Provider cannot supply a confirmed Service, it will, depending on the circumstances, offer a comparable replacement time or space, a proportionate price reduction, or a refund for the part not provided. This does not affect the Client's other statutory rights.",
    ],
  },
  {
    heading: "7. Access and Use of Services",
    body: [
      "7.1 The confirmation email contains a secure link to the Booking access page. The current Access PIN Code is displayed on that page from 30 minutes before the Booking starts until 30 minutes after it ends. The PIN is not included directly in the confirmation email.",
      "7.2 The Provider may change the Access PIN Code; the Client must use the code currently displayed on the Booking access page. The PIN display period is only a technical grace period for arrival and departure, does not extend the confirmed use of the Premises, and creates no right to enter outside the confirmed time or into other premises.",
      "7.3 The Client may disclose the PIN Code only to people authorized to attend the Booking, must protect it from everyone else, and is responsible for its use by the Client's guests. Suspected misuse must be reported to the Provider without delay.",
      "7.4 The Client and guests must observe the capacity, Booking purpose, confirmed time, and House Rules. The Client must ensure that guests leave the Premises by the end of the Booking.",
    ],
  },
  {
    heading: "8. Booking Cancellation",
    body: [
      <>
        8.1 The Client may request cancellation by email to{" "}
        <a
          className="text-burned-orange underline underline-offset-4"
          href={`mailto:${contactEmail}`}
        >
          {contactEmail}
        </a>
        . The Provider will process the request under the conditions shown in
        the order summary or individual offer and under mandatory law.
      </>,
      "8.2 Unless the order summary or individual offer states otherwise, cancellation alone does not create a separate contractual right to a refund. This does not affect rights arising from defective performance, a Consumer's statutory withdrawal right, or a failure by the Provider to supply the Service.",
      "8.3 Individually arranged events are cancelled under the conditions of the specific offer.",
      "8.4 The Client is not entitled to a refund merely because the Premises were not used, the Client arrived late, or the Client left early, unless the refund conditions under this article or mandatory law are met.",
    ],
  },
  {
    heading: "9. Consumer Right of Withdrawal",
    body: [
      "9.1 A Consumer may withdraw from a contract concluded online without giving a reason within 14 days after the contract is concluded, unless the right is excluded by law or has already expired in the particular case.",
      "9.2 If the Service is to begin before the period expires, as part of confirming the order the Consumer expressly requests that the Provider begin performance before the period ends and acknowledges that the withdrawal right expires after the Service has been fully performed. If the Consumer withdraws after performance begins but before it is complete, the Consumer pays a proportionate part of the price for performance already supplied, provided the statutory conditions are met.",
      <>
        9.3 Withdrawal may be sent as an unequivocal statement to the Provider's
        registered-office address or by email to{" "}
        <a
          className="text-burned-orange underline underline-offset-4"
          href={`mailto:${contactEmail}`}
        >
          {contactEmail}
        </a>
        . The deadline is met if the notice is sent before it expires.
      </>,
      "9.4 Following a valid withdrawal, the Provider will reimburse payments received without undue delay and no later than 14 days, using the same payment method unless the parties agree otherwise without additional cost to the Consumer.",
      "9.5 Model notice: “I hereby give notice that I withdraw from my contract for the following Service: [description and Booking number], ordered on [date]. Consumer name: [complete]. Consumer address: [complete]. Date: [complete]. Signature only if submitted on paper.” Use of the model is optional.",
      "9.6 The rights in this article apply only to a Consumer and operate alongside any more favorable cancellation terms stated in the order summary or individual offer.",
    ],
  },
  {
    heading: "10. Use Rules and Client Responsibility",
    body: [
      "10.1 The Client must use the Premises properly, only for the confirmed purpose, and in accordance with these GTC, the House Rules, safety instructions, and applicable law.",
      "10.2 The Client is responsible for guests and for damage caused by the Client's or guests' breach of duty. Normal wear and tear is not damage. Damage or a defect must be reported without undue delay.",
      "10.3 The Provider may proportionately restrict or end a Service for a serious or repeated breach of the GTC or House Rules, exceeding capacity, dangerous or illegal conduct, or misuse of access. This does not affect the Client's rights if the measure was not justified.",
    ],
  },
  {
    heading: "11. Provider Liability",
    body: [
      "11.1 The Provider is responsible for properly supplying the confirmed Service and for harm to the extent required by law. Nothing in these GTC excludes or limits liability that cannot validly be excluded or a Consumer's statutory rights.",
      "11.2 The Client is responsible for the Client's business activities, data, and items brought into the Premises. The Provider is liable for loss of or damage to an item only to the extent required by law; the Client should therefore not leave items unattended and should secure them appropriately.",
      "11.3 The Provider is not liable for an obstacle beyond its control that it could not reasonably foresee or prevent. If such an obstacle or temporary unavailability prevents a material part of the confirmed Service from being supplied, Article 6.4 applies.",
      "11.4 To the maximum extent permitted by law, the Provider is not liable to a Client who is not a Consumer for indirect loss, loss of profit, or loss of data unless caused intentionally or by gross negligence.",
    ],
  },
  {
    heading: "12. Defects and Complaints",
    body: [
      "12.1 The Client must report a Service defect without undue delay so that it can be remedied and provide at least contact details, the Booking number, a description of the defect, and the requested resolution.",
      <>
        12.2 A complaint may be made at the establishment, at the Provider's
        address, or by email to{" "}
        <a
          className="text-burned-orange underline underline-offset-4"
          href={`mailto:${contactEmail}`}
        >
          {contactEmail}
        </a>
        . The Provider will give a Consumer written confirmation of receipt and
        resolution.
      </>,
      "12.3 The Provider will decide a Consumer complaint immediately or, in a complex case, within three business days, and resolve it, including remedying the defect, without undue delay and no later than 30 days unless a longer period is agreed with the Consumer.",
      "12.4 Depending on the defect, the Client may request a remedy, replacement performance, a proportionate price reduction, or withdrawal from the contract if the statutory conditions are met.",
    ],
  },
  {
    heading: "13. Alternative Consumer Dispute Resolution",
    body: [
      "13.1 If a consumer dispute arising from a Service contract cannot be resolved directly, the Consumer may submit it to the Czech Trade Inspection Authority, Central Inspectorate – ADR Department, Gorazdova 1969/24, 120 00 Prague 2.",
      <>
        13.2 Information and the electronic form are available at{" "}
        <a
          className="text-burned-orange underline underline-offset-4"
          href="https://coi.gov.cz/informace-o-adr/"
          rel="noreferrer"
          target="_blank"
        >
          coi.gov.cz/informace-o-adr/
        </a>
        . The Consumer must submit the claim no later than one year after first
        asserting the right with the Provider.
      </>,
    ],
  },
  {
    heading: "14. Special Provisions for Events",
    body: [
      "14.1 The Client is responsible for an individually arranged event and its participants.",
      "14.2 The Provider may end an event for a breach of law, the specific offer, these GTC, or the House Rules.",
    ],
  },
  {
    heading: "15. Final Provisions",
    body: [
      "15.1 The Provider may amend these GTC for contracts concluded after a new version takes effect. An already concluded Booking is governed by the version accepted at checkout unless a later amendment is more favorable to the Client or the Client expressly accepts it.",
      "15.2 An individual agreement takes precedence over these GTC. If one provision is invalid or ineffective, the remaining provisions are unaffected.",
      "15.3 These GTC become effective on August 12, 2026.",
      "15.4 These GTC are issued in Czech and English. If the language versions differ, the Czech version is authoritative and takes precedence.",
    ],
  },
];

const operatingRulesSectionsEn: LegalSection[] = [
  {
    heading: "1. Introductory Provisions",
    body: [
      <>
        1.1 These House Rules (hereinafter referred to as the "House Rules")
        govern the rules of conduct and the use of coworking spaces, the meeting
        room, the private office, and event spaces operated by {companyName}, ID
        No.: {workspaceSiteConstants.company.identificationNumber}, with its
        registered office at Turnovská 430/10, Prague 8 (hereinafter referred to
        as the "Operator").
      </>,
      '1.2 These House Rules are binding for all persons located on the Operator\'s premises (hereinafter referred to as the "User").',
      "1.3 A Client who makes a Booking must ensure that guests and everyone granted access are familiar with and comply with these House Rules.",
    ],
  },
  {
    heading: "2. Basic Rules of Conduct",
    body: [
      "2.1 The User is obliged to behave considerately and with respect toward other persons within the premises.",
      "2.2 In shared and common areas, a User must maintain a level of quiet corresponding to normal, quiet conversation. In a meeting room or private office, noise must be contained within the booked space.",
      "2.3 A User must not excessively disturb other users or restrict their use of the premises. The Client is responsible for guests' conduct.",
    ],
  },
  {
    heading: "3. Prohibitions on the Premises",
    body: [
      "3.1 The following are prohibited on the premises:",
      "a) smoking, including the use of electronic cigarettes;",
      "b) using narcotic or psychotropic substances;",
      "c) entering the premises under the influence of alcohol or other addictive substances to an extent that limits the ability for safe behavior;",
      "d) performing activities in violation of legal regulations;",
      "e) damaging the equipment or facilities of the premises;",
      "f) harassing other users with inappropriate or aggressive behavior;",
      "g) exceeding confirmed capacity or transferring or reselling a Booking to an unauthorized person;",
      "h) using the Premises' address as a registered office, business address, establishment, or mailing address without a written agreement.",
    ],
  },
  {
    heading: "4. Use of the Premises",
    body: [
      "4.1 The User is obliged to use the premises exclusively for purposes corresponding to their nature and designation.",
      "4.2 A meeting room or private office may be used only during the confirmed time and within the confirmed capacity. Users must leave it with all their belongings by the end of the Booking.",
      "4.3 The User must maintain order and cleanliness and return the used space and shared equipment to an appropriate condition after use.",
      "4.4 Without the Operator's consent, a User must not move equipment, make alterations, install devices, or interfere with technical systems.",
      "4.5 A User must operate audiovisual, conferencing, and other equipment according to instructions and report a defect without undue delay. Equipment must be safely switched off after the Booking where appropriate.",
    ],
  },
  {
    heading: "5. Refreshments",
    body: [
      "5.1 The User is obliged to use refreshments reasonably and with regard to other users.",
      "5.2 The User must not abuse refreshments or waste them without justification.",
    ],
  },
  {
    heading: "6. Safety",
    body: [
      "6.1 The User is obliged to look out for their own safety and the safety of other persons.",
      "6.2 The User must not block escape routes or otherwise jeopardize the safe operation of the premises.",
      "6.3 The User is obliged to notify the Operator of any dangerous situation or defect without undue delay.",
      "6.4 The Client may disclose an Access PIN Code only to people authorized to attend the Booking. Users must protect it from disclosure to or observation by an unauthorized person and take particular care when entering it.",
      "6.5 The period during which the Booking access page displays the PIN does not extend the authorized use of the Premises. Users may enter and remain only during the confirmed Booking time.",
      "6.6 Doors and other secured entrances must not be left open. Suspected code misuse or entry by an unauthorized person must be reported to the Operator without delay.",
      "6.7 The Client must ensure guests arrive and leave safely and must not grant them access outside the confirmed time or to other premises.",
      "6.8 The Operator or its authorized representative may enter a booked space when necessary for an emergency, safety, damage prevention, or essential maintenance and will inform the Client in advance where circumstances allow.",
    ],
  },
  {
    heading: "7. Liability for Damage",
    body: [
      "7.1 The User is liable for damage they cause to the Operator's property or the property of third parties.",
      "7.2 The Client is also responsible for damage caused by guests. Normal wear and tear is not damage.",
      "7.3 A User must immediately report damage, a lost key or access device, or a defect to the Operator.",
    ],
  },
  {
    heading: "8. Violation of House Rules",
    body: [
      "8.1 In the event of a violation of these House Rules, the Operator is entitled to take appropriate measures to ensure order and the protection of other users.",
      "8.2 Measures may include a request to remedy the breach, restricting access, removing a User from the premises, or ending a Booking where proportionate to the nature and seriousness of the breach.",
      "8.3 Where possible and the breach is not serious or dangerous, the Operator will give a reasonable opportunity to remedy it before ending a Booking.",
    ],
  },
  {
    heading: "9. Final Provisions",
    body: [
      "9.1 The Operator may amend these House Rules for future Bookings. A confirmed Booking is governed by the version accepted at checkout unless an immediate measure is necessary for safety or under mandatory law.",
      "9.2 These House Rules become effective on August 12, 2026.",
      "9.3 These House Rules are issued in Czech and English. If the language versions differ, the Czech version is authoritative and takes precedence.",
    ],
  },
];

const legalDocuments = {
  "en-US": {
    "privacy-policy": {
      title: "Privacy Policy",
      lead: "This page explains how Desktechub s.r.o. handles personal data submitted through the public Deskohub Workspace website, including contact and reservation forms.",
      updatedAt: "12 August 2026",
      sections: [
        {
          heading: "1. Controller",
          body: [
            <>
              The controller of your personal data is {companyName}, ID No.{" "}
              {workspaceSiteConstants.company.identificationNumber}, with
              establishment address at {companyAddress} and establishment ID{" "}
              {workspaceSiteConstants.company.establishmentId}.
            </>,
            commercialRegisterDisclosure["en-US"],
            <>
              If you have any privacy-related request, contact us at{" "}
              <a
                className="text-burned-orange underline underline-offset-4"
                href={`mailto:${contactEmail}`}
              >
                {contactEmail}
              </a>
              .
            </>,
          ],
        },
        {
          heading: "2. What data we process",
          body: [
            <>
              We process the data you provide through our public website,
              especially contact details and message content sent through the
              contact form, plus reservation details: your name, email, phone
              number, optional message, selected reservation family and product,
              date or date range, start time, duration, seat count, and any
              coworking refreshment, monitor, or workstation preferences.
            </>,
            <>
              When you continue to checkout, we also process the quoted and paid
              amount, currency, applied discounts, payment and reservation
              identifiers and status, accepted legal-document references and
              hashes, related checkout acknowledgements, access and fulfillment
              status, and any optional billing details you request us to use for
              an accounting document. We do not receive your complete
              payment-card details from the payment provider.
            </>,
            <>
              For website operation and abuse prevention, we may also process
              limited technical data such as IP address, User-Agent, origin or
              host information where available, and short-lived rate-limit or
              anti-spam signals connected with a submission.
            </>,
            <>
              If you consent to analytics cookies or similar technologies, we
              and our analytics service providers may process website usage and
              campaign measurement data, such as pageviews, browser and device
              information, IP-derived technical data, event types, and standard
              campaign parameters from URLs. These campaign parameters are
              limited to utm_source, utm_medium, utm_campaign, utm_content, and
              utm_term.
            </>,
            <>
              If you separately opt in to marketing emails, we also process your
              name, email address, preferred language, consent time, and the
              version of the marketing notice you accepted.
            </>,
          ],
        },
        {
          heading: "3. Why we process the data",
          body: [
            <>
              We use submitted contact, reservation, order, and payment data to
              check availability, prepare and confirm a Booking, hold capacity,
              collect or verify payment, issue access, send confirmations,
              provide requested accounting documents, handle cancellation or
              complaints, prevent duplicate or fraudulent orders, and support
              the Booking when you contact us.
            </>,
            <>
              We do not use reservation or enquiry data for marketing unless you
              separately consent to receive marketing communication.
            </>,
            <>
              When you give that optional consent, we use your email address to
              send occasional Deskohub Workspace news, event invitations, and
              offers. We do not share the marketing list with third parties for
              their own marketing.
            </>,
            <>
              With your analytics consent, we use analytics and external
              measurement services to understand site usage, reservation
              submission performance, and campaign effectiveness. Reservation
              submitted conversion events are used only at category and purpose
              level and do not include reservation form values or personal
              details such as name, email, phone, message, reservation date,
              selected tier, coffee preference, or monitor preference.
            </>,
          ],
        },
        {
          heading: "4. Legal basis",
          body: [
            <>
              Before a contract is concluded, we process reservation data to
              take steps at your request. After conclusion, we process it to
              perform the contract, including payment, access, support,
              cancellation, and complaints. We process accounting and
              transaction records where necessary to comply with legal
              obligations.
            </>,
            <>
              For website security, abuse and fraud prevention, reliable payment
              and reservation evidence, and the establishment, exercise, or
              defense of legal claims, we rely on our legitimate interests where
              those interests are not overridden by your rights.
            </>,
            <>
              Optional non-essential cookies are processed only on the basis of
              your consent. Analytics and campaign measurement processing is
              based on consent, which you can withdraw or change at any time via
              cookie settings.
            </>,
            <>
              Marketing emails are based on your separate consent. Giving this
              consent is voluntary and is not a condition of making or paying
              for a reservation.
            </>,
          ],
        },
        {
          heading: "5. Retention period",
          body: [
            <>
              We keep unsuccessful enquiries and abandoned reservation data only
              for as long as needed to handle the request, recover an incomplete
              checkout, prevent abuse, or protect legal claims. For completed
              Bookings, we retain the transaction, accounting, legal-acceptance,
              and complaint records for the periods required by applicable law
              or reasonably necessary to establish, exercise, or defend legal
              claims. Technical abuse-prevention signals are short-lived.
            </>,
            <>
              Analytics and campaign measurement data is retained according to
              the applicable analytics and technical provider settings and only
              as long as necessary for the stated measurement purposes.
            </>,
            <>
              We keep marketing contact and consent evidence until you withdraw
              your consent or the stated purpose ends. After withdrawal, we may
              retain a minimal suppression record so that we do not add the
              address back to marketing mailings by mistake.
            </>,
          ],
        },
        {
          heading: "6. Recipients",
          body: [
            <>
              Your data may be accessed by our internal workspace team and, as
              necessary for their role, by providers of website hosting,
              reservation and customer management, payment processing, email
              delivery, accounting-document generation, security, analytics,
              external measurement, and other technical services. Payment data
              is sent to the payment provider only to create and verify the
              transaction. We use appropriate contractual, organizational, and
              technical safeguards for provider access.
            </>,
            <>
              When you opt in to marketing emails, our email delivery provider
              may process the contact and delivery information needed to send
              them on our behalf.
            </>,
          ],
        },
        {
          heading: "7. Your rights",
          body: [
            <>
              Under applicable data protection law, you may request access,
              rectification, erasure, restriction, objection, or data
              portability where applicable. You may lodge a complaint with the
              Czech Office for Personal Data Protection at{" "}
              <a
                className="text-burned-orange underline underline-offset-4"
                href="https://uoou.gov.cz/en"
                rel="noreferrer"
                target="_blank"
              >
                uoou.gov.cz
              </a>
              .
            </>,
            <>
              You can withdraw marketing consent at any time through the
              unsubscribe option in a marketing email or by contacting us at{" "}
              <a
                className="text-burned-orange underline underline-offset-4"
                href={`mailto:${contactEmail}`}
              >
                {contactEmail}
              </a>
              . Withdrawal does not affect processing that took place before it.
            </>,
          ],
        },
      ],
    },
    "marketing-communications": {
      title: "Marketing Communications Consent",
      lead: "This notice records the optional consent you can give to receive Deskohub Workspace marketing emails from Desktechub s.r.o.",
      updatedAt: "5 August 2026",
      sections: [
        {
          heading: "1. Who will contact you",
          body: [
            <>
              The sender and controller is {companyName}, ID No.{" "}
              {workspaceSiteConstants.company.identificationNumber}, at{" "}
              {companyAddress}.
            </>,
          ],
        },
        {
          heading: "2. What you agree to",
          body: [
            "You agree that we may use your name and email address to send occasional commercial emails about Deskohub Workspace news, event invitations, and offers.",
            "The consent covers marketing by email for our own Deskohub Workspace services. We do not give your contact details to another business for its own marketing.",
          ],
        },
        {
          heading: "3. Your choice",
          body: [
            "This consent is voluntary and separate from your reservation. Leaving the marketing checkbox unchecked does not prevent you from making or paying for a reservation.",
            "We process marketing contact data on the basis of this consent and record the time and version of the notice so that the consent can be demonstrated.",
          ],
        },
        {
          heading: "4. Withdrawal and retention",
          body: [
            <>
              You can withdraw your consent at any time by using the unsubscribe
              option in a marketing email or by writing to{" "}
              <a
                className="text-burned-orange underline underline-offset-4"
                href={`mailto:${contactEmail}`}
              >
                {contactEmail}
              </a>
              . Withdrawal applies to future marketing and does not affect prior
              lawful processing.
            </>,
            "We retain marketing contact and consent evidence until you withdraw consent or the purpose ends. We may then keep a minimal suppression record to prevent accidental resubscription.",
          ],
        },
        {
          heading: "5. Providers and your rights",
          body: [
            <>
              Our email delivery provider may process the data needed to deliver
              and measure these messages on our behalf. More information about
              recipients, safeguards, and your data protection rights is in our{" "}
              <a
                className="text-burned-orange underline underline-offset-4"
                href="/en-US/privacy-policy"
              >
                Privacy Policy
              </a>
              .
            </>,
          ],
        },
      ],
    },
    "terms-and-conditions": {
      title: "General Terms and Conditions",
      lead: "These General Terms and Conditions govern coworking entries and online meeting-room and private-office bookings at Deskohub Workspace.",
      updatedAt: "12 August 2026",
      sections: termsAndConditionsSectionsEn,
    },
    "cookie-policy": {
      title: "Cookie Policy",
      lead: "This page explains how the Deskohub Workspace website uses cookies and how you can manage your preferences.",
      updatedAt: "12 August 2026",
      sections: [
        {
          heading: "1. What cookies are",
          body: [
            <>
              Cookies are small text files stored in your browser that help a
              website remember technical choices, improve usability, and
              understand whether optional features may be enabled.
            </>,
          ],
        },
        {
          heading: "2. Necessary cookies",
          body: [
            <>
              Necessary cookies support core website operation, language
              handling, security, and storing your cookie consent state. These
              cookies are always active because the site cannot work reliably
              without them.
            </>,
          ],
        },
        {
          heading: "3. Preference cookies",
          body: [
            <>
              Preference cookies remember optional display or interaction
              settings when such features are enabled on the website.
            </>,
          ],
        },
        {
          heading: "4. Analytics and marketing cookies",
          body: [
            <>
              Analytics and marketing cookies are optional. If analytics,
              external measurement, campaign measurement, or similar technical
              provider tools are used on the site, they are activated only after
              your consent through the cookie banner or the cookie settings
              page.
            </>,
            <>
              Analytics cookies help us understand site usage, reservation
              submission performance, and campaign effectiveness. Depending on
              the provider category, the processed data may include pageviews,
              browser and device information, IP-derived technical data, event
              types, and standard campaign parameters from URLs: utm_source,
              utm_medium, utm_campaign, utm_content, and utm_term.
            </>,
            <>
              Reservation submitted conversion events do not include reservation
              form values or personal details such as name, email, phone,
              message, reservation dates or times, duration, seat count,
              selected product, or refreshment, monitor, or workstation choices.
            </>,
          ],
        },
        {
          heading: "5. How to manage consent",
          body: [
            <>
              You can accept all optional categories, reject non-essential
              categories, or manage them individually through the cookie banner
              and the dedicated cookie settings page linked in the footer.
            </>,
          ],
        },
      ],
    },
    "operating-rules": {
      title: "House Rules",
      lead: "These House Rules govern conduct and the use of Deskohub Workspace coworking spaces, meeting room, private office, and event spaces.",
      updatedAt: "12 August 2026",
      sections: operatingRulesSectionsEn,
    },
  },
  "cs-CZ": {
    "privacy-policy": {
      title: "Zásady ochrany osobních údajů",
      lead: "Na této stránce vysvětlujeme, jak Desktechub s.r.o. nakládá s osobními údaji zaslanými přes veřejný web Deskohub Workspace, včetně kontaktního a rezervačního formuláře.",
      updatedAt: "12. srpna 2026",
      sections: [
        {
          heading: "1. Správce",
          body: [
            <>
              {companyName}, IČO{" "}
              {workspaceSiteConstants.company.identificationNumber}, s adresou
              provozovny {companyAddress} a ID provozovny{" "}
              {workspaceSiteConstants.company.establishmentId}, je správcem
              vašich osobních údajů.
            </>,
            commercialRegisterDisclosure["cs-CZ"],
            <>
              V případě dotazů k ochraně osobních údajů nám napište na{" "}
              <a
                className="text-burned-orange underline underline-offset-4"
                href={`mailto:${contactEmail}`}
              >
                {contactEmail}
              </a>
              .
            </>,
          ],
        },
        {
          heading: "2. Jaké údaje zpracováváme",
          body: [
            <>
              Zpracováváme údaje, které nám poskytnete přes veřejný web, zejména
              kontaktní údaje a obsah zprávy odeslané přes kontaktní formulář a
              údaje o rezervaci: jméno, e-mail, telefonní číslo, volitelnou
              zprávu, vybranou rodinu a produkt rezervace, datum nebo rozsah
              dat, čas začátku, dobu trvání, počet míst a případné coworkingové
              preference občerstvení, monitorů nebo pracovní stanice.
            </>,
            <>
              Při pokračování k objednávce zpracováváme také nabízenou a
              zaplacenou částku, měnu, použité slevy, identifikátory a stav
              platby a rezervace, odkazy a otisky přijatých právních dokumentů,
              související potvrzení učiněná při objednávce, stav přístupu a
              dokončení Služby a volitelné fakturační údaje, které požadujete
              použít na účetním dokladu. Od poskytovatele plateb nezískáváme
              úplné údaje vaší platební karty.
            </>,
            <>
              Pro provoz webu a ochranu před zneužitím můžeme zpracovávat také
              omezené technické údaje, například IP adresu, User-Agent,
              informace o originu nebo hostu, pokud jsou dostupné, a krátkodobé
              signály pro rate limiting nebo ochranu proti spamu související s
              odesláním formuláře.
            </>,
            <>
              Pokud udělíte souhlas s analytickými cookies nebo obdobnými
              technologiemi, můžeme my a poskytovatelé analytických služeb
              zpracovávat údaje o používání webu a měření kampaní, například
              zobrazení stránek, informace o prohlížeči a zařízení, technické
              údaje odvozené z IP adresy, typy událostí a standardní kampanové
              parametry z URL. Tyto kampanové parametry jsou omezené na
              utm_source, utm_medium, utm_campaign, utm_content a utm_term.
            </>,
            <>
              Pokud se samostatně přihlásíte k odběru marketingových e-mailů,
              zpracováváme také vaše jméno, e-mailovou adresu, preferovaný
              jazyk, čas souhlasu a verzi marketingového sdělení, se kterou jste
              souhlasili.
            </>,
          ],
        },
        {
          heading: "3. Za jakým účelem údaje používáme",
          body: [
            <>
              Kontaktní, rezervační, objednávkové a platební údaje používáme k
              ověření dostupnosti, přípravě a potvrzení Rezervace, dočasnému
              držení kapacity, přijetí nebo ověření platby, vydání přístupu,
              zaslání potvrzení, vystavení požadovaného účetního dokladu,
              vyřízení storna nebo reklamace, prevenci duplicitních či
              podvodných objednávek a podpoře Rezervace, když nás kontaktujete.
            </>,
            <>
              Rezervační ani poptávkové údaje nepoužíváme pro marketing, pokud k
              tomu neudělíte samostatný souhlas.
            </>,
            <>
              Pokud tento nepovinný souhlas udělíte, používáme váš e-mail k
              občasnému zasílání novinek, pozvánek na akce a nabídek Deskohub
              Workspace. Marketingový seznam neposkytujeme třetím stranám pro
              jejich vlastní marketing.
            </>,
            <>
              S vaším analytickým souhlasem používáme analytické a externí
              měřicí služby, abychom porozuměli používání webu, výkonu odeslání
              rezervací a účinnosti kampaní. Konverzní události o odeslání
              rezervace používáme pouze na úrovni kategorie a účelu a neobsahují
              hodnoty z rezervačního formuláře ani osobní údaje, jako je jméno,
              e-mail, telefon, zpráva, datum rezervace, vybraný tarif,
              preference kávy nebo preference monitorů.
            </>,
          ],
        },
        {
          heading: "4. Právní základ",
          body: [
            <>
              Před uzavřením smlouvy zpracováváme rezervační údaje k provedení
              opatření na vaši žádost. Po uzavření smlouvy je zpracováváme k
              jejímu plnění, včetně platby, přístupu, podpory, storna a
              reklamací. Účetní a transakční záznamy zpracováváme také pro
              splnění právních povinností.
            </>,
            <>
              Pro zabezpečení webu, prevenci zneužití a podvodů, spolehlivé
              doložení platby a rezervace a určení, výkon nebo obhajobu právních
              nároků vycházíme z našich oprávněných zájmů, nepřevažují-li nad
              nimi vaše práva.
            </>,
            <>
              Nepovinné cookies zpracováváme pouze na základě vašeho souhlasu.
              Analytické a kampanové měření je založené na souhlasu, který
              můžete kdykoli odvolat nebo změnit v nastavení cookies.
            </>,
            <>
              Marketingové e-maily zasíláme na základě vašeho samostatného
              souhlasu. Udělení souhlasu je dobrovolné a není podmínkou pro
              vytvoření ani zaplacení rezervace.
            </>,
          ],
        },
        {
          heading: "5. Doba uchování",
          body: [
            <>
              Údaje z neúspěšných poptávek a opuštěných rezervací uchováváme jen
              po dobu potřebnou k vyřízení požadavku, obnovení nedokončené
              objednávky, prevenci zneužití nebo ochraně právních nároků. U
              dokončených Rezervací uchováváme transakční, účetní, reklamační a
              právní záznamy po dobu vyžadovanou právními předpisy nebo rozumně
              nutnou k určení, výkonu či obhajobě právních nároků. Technické
              signály pro ochranu před zneužitím jsou krátkodobé.
            </>,
            <>
              Analytické údaje a údaje pro kampanové měření uchováváme podle
              nastavení příslušných analytických a technických poskytovatelů a
              pouze po dobu potřebnou pro uvedené účely měření.
            </>,
            <>
              Marketingový kontakt a doklad o souhlasu uchováváme do odvolání
              souhlasu nebo ukončení uvedeného účelu. Po odvolání můžeme uchovat
              minimální záznam v seznamu blokovaných adres, abychom e-mail
              omylem znovu nezařadili do marketingových rozesílek.
            </>,
          ],
        },
        {
          heading: "6. Příjemci",
          body: [
            <>
              K údajům může mít přístup náš interní workspace tým a v rozsahu
              nezbytném pro jejich roli poskytovatelé hostingu, rezervačního a
              zákaznického systému, zpracování plateb, doručování e-mailů,
              tvorby účetních dokladů, zabezpečení, analytiky, externího měření
              a dalších technických služeb. Platební údaje předáváme
              poskytovateli plateb pouze pro vytvoření a ověření transakce. Pro
              přístup poskytovatelů používáme přiměřené smluvní, organizační a
              technické záruky.
            </>,
            <>
              Pokud se přihlásíte k marketingovým e-mailům, může náš
              poskytovatel e-mailových služeb zpracovávat kontaktní a doručovací
              údaje potřebné k jejich odeslání naším jménem.
            </>,
          ],
        },
        {
          heading: "7. Vaše práva",
          body: [
            <>
              Podle platných předpisů můžete požadovat přístup, opravu, výmaz,
              omezení zpracování, vznést námitku nebo požadovat přenositelnost
              údajů, pokud je použitelná. Stížnost můžete podat u Úřadu pro
              ochranu osobních údajů na{" "}
              <a
                className="text-burned-orange underline underline-offset-4"
                href="https://uoou.gov.cz/"
                rel="noreferrer"
                target="_blank"
              >
                uoou.gov.cz
              </a>
              .
            </>,
            <>
              Marketingový souhlas můžete kdykoli odvolat prostřednictvím
              možnosti odhlášení v marketingovém e-mailu nebo zprávou na{" "}
              <a
                className="text-burned-orange underline underline-offset-4"
                href={`mailto:${contactEmail}`}
              >
                {contactEmail}
              </a>
              . Odvolání nemá vliv na zpracování, které proběhlo před jeho
              odvoláním.
            </>,
          ],
        },
      ],
    },
    "marketing-communications": {
      title: "Souhlas s marketingovou komunikací",
      lead: "Toto oznámení zachycuje nepovinný souhlas se zasíláním marketingových e-mailů Deskohub Workspace společností Desktechub s.r.o.",
      updatedAt: "5. srpna 2026",
      sections: [
        {
          heading: "1. Kdo vás bude kontaktovat",
          body: [
            <>
              Odesílatelem a správcem je {companyName}, IČO{" "}
              {workspaceSiteConstants.company.identificationNumber}, na adrese{" "}
              {companyAddress}.
            </>,
          ],
        },
        {
          heading: "2. S čím souhlasíte",
          body: [
            "Souhlasíte, že můžeme vaše jméno a e-mailovou adresu použít k občasnému zasílání obchodních sdělení o novinkách, pozvánkách na akce a nabídkách Deskohub Workspace.",
            "Souhlas se vztahuje na e-mailový marketing našich vlastních služeb Deskohub Workspace. Vaše kontaktní údaje neposkytujeme jiné společnosti pro její vlastní marketing.",
          ],
        },
        {
          heading: "3. Vaše volba",
          body: [
            "Souhlas je dobrovolný a oddělený od rezervace. Pokud marketingové políčko nezaškrtnete, nijak vám to nebrání rezervaci vytvořit ani zaplatit.",
            "Marketingové kontaktní údaje zpracováváme na základě tohoto souhlasu a zaznamenáváme čas a verzi oznámení, abychom mohli udělení souhlasu doložit.",
          ],
        },
        {
          heading: "4. Odvolání a doba uchování",
          body: [
            <>
              Souhlas můžete kdykoli odvolat prostřednictvím možnosti odhlášení
              v marketingovém e-mailu nebo zprávou na{" "}
              <a
                className="text-burned-orange underline underline-offset-4"
                href={`mailto:${contactEmail}`}
              >
                {contactEmail}
              </a>
              . Odvolání platí pro budoucí marketing a nemá vliv na předchozí
              zákonné zpracování.
            </>,
            "Marketingový kontakt a doklad o souhlasu uchováváme do odvolání souhlasu nebo ukončení účelu. Poté můžeme ponechat minimální záznam v seznamu blokovaných adres, abychom zabránili nechtěnému opětovnému přihlášení.",
          ],
        },
        {
          heading: "5. Poskytovatelé a vaše práva",
          body: [
            <>
              Náš poskytovatel e-mailových služeb může naším jménem zpracovávat
              údaje potřebné k doručení a měření těchto zpráv. Více informací o
              příjemcích, zárukách a vašich právech najdete v našich{" "}
              <a
                className="text-burned-orange underline underline-offset-4"
                href="/cs-CZ/privacy-policy"
              >
                zásadách ochrany osobních údajů
              </a>
              .
            </>,
          ],
        },
      ],
    },
    "terms-and-conditions": {
      title: "Všeobecné obchodní podmínky",
      lead: "Tyto všeobecné obchodní podmínky upravují coworkingové vstupy a online rezervace zasedací místnosti a soukromé kanceláře v Deskohub Workspace.",
      updatedAt: "12. srpna 2026",
      sections: termsAndConditionsSections,
    },
    "cookie-policy": {
      title: "Zásady používání cookies",
      lead: "Na této stránce vysvětlujeme, jak web Deskohub Workspace používá cookies a jak můžete spravovat své preference.",
      updatedAt: "12. srpna 2026",
      sections: [
        {
          heading: "1. Co jsou cookies",
          body: [
            <>
              Cookies jsou malé textové soubory uložené v prohlížeči, které webu
              pomáhají pamatovat si technické volby, zlepšovat použitelnost a
              řídit zapnutí volitelných funkcí.
            </>,
          ],
        },
        {
          heading: "2. Nezbytné cookies",
          body: [
            <>
              Nezbytné cookies podporují základní provoz webu, práci s jazykem,
              zabezpečení a uložení stavu vašeho souhlasu s cookies. Tyto
              cookies jsou vždy aktivní, protože bez nich web nemůže spolehlivě
              fungovat.
            </>,
          ],
        },
        {
          heading: "3. Preferenční cookies",
          body: [
            <>
              Preferenční cookies si pamatují volitelná nastavení zobrazení nebo
              interakce, pokud jsou takové funkce na webu aktivní.
            </>,
          ],
        },
        {
          heading: "4. Analytické a marketingové cookies",
          body: [
            <>
              Analytické a marketingové cookies jsou volitelné. Pokud jsou
              analytické, externí měřicí, kampanové nebo obdobné technické
              nástroje poskytovatelů na webu využité, aktivují se až po vašem
              souhlasu přes cookie banner nebo stránku s nastavením cookies.
            </>,
            <>
              Analytické cookies nám pomáhají porozumět používání webu, výkonu
              odesílání rezervací a účinnosti kampaní. Podle kategorie
              poskytovatele mohou zpracovávané údaje zahrnovat zobrazení
              stránek, informace o prohlížeči a zařízení, technické údaje
              odvozené z IP adresy, typy událostí a standardní kampanové
              parametry z URL: utm_source, utm_medium, utm_campaign, utm_content
              a utm_term.
            </>,
            <>
              Konverzní události o odeslání rezervace neobsahují hodnoty z
              rezervačního formuláře ani osobní údaje, jako je jméno, e-mail,
              telefon, zpráva, data nebo časy rezervace, doba trvání, počet
              míst, vybraný produkt ani volby občerstvení, monitoru nebo
              pracovní stanice.
            </>,
          ],
        },
        {
          heading: "5. Jak spravovat souhlas",
          body: [
            <>
              Můžete přijmout všechny volitelné kategorie, odmítnout nepovinné
              kategorie nebo je spravovat jednotlivě přes cookie banner a
              samostatnou stránku s nastavením cookies dostupnou z patičky.
            </>,
          ],
        },
      ],
    },
    "operating-rules": {
      title: "Provozní řád",
      lead: "Tento provozní řád upravuje chování a užívání coworkingových prostor, zasedací místnosti, soukromé kanceláře a eventových prostor Deskohub Workspace.",
      updatedAt: "12. srpna 2026",
      sections: operatingRulesSections,
    },
  },
} satisfies Record<Locale, Record<LegalDocumentKey, LegalDocumentContent>>;

export function getLegalDocument(
  locale: Locale,
  documentKey: LegalDocumentKey
) {
  return legalDocuments[locale][documentKey];
}
