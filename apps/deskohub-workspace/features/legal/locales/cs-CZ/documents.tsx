import { workspaceSiteConstants } from "@/shared/utils";
import type {
  LegalDocumentBodies,
  LegalSection,
} from "../../legal-document-body";
import { companyAddress, companyName, contactEmail } from "../operator-details";

const commercialRegisterDisclosure =
  "Údaje o zápisu v obchodním rejstříku jsou k dispozici v odkazovaném oficiálním výpisu společnosti.";

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
      "7.1 Potvrzovací email obsahuje bezpečný odkaz na přístupovou stránku Rezervace. Jakmile je Rezervace zaplacená, potvrzená a živě ověřená a má vystaven přístupový PIN kód, zobrazuje chráněná stránka tento PIN společně s přesně naprogramovanými hranicemi platnosti kódu. Přijímání kódu zamykacím systémem určuje výhradně naprogramované hranice AlgoPINu; aplikace nesdílejí vlastní hodiny. PIN není obsažen přímo v potvrzovacím emailu.",
      "7.2 Poskytovatel může přístupový PIN změnit; Klient použije kód aktuálně zobrazený na přístupové stránce Rezervace. Zobrazení PIN kódu neprodlužuje potvrzenou dobu užívání Prostor a nezakládá právo na přístup mimo tuto dobu nebo do jiných prostor. Používání Prostor je možné pouze v potvrzené době Rezervace.",
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
      "6.5 Zobrazení PIN kódu na přístupové stránce Rezervace nijak neomezuje ani neprodlužuje dobu oprávněného užívání prostor; o přijímání kódu rozhoduje výhradně zamykací systém. Uživatelé smějí vstoupit a pobývat v prostorách pouze v potvrzené době Rezervace.",
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

export const legalDocuments = {
  "privacy-policy": {
    updatedAt: "8. listopadu 2026",
    sections: [
      {
        heading: "1. Správce",
        body: [
          <>
            {companyName}, IČO{" "}
            {workspaceSiteConstants.company.identificationNumber}, s adresou
            provozovny {companyAddress} a ID provozovny{" "}
            {workspaceSiteConstants.company.establishmentId}, je správcem vašich
            osobních údajů.
          </>,
          commercialRegisterDisclosure,
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
            údaje o rezervaci: jméno, e-mail, telefonní číslo, vybranou rodinu a
            produkt rezervace, datum nebo rozsah dat, čas začátku, dobu trvání,
            počet míst a případné coworkingové preference občerstvení, monitorů
            nebo pracovní stanice.
          </>,
          <>
            Při pokračování k objednávce zpracováváme také nabízenou a
            zaplacenou částku, měnu, použité slevy, identifikátory a stav platby
            a rezervace, které podmínky jste přijali a kdy, zda byl vydán
            přístup, a volitelné fakturační údaje, které požadujete použít na
            účetním dokladu. Od poskytovatele plateb nezískáváme úplné údaje
            vaší platební karty.
          </>,
          <>
            Pokud si vytvoříte zákaznický účet, zpracováváme vaši ověřenou
            e-mailovou adresu, údaje profilu a přihlašovací údaje potřebné k
            zabezpečení účtu. Heslo po vás nikdy nechceme.
          </>,
          <>
            Pokud ke svému zákaznickému účtu připojíte AI asistenta, například
            ChatGPT nebo Claude, zpracováváme údaje o tom, o kterého asistenta
            jde, jaká oprávnění jste mu udělili a kdy, a přístupové údaje, které
            asistent používá. Když asistent vaším jménem zahájí rezervaci,
            zaznamenáme k ní, který asistent ji zahájil.
          </>,
          <>
            Pro provoz webu a ochranu před spamem a zneužitím můžeme krátkodobě
            zpracovávat také technické údaje, například vaši IP adresu a údaje o
            prohlížeči.
          </>,
          <>
            Abychom porozuměli tomu, jak web používají vyhledávače a AI
            asistenti, řadíme požadavky podle údajů o prohlížeči do obecných
            kategorií provozu. Poskytovateli analytických služeb sdělujeme pouze
            tuto kategorii, název rozpoznaného asistenta nebo vyhledávače,
            stránku a jazyk, formulář, který se zablokovaný automatizovaný
            požadavek pokusil použít, a u našich rezervačních nástrojů pro AI
            asistenty to, který nástroj byl použit a zda uspěl. Nepředáváme nic,
            co by vás identifikovalo, a toto měření nezávisí na souhlasu s
            analytikou. Tuto kategorii a název rozpoznaného asistenta
            připojujeme také k záznamům o rezervacích a platbách popsaným v bodě
            3.
          </>,
          <>
            Pokud udělíte souhlas s analytickými cookies nebo obdobnými
            technologiemi, můžeme my a poskytovatelé analytických služeb
            zpracovávat údaje o používání webu a měření kampaní, například
            zobrazení stránek, informace o prohlížeči a zařízení, technické
            údaje odvozené z IP adresy, typy událostí a standardní kampanové
            parametry z odkazů. S vaším analytickým souhlasem přiřazujeme k
            analytickému profilu vašeho účtu také záznamy o vašich rezervacích a
            platbách popsané v bodě 3.
          </>,
          <>
            Pokud se samostatně přihlásíte k odběru budoucích marketingových
            sdělení, zpracováváme také vaše jméno, e-mailovou adresu,
            preferovaný jazyk, čas souhlasu a verzi marketingového oznámení,
            které jste přijali. Zaznamenáváme také, kde jste souhlas udělili,
            například v rezervačním formuláři, ve svém účtu nebo prostřednictvím
            asistenta, a vaši volbu uchováváme u vašeho zákaznického záznamu.
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
            zaslání potvrzení, vystavení požadovaného účetního dokladu, vyřízení
            storna nebo reklamace, prevenci duplicitních či podvodných
            objednávek a podpoře Rezervace, když nás kontaktujete.
          </>,
          <>
            Údaje zákaznického účtu používáme k vašemu ověření, správě vašeho
            profilu a propojení účtu s rezervacemi vytvořenými se stejnou
            ověřenou e-mailovou adresou.
          </>,
          <>
            Pokud připojíte AI asistenta, používáme jeho připojení k tomu, aby
            podle vašich pokynů mohl vyhledat naši nabídku, zahájit rezervaci,
            kterou pak potvrdíte a zaplatíte na našem webu, a zobrazit vám vaše
            rezervace.
          </>,
          <>
            Rezervační ani poptávkové údaje nepoužíváme pro marketing, pokud k
            tomu neudělíte samostatný souhlas.
          </>,
          <>
            Pokud tento nepovinný souhlas udělíte, můžeme vaši e-mailovou adresu
            použít pro budoucí marketingová a komunitní sdělení Deskohub
            Workspace. Vaše kontaktní údaje neposkytujeme jiné společnosti pro
            její vlastní marketing.
          </>,
          <>
            S vaším analytickým souhlasem používáme analytické a externí měřicí
            služby, abychom porozuměli používání webu, výkonu odeslání rezervací
            a účinnosti kampaní. Toto měření nezahrnuje údaje, které zadáte do
            rezervačního formuláře.
          </>,
          <>
            Bez ohledu na analytický souhlas také předáváme poskytovateli
            analytických služeb záznam o jednotlivých krocích rezervace a
            platby, například o zahájené, dokončené, neúspěšné nebo opuštěné
            platbě a její částce. Tyto záznamy používáme k měření průběhu
            rezervací a plateb a k odhalování problémů s platbami. Jsou spojené
            s vaší rezervací a s vaším analytickým souhlasem také s analytickým
            profilem vašeho účtu. Neobsahují vaše jméno ani kontaktní údaje.
          </>,
          <>
            Vybrané zákaznické údaje z našeho rezervačního systému Dotypos také
            předáváme našemu analytickému poskytovateli, abychom porozuměli
            tomu, jak zákazníci využívají naše služby a jak to souvisí s jejich
            aktivitou na webu: identifikátor zákazníka, jméno, název
            společnosti, e-mail, telefon, adresu, datum narození, slevovou
            skupinu, věrnostní body, štítky zákazníka a údaj o tom, kdy byl
            záznam zákazníka vytvořen, naposledy změněn nebo smazán. Poznámky a
            další zákaznické údaje zůstávají v Dotypos. U přihlášeného
            zákazníka, který udělil analytický souhlas, propojuje identifikátor
            zákazníka tyto údaje s jeho analytikou webu.
          </>,
        ],
      },
      {
        heading: "4. Právní základ",
        body: [
          <>
            Před uzavřením smlouvy zpracováváme rezervační údaje k provedení
            opatření na vaši žádost. Po uzavření smlouvy je zpracováváme k
            jejímu plnění, včetně platby, přístupu, podpory, storna a reklamací.
            Účetní a transakční záznamy zpracováváme také pro splnění právních
            povinností.
          </>,
          <>
            Přihlášení k účtu, správu profilu a historii rezervací zpracováváme,
            abychom poskytli službu účtu, o kterou si žádáte, a podle okolností
            také plnili nebo připravovali související rezervační smlouvu.
            Zabezpečení účtu, integrita relací a ochrana před zneužitím
            vycházejí z našich oprávněných zájmů.
          </>,
          <>
            Připojení AI asistenta a vyřizování jeho požadavků zpracováváme,
            abychom poskytli službu účtu, o kterou si žádáte, a podle okolností
            na vaši žádost připravili související rezervační smlouvu.
          </>,
          <>
            Pro zabezpečení webu, prevenci zneužití a podvodů, spolehlivé
            doložení platby a rezervace a určení, výkon nebo obhajobu právních
            nároků vycházíme z našich oprávněných zájmů, nepřevažují-li nad nimi
            vaše práva.
          </>,
          <>
            Nepovinné cookies zpracováváme pouze na základě vašeho souhlasu.
            Analytika vašeho používání webu a měření kampaní jsou založené na
            souhlasu, který můžete kdykoli odvolat nebo změnit v nastavení
            cookies.
          </>,
          <>
            Měření automatizovaného provozu podle kategorií vychází z našeho
            oprávněného zájmu na provozu webu a jeho zlepšování pro vyhledávače
            a AI asistenty. Nepoužívá žádné údaje, které by vás identifikovaly.
          </>,
          <>
            Zaznamenávání kroků rezervace a platby vychází z našeho oprávněného
            zájmu měřit průběh rezervací a plateb a odhalovat neúspěšné nebo
            opuštěné platby, nepřevažují-li nad ním vaše práva. Proti tomuto
            zpracování můžete kdykoli vznést námitku. Propojení těchto záznamů s
            analytickým profilem vašeho účtu vychází z vašeho analytického
            souhlasu.
          </>,
          <>
            Předávání zákaznických údajů z našeho rezervačního systému
            analytickému poskytovateli vychází z našeho oprávněného zájmu
            porozumět našim službám a zlepšovat je, nepřevažují-li nad ním vaše
            práva. Proti tomuto zpracování můžete kdykoli vznést námitku.
          </>,
          <>
            Budoucí marketingová sdělení jsou založena na vašem samostatném
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
            Zákaznický účet uchováváme po dobu jeho používání; přihlašovací
            relace a odkazy automaticky vyprší a pravidelně je mažeme. Smazáním
            účtu smažeme vaše přihlašovací údaje a deaktivujeme propojený
            zákaznický profil. Rezervační, platební, účetní záznamy a záznamy
            potřebné pro prevenci podvodů nebo právní důkazy se spolu s
            přihlašovacím účtem nemažou a zůstávají pouze po příslušnou smluvní,
            zákonnou nebo oprávněnou dobu uchování.
          </>,
          <>
            Přístupové údaje připojeného asistenta automaticky vyprší a
            pravidelně je mažeme. Připojení a udělená oprávnění trvají, dokud
            asistenta neodpojíte v sekci Připojení asistenti ve svém účtu nebo
            dokud nesmažete účet. Odpojením asistenta nebo smazáním účtu se
            připojení a oprávnění okamžitě ukončí: přístupové údaje asistenta
            okamžitě přestanou fungovat a smažou se. Údaj o tom, který asistent
            rezervaci zahájil, zůstává u záznamu rezervace.
          </>,
          <>
            Analytické údaje a údaje pro kampanové měření, včetně zákaznických
            údajů předaných analytickému poskytovateli, uchováváme podle
            nastavení příslušných analytických a technických poskytovatelů a
            pouze po dobu potřebnou pro uvedené účely měření.
          </>,
          <>
            Záznam o vašem marketingovém souhlasu, včetně jeho odvolání,
            uchováváme u vašeho zákaznického záznamu, abychom mohli doložit, jak
            jste se rozhodli.
          </>,
        ],
      },
      {
        heading: "6. Příjemci",
        body: [
          <>
            K údajům může mít přístup náš interní workspace tým a v rozsahu
            nezbytném pro jejich roli poskytovatelé hostingu, rezervačního a
            zákaznického systému, zpracování plateb, doručování e-mailů, tvorby
            účetních dokladů, zabezpečení, analytiky, externího měření a dalších
            technických služeb. Platební údaje předáváme poskytovateli plateb
            pouze pro vytvoření a ověření transakce. Pro přístup poskytovatelů
            používáme přiměřené smluvní, organizační a technické záruky.
          </>,
          <>
            Zákaznické profily a rezervace vedeme v našem rezervačním systému
            Dotypos.
          </>,
          <>
            Pokud připojíte AI asistenta, informace, které na vaši žádost získá,
            například naši nabídku a vaše rezervace, předáváme poskytovateli
            tohoto asistenta, který s nimi nakládá podle vlastních podmínek jako
            příjemce, kterého jste si zvolili. Tento poskytovatel může sídlit
            mimo Evropskou unii, například ve Spojených státech, a vaše údaje se
            tam dostanou proto, že jste o to požádali.
          </>,
          <>
            Pokud budeme v budoucnu zasílat marketingová sdělení, může náš
            poskytovatel e-mailových služeb naším jménem zpracovávat kontaktní a
            doručovací údaje potřebné k jejich odeslání.
          </>,
        ],
      },
      {
        heading: "7. Předávání mimo EU",
        body: [
          <>
            Někteří naši poskytovatelé nebo firmy, které pro ně pracují, sídlí
            mimo Evropskou unii, a vaše údaje se proto mohou zpracovávat i tam.
            Ve Spojených státech využíváme jen firmy certifikované podle rámce
            EU–USA pro ochranu údajů nebo vázané standardními smluvními
            doložkami Evropské komise. Mapa na našem webu se načítá od
            poskytovatele ve Spojeném království. Evropská komise rozhodla, že
            Spojené království a americké firmy certifikované podle tohoto rámce
            zajišťují odpovídající ochranu osobních údajů. Informace o předávání
            nebo kopii příslušných záruk si můžete vyžádat na{" "}
            <a
              className="text-burned-orange underline underline-offset-4"
              href={`mailto:${contactEmail}`}
            >
              {contactEmail}
            </a>
            .
          </>,
          <>
            Náš poskytovatel dveřních zámků sídlí v Singapuru, pro který takové
            rozhodnutí neexistuje. Kvůli přístupu do prostor během vaší
            rezervace dostává údaje o vašem přístupovém kódu, například dobu
            jeho platnosti. Předáváme je jen proto, že jsou nezbytné k
            poskytnutí služby, kterou jste si rezervovali.
          </>,
        ],
      },
      {
        heading: "8. Vaše práva",
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
            Marketingový souhlas můžete kdykoli udělit nebo odvolat na stránce
            ochrany osobních údajů ve svém účtu, odkazem v kterémkoli
            marketingovém e-mailu nebo napsáním na{" "}
            <a
              className="text-burned-orange underline underline-offset-4"
              href={`mailto:${contactEmail}`}
            >
              {contactEmail}
            </a>
            . Odvolání nemá vliv na zpracování, které proběhlo před ním.
          </>,
          <>
            Zákaznický účet můžete smazat na stránce svého profilu. Tato
            samoobslužná akce smaže přihlašovací účet, ale nenahrazuje širší
            žádost podle předpisů o ochraně osobních údajů týkající se rezervací
            nebo zákonně uchovávaných záznamů; takovou žádost pošlete na{" "}
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
    ],
  },
  "marketing-communications": {
    updatedAt: "5. srpna 2026",
    sections: [
      {
        heading: "1. Kdo vás může kontaktovat",
        body: [
          <>
            U budoucích marketingových sdělení je odesílatelem a správcem{" "}
            {companyName}, IČO{" "}
            {workspaceSiteConstants.company.identificationNumber}, na adrese{" "}
            {companyAddress}.
          </>,
        ],
      },
      {
        heading: "2. S čím souhlasíte",
        body: [
          "Souhlasíte, že můžeme vaše jméno, e-mailovou adresu a preferovaný jazyk použít k budoucímu zasílání marketingových a komunitních sdělení Deskohub Workspace e-mailem.",
          "Souhlas se vztahuje na e-mailový marketing našich vlastních služeb Deskohub Workspace. Vaše kontaktní údaje neposkytujeme jiné společnosti pro její vlastní marketing.",
          "Souhlas je spojen s příslušným záznamem zákazníka, nikoli s e-mailovou adresou. Pokud se e-mailová adresa tohoto záznamu změní, souhlas zůstává u tohoto záznamu. Záznamy zákazníků se stejnou e-mailovou adresou mají samostatné souhlasy.",
        ],
      },
      {
        heading: "3. Vaše volba",
        body: [
          "Souhlas je dobrovolný a oddělený od rezervace. Pokud marketingové políčko nezaškrtnete, nijak vám to nebrání rezervaci vytvořit ani zaplatit.",
          "Pokud marketingové políčko nezaškrtnete, neodvoláváte tím již existující preferenci.",
          "Souhlas zaznamenáváme u příslušného záznamu zákazníka spolu s časem a verzí oznámení, abychom mohli doložit, co jste přijali.",
          "Anonymní rezervace může založit počáteční marketingovou preferenci zákazníka pouze tehdy, pokud žádná preference neexistuje. Stávající preferenci nemůže přepsat.",
        ],
      },
      {
        heading: "4. Správa a odvolání souhlasu",
        body: [
          <>
            Souhlas můžete udělit nebo odvolat na stránce ochrany osobních údajů
            ve svém účtu, pokud jste přihlášeni ověřeným účtem propojeným s
            příslušným záznamem zákazníka. Vyhrazený odkaz pro konkrétního
            zákazníka v budoucím marketingovém sdělení vám může také umožnit
            udělení nebo odvolání souhlasu. Pokud žádná z těchto možností není
            dostupná, kontaktujte naši podporu na{" "}
            <a
              className="text-burned-orange underline underline-offset-4"
              href={`mailto:${contactEmail}`}
            >
              {contactEmail}
            </a>
            . Odvolání platí pro budoucí marketing a nemá vliv na předchozí
            zákonné zpracování.
          </>,
        ],
      },
      {
        heading: "5. Poskytovatelé a vaše práva",
        body: [
          <>
            Pokud budeme v budoucnu zasílat marketingová sdělení, může náš
            poskytovatel e-mailových služeb naším jménem zpracovávat kontaktní a
            doručovací údaje potřebné k jejich odeslání. Více informací o
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
    updatedAt: "12. srpna 2026",
    sections: termsAndConditionsSections,
  },
  "cookie-policy": {
    updatedAt: "8. listopadu 2026",
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
            zabezpečení a uložení stavu vašeho souhlasu s cookies. Tyto cookies
            jsou vždy aktivní, protože bez nich web nemůže spolehlivě fungovat.
          </>,
          <>
            Po přihlášení k zákaznickému účtu vás nezbytná cookie relace udržuje
            přihlášené nejvýše 30 dní. Nastaví se až po přihlášení a odstraní se
            při odhlášení nebo smazání účtu.
          </>,
          <>
            Když otevřete doporučovací odkaz od jiného zákazníka, nezbytná
            cookie si nejvýše 30 dní pamatuje jeho doporučovací kód, aby šlo
            uplatnit slevu, o kterou jste požádali, při dokončení profilu nebo
            rezervaci. Později otevřený doporučovací odkaz už zapamatovaný kód
            nenahradí; nahradí ho ale doporučovací kód, který zadáte v pokladně
            a který je přijat. Cookie se odstraní, jakmile je doporučení
            zaznamenáno nebo je zaplacena vaše první rezervace, a nepoužívá se
            ke sledování.
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
            poskytovatele mohou zpracovávané údaje zahrnovat zobrazení stránek,
            informace o prohlížeči a zařízení, technické údaje odvozené z IP
            adresy, typy událostí a standardní kampanové parametry z URL:
            utm_source, utm_medium, utm_campaign, utm_content a utm_term.
          </>,
          <>
            S vaším analytickým souhlasem přiřazujeme k analytickému profilu
            vašeho účtu také záznamy o vašich rezervacích a platbách, jak
            popisují naše{" "}
            <a
              className="text-burned-orange underline underline-offset-4"
              href="/cs-CZ/privacy-policy"
            >
              zásady ochrany osobních údajů
            </a>
            .
          </>,
          <>
            Konverzní události o odeslání rezervace neobsahují hodnoty z
            rezervačního formuláře ani osobní údaje, jako je jméno, e-mail,
            telefon, zpráva, data nebo časy rezervace, doba trvání, počet míst,
            vybraný produkt ani volby občerstvení, monitoru nebo pracovní
            stanice.
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
    updatedAt: "12. srpna 2026",
    sections: operatingRulesSections,
  },
} satisfies LegalDocumentBodies;
