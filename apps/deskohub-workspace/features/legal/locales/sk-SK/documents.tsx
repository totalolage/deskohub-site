import { workspaceSiteConstants } from "@/shared/utils";
import type {
  LegalDocumentBodies,
  LegalDocumentTranslation,
  LegalSection,
} from "../../legal-document-body";
import { companyAddress, companyName, contactEmail } from "../operator-details";

const commercialRegisterDisclosure =
  "Údaje o zápise v obchodnom registri sú k dispozícii v odkazovanom oficiálnom výpise spoločnosti.";

const termsAndConditionsSections: LegalSection[] = [
  {
    heading: "1. Úvodné ustanovenia",
    body: [
      <>
        1.1 Tieto všeobecné obchodné podmienky (ďalej len „VOP“) upravujú
        vzájomné práva a povinnosti zmluvných strán vznikajúce v súvislosti s
        poskytovaním služieb spoločnosťou {companyName}, IČO:{" "}
        {workspaceSiteConstants.company.identificationNumber}, so sídlom
        Turnovská 430/10, Praha 8, zapísanou v obchodnom registri vedenom súdom
        Městský soud v Praze (Mestský súd v Prahe) (ďalej len „Poskytovateľ“), a
        klientom (ďalej len „Klient“).
      </>,
      "1.2 Tieto VOP sa vzťahujú na coworkingové vstupy, online rezervácie zasadacej miestnosti a súkromnej kancelárie a na krátkodobé užívanie priestorov na individuálne dohodnuté podujatia.",
      "1.3 Ustanovenia týchto VOP sú neoddeliteľnou súčasťou každej zmluvy uzavretej medzi Poskytovateľom a Klientom.",
      "1.4 Právne vzťahy neupravené týmito VOP sa riadia právnym poriadkom Českej republiky, najmä zákonom č. 89/2012 Sb., občanský zákoník (zákon č. 89/2012 Zb., Občiansky zákonník).",
      "1.5 Ak je Klient spotrebiteľom, nie sú týmito VOP obmedzené práva, ktorých sa podľa kogentných právnych predpisov nemôže vzdať.",
    ],
  },
  {
    heading: "2. Vymedzenie pojmov",
    body: [
      "2.1 Klientom sa rozumie fyzická alebo právnická osoba, ktorá využíva služby Poskytovateľa.",
      "2.2 Spotrebiteľom sa rozumie Klient, ktorý koná mimo rámca svojej podnikateľskej činnosti.",
      "2.3 Priestory sú coworkingové priestory, zasadacia miestnosť, súkromná kancelária a eventové priestory prevádzkované Poskytovateľom.",
      "2.4 Službami sa rozumie časovo obmedzené umožnenie užívania zvolených Priestorov a súvisiace služby uvedené v objednávke.",
      "2.5 Tarifou sa rozumie konkrétny rozsah coworkingových služieb a podmienok ich čerpania podľa aktuálneho Cenníka Poskytovateľa.",
      "2.6 Prístupovým PIN kódom sa rozumie aktuálny kód umožňujúci vstup do priestorov Poskytovateľa.",
      "2.7 Rezerváciou sa rozumie objednávka konkrétneho coworkingového vstupu, termínu zasadacej miestnosti alebo termínu, počtu dní a počtu miest v súkromnej kancelárii.",
    ],
  },
  {
    heading: "3. Predmet zmluvy",
    body: [
      "3.1 Poskytovateľ poskytuje Klientovi coworkingové služby spočívajúce v dočasnom umožnení užívania zdieľaného pracovného priestoru v priestoroch Poskytovateľa, a to v rozsahu zvolenej tarify. Zdieľaným pracovným priestorom sa rozumie nevýhradne určené pracovné miesto alebo časť coworkingových priestorov určená na bežnú prácu, bez garancie konkrétneho stola či miesta, ak pri konkrétnej tarife nie je výslovne uvedené inak.",
      "3.2 Rezervácia zasadacej miestnosti oprávňuje Klienta na výhradné užívanie vybranej miestnosti v potvrdenom termíne a v rozsahu jednej hodiny, štyroch hodín alebo jedného pražského kalendárneho dňa. Celodenná Rezervácia trvá od polnoci vybraného dňa do polnoci nasledujúceho dňa v časovom pásme Europe/Prague.",
      "3.3 Rezervácia súkromnej kancelárie oprávňuje Klienta na výhradné užívanie kancelárie v potvrdenom počte miest počas celých zvolených kalendárnych dní. Každý deň trvá od polnoci do nasledujúcej polnoci v časovom pásme Europe/Prague a posledný deň uvedený v potvrdení je do Rezervácie zahrnutý.",
      "3.4 Konkrétna kapacita, vybavenie, cena, termín a rozsah Rezervácie sú uvedené na rezervačnej stránke a v súhrne objednávky. Klient nesmie prekročiť potvrdenú kapacitu a zodpovedá za svojich hostí a ďalšie osoby, ktorým umožní vstup.",
      "3.5 Poskytovateľ ďalej umožňuje Klientovi krátkodobé užívanie priestorov na účely organizovania podujatí, a to vždy na základe individuálnej dohody.",
      "3.6 Služby predstavujú krátkodobé oprávnenie užívať určené Priestory a súvisiace služby; nezakladajú nájomné právo, sídlo, prevádzkareň ani iné vecné právo k Priestorom. Klient nesmie bez samostatnej písomnej dohody používať adresu Priestorov ako sídlo, miesto podnikania, prevádzkareň alebo doručovaciu adresu.",
    ],
  },
  {
    heading: "4. Uzavretie zmluvy",
    body: [
      "4.1 Údaje o Službách na webe predstavujú výzvu na podanie objednávky. Klient pred odoslaním objednávky skontroluje vybranú Službu, termín, rozsah, konečnú cenu a kontaktné alebo fakturačné údaje a aktívne prijme tieto VOP a Prevádzkový poriadok.",
      "4.2 Kliknutím na tlačidlo „Objednať s povinnosťou platby“ Klient odosiela záväznú objednávku s povinnosťou zaplatiť uvedenú konečnú cenu. Zmluva je uzavretá doručením potvrdenia Poskytovateľa po úspešnej platbe, alebo pri objednávke s nulovou konečnou cenou doručením potvrdenia o jej dokončení. Potvrdenie obsahuje dohodnuté údaje Rezervácie a bezpečný odkaz na jej stav a prístupové informácie.",
      "4.3 Do uzavretia zmluvy ide iba o dočasné blokovanie kapacity. Poskytovateľ môže objednávku odmietnuť najmä pri nedostupnosti, zjavnej chybe v cene, podozrení z podvodu alebo nesplnení podmienok Rezervácie; prijatú platbu v takom prípade vráti bez zbytočného odkladu.",
      "4.4 Požiadavky na kávu, konkrétne pracovné miesto, monitor, vybavenie alebo iné doplnky podliehajú dostupnosti a sú záväzné iba vtedy, ak sú uvedené v potvrdení.",
      "4.5 Zmluva o priestore na individuálne dohodnuté podujatie je uzavretá prijatím konkrétnej ponuky Poskytovateľa Klientom.",
    ],
  },
  {
    heading: "5. Cena a platobné podmienky",
    body: [
      "5.1 Poskytovateľ nie je platiteľom dane z pridanej hodnoty. Všetky ceny sú konečné.",
      "5.2 Rozhodujúca je konečná cena zobrazená v súhrne objednávky bezprostredne pred jej odoslaním. Cena je splatná pred poskytnutím Služby prostredníctvom ponúknutého spôsobu platby.",
      "5.3 Cena súkromnej kancelárie sa počíta za každý vybraný deň ako denná cena za kanceláriu plus denná cena za každé potvrdené miesto. Cena zasadacej miestnosti zodpovedá vybranému jednohodinovému, štvorhodinovému alebo celodennému produktu.",
      "5.4 Zľavy sa uplatnia iba vtedy, ak sú uvedené v súhrne objednávky. Ak sa pred začatím platby zmení cena alebo uplatniteľná zľava, Poskytovateľ zobrazí nový súhrn a vyžiada si nové potvrdenie Klienta.",
      "5.5 Cena priestoru na individuálne dohodnuté podujatie je stanovená v ponuke podľa charakteru podujatia.",
    ],
  },
  {
    heading: "6. Dostupnosť a zmeny Rezervácie",
    body: [
      "6.1 Dostupnosť je potvrdená iba pre termín, rozsah, kapacitu a produkt uvedený v potvrdení. Zmena dátumu, času, dĺžky, počtu dní, počtu miest alebo produktu si vyžaduje novú Rezerváciu alebo výslovné potvrdenie Poskytovateľa.",
      "6.2 Rezerváciu nie je možné previesť ani ďalej predať bez predchádzajúceho súhlasu Poskytovateľa.",
      "6.3 Ponuku, ceny a obsah Služieb môže Poskytovateľ meniť pre budúce objednávky. Zmena nemá vplyv na už uzavretú zmluvu.",
      "6.4 Ak Poskytovateľ nemôže potvrdenú Službu poskytnúť, ponúkne Klientovi podľa okolností porovnateľný náhradný termín alebo priestor, primeranú zľavu, alebo mu vráti cenu za neposkytnutú časť Služby. Tým nie sú dotknuté ďalšie zákonné práva Klienta.",
    ],
  },
  {
    heading: "7. Prístup a používanie služieb",
    body: [
      "7.1 Potvrdzujúci e-mail obsahuje bezpečný odkaz na prístupovú stránku Rezervácie. Hneď ako je Rezervácia zaplatená, potvrdená a overená v reálnom čase a má vystavený prístupový PIN kód, zobrazuje chránená stránka tento PIN spolu s presne naprogramovanými hranicami platnosti kódu. O tom, kedy zamykací systém kód prijíma, rozhodujú výlučne naprogramované hranice AlgoPINu; aplikácie nezdieľajú vlastné hodiny. PIN nie je uvedený priamo v potvrdzujúcom e-maile.",
      "7.2 Poskytovateľ môže prístupový PIN zmeniť; Klient použije kód aktuálne zobrazený na prístupovej stránke Rezervácie. Zobrazenie PIN kódu nepredlžuje potvrdenú dobu užívania Priestorov a nezakladá právo na prístup mimo tejto doby alebo do iných priestorov. Používanie Priestorov je možné iba v potvrdenom čase Rezervácie.",
      "7.3 Klient smie PIN kód oznámiť iba osobám oprávneným zúčastniť sa na jeho Rezervácii, musí ho chrániť pred ďalšími osobami a zodpovedá za to, ako ho použijú jeho hostia. Podozrenie zo zneužitia bezodkladne oznámi Poskytovateľovi.",
      "7.4 Klient a jeho hostia sú povinní dodržiavať kapacitu, účel Rezervácie, potvrdený čas a Prevádzkový poriadok. Klient zabezpečí, aby hostia opustili Priestory najneskôr na konci Rezervácie.",
    ],
  },
  {
    heading: "8. Zrušenie Rezervácie",
    body: [
      <>
        8.1 Klient môže požiadať o zrušenie Rezervácie e-mailom na{" "}
        <a
          className="text-burned-orange underline underline-offset-4"
          href={`mailto:${contactEmail}`}
        >
          {contactEmail}
        </a>
        . Poskytovateľ žiadosť spracuje podľa podmienok uvedených v súhrne
        objednávky alebo v individuálnej ponuke a podľa kogentných právnych
        predpisov.
      </>,
      "8.2 Ak v súhrne objednávky alebo v individuálnej ponuke nie je uvedené inak, samotné zrušenie nezakladá osobitný zmluvný nárok na vrátenie ceny. Tým nie sú dotknuté práva zo zodpovednosti za vady, zákonné právo Spotrebiteľa odstúpiť od zmluvy ani prípad, keď Službu neposkytol Poskytovateľ.",
      "8.3 Individuálne dohodnuté podujatia sa rušia podľa podmienok konkrétnej ponuky.",
      "8.4 Klient nemá nárok na vrátenie ceny iba preto, že Priestory nevyužil, prišiel neskoro alebo odišiel predčasne, ak nie sú splnené podmienky na vrátenie podľa tohto článku alebo kogentného právneho predpisu.",
    ],
  },
  {
    heading: "9. Právo Spotrebiteľa odstúpiť od zmluvy",
    body: [
      "9.1 Spotrebiteľ môže od zmluvy uzavretej online odstúpiť bez uvedenia dôvodu do 14 dní od jej uzavretia, ibaže je právo na odstúpenie v konkrétnom prípade zákonom vylúčené alebo už zaniklo.",
      "9.2 Ak sa má Služba začať poskytovať pred uplynutím tejto lehoty, Spotrebiteľ v rámci potvrdenia objednávky výslovne žiada, aby Poskytovateľ začal plniť pred uplynutím lehoty, a berie na vedomie, že po úplnom poskytnutí Služby právo na odstúpenie zaniká. Ak odstúpi po začatí, ale pred úplným poskytnutím Služby, uhradí pomernú časť ceny za už poskytnuté plnenie, ak sú splnené zákonné podmienky.",
      <>
        9.3 Odstúpenie je možné zaslať jednoznačným vyhlásením na adresu sídla
        Poskytovateľa alebo e-mailom na{" "}
        <a
          className="text-burned-orange underline underline-offset-4"
          href={`mailto:${contactEmail}`}
        >
          {contactEmail}
        </a>
        . Lehota je zachovaná, ak je oznámenie odoslané pred jej uplynutím.
      </>,
      "9.4 Po platnom odstúpení vráti Poskytovateľ prijaté peňažné prostriedky bez zbytočného odkladu, najneskôr do 14 dní, rovnakým spôsobom, akým boli prijaté, ak sa strany nedohodnú inak bez vzniku ďalších nákladov Spotrebiteľa.",
      "9.5 Vzor oznámenia: „Oznamujem, že odstupujem od zmluvy na túto Službu: [opis a číslo Rezervácie], objednanú dňa [dátum]. Meno a priezvisko Spotrebiteľa: [doplniť]. Adresa Spotrebiteľa: [doplniť]. Dátum: [doplniť]. Podpis iba pri listinnom podaní.“ Použitie vzoru nie je povinné.",
      "9.6 Práva podľa tohto článku patria iba Spotrebiteľovi a platia popri prípadných výhodnejších podmienkach zrušenia uvedených v súhrne objednávky alebo v individuálnej ponuke.",
    ],
  },
  {
    heading: "10. Pravidlá užívania a zodpovednosť Klienta",
    body: [
      "10.1 Klient je povinný užívať Priestory riadne, iba na potvrdený účel a v súlade s týmito VOP, Prevádzkovým poriadkom, bezpečnostnými pokynmi a právnymi predpismi.",
      "10.2 Klient zodpovedá za konanie svojich hostí a za škodu, ktorú on alebo jeho hostia spôsobia porušením povinnosti. Bežné opotrebenie sa za škodu nepovažuje. Škodu alebo poruchu Klient oznámi bez zbytočného odkladu.",
      "10.3 Poskytovateľ môže primerane obmedziť alebo ukončiť poskytovanie Služby pri závažnom alebo opakovanom porušení VOP či Prevádzkového poriadku, prekročení kapacity, nebezpečnom alebo protiprávnom konaní alebo zneužití prístupu. Tým nie sú dotknuté práva Klienta, ak opatrenie nebolo oprávnené.",
    ],
  },
  {
    heading: "11. Zodpovednosť Poskytovateľa",
    body: [
      "11.1 Poskytovateľ zodpovedá za riadne poskytnutie potvrdenej Služby a za ujmu v rozsahu stanovenom právnymi predpismi. Nič v týchto VOP nevylučuje ani neobmedzuje zodpovednosť, ktorú nie je možné platne vylúčiť, ani zákonné práva Spotrebiteľa.",
      "11.2 Klient zodpovedá za svoju podnikateľskú činnosť, vlastné dáta a veci vnesené do Priestorov. Poskytovateľ zodpovedá za stratu alebo poškodenie veci iba v rozsahu stanovenom právnymi predpismi; Klient preto nenecháva veci bez dozoru a primerane ich zabezpečí.",
      "11.3 Poskytovateľ nezodpovedá za prekážku, ktorá vznikla nezávisle od jeho vôle a ktorú nemohol rozumne predvídať ani odvrátiť. Ak taká prekážka alebo dočasná nedostupnosť trvá tak, že podstatnú časť potvrdenej Služby nie je možné poskytnúť, postupuje sa podľa článku 6.4.",
      "11.4 Voči Klientovi, ktorý nie je Spotrebiteľom, Poskytovateľ v maximálnom rozsahu povolenom zákonom nezodpovedá za nepriamu ujmu, ušlý zisk alebo stratu dát, ak ich nespôsobil úmyselne alebo z hrubej nedbanlivosti.",
    ],
  },
  {
    heading: "12. Vady a reklamácie",
    body: [
      "12.1 Klient oznámi vadu Služby bez zbytočného odkladu, aby ju bolo možné odstrániť, a uvedie aspoň svoje kontaktné údaje, číslo Rezervácie, opis vady a požadovaný spôsob vybavenia.",
      <>
        12.2 Reklamáciu je možné uplatniť v prevádzkarni, na adrese
        Poskytovateľa alebo e-mailom na{" "}
        <a
          className="text-burned-orange underline underline-offset-4"
          href={`mailto:${contactEmail}`}
        >
          {contactEmail}
        </a>
        . Poskytovateľ vydá Spotrebiteľovi potvrdenie o jej prijatí a vybavení.
      </>,
      "12.3 O reklamácii Spotrebiteľa Poskytovateľ rozhodne ihneď, v zložitých prípadoch do troch pracovných dní; reklamáciu vrátane odstránenia vady vybaví bez zbytočného odkladu, najneskôr do 30 dní, ak sa so Spotrebiteľom nedohodne na dlhšej lehote.",
      "12.4 Podľa povahy vady môže Klient požadovať nápravu, náhradné plnenie, primeranú zľavu alebo odstúpiť od zmluvy, ak sú splnené zákonné podmienky.",
    ],
  },
  {
    heading: "13. Mimosúdne riešenie spotrebiteľských sporov",
    body: [
      "13.1 Ak medzi Poskytovateľom a Spotrebiteľom vznikne spor zo zmluvy o poskytovaní Služieb, ktorý sa nepodarí vyriešiť priamo, môže Spotrebiteľ podať návrh na mimosúdne riešenie sporu orgánu Česká obchodní inspekce (Česká obchodná inšpekcia), Ústřední inspektorát – oddělení ADR, Gorazdova 1969/24, 120 00 Praha 2.",
      <>
        13.2 Informácie a elektronický formulár sú dostupné na{" "}
        <a
          className="text-burned-orange underline underline-offset-4"
          href="https://coi.gov.cz/informace-o-adr/"
          rel="noreferrer"
          target="_blank"
        >
          coi.gov.cz/informace-o-adr/
        </a>
        . Návrh musí Spotrebiteľ podať najneskôr do jedného roka odo dňa, keď
        svoje právo u Poskytovateľa uplatnil prvýkrát.
      </>,
    ],
  },
  {
    heading: "14. Osobitné ustanovenia pre podujatia",
    body: [
      "14.1 Klient zodpovedá za priebeh individuálne dohodnutého podujatia a za osoby, ktoré sa na ňom zúčastňujú.",
      "14.2 Poskytovateľ je oprávnený podujatie ukončiť v prípade porušenia právnych predpisov, konkrétnej ponuky, týchto VOP alebo Prevádzkového poriadku.",
    ],
  },
  {
    heading: "15. Záverečné ustanovenia",
    body: [
      "15.1 Poskytovateľ môže tieto VOP meniť pre zmluvy uzavreté po nadobudnutí účinnosti nového znenia. Na už uzavretú Rezerváciu sa použije znenie prijaté Klientom pri objednávke, ak neskoršia zmena nie je pre Klienta výhodnejšia alebo ak ju Klient výslovne neprijme.",
      "15.2 Odchylné individuálne dojednanie má prednosť pred týmito VOP. Neplatnosť alebo neúčinnosť jedného ustanovenia nemá vplyv na ostatné ustanovenia.",
      "15.3 Tieto VOP nadobúdajú účinnosť dňa 12. 8. 2026.",
    ],
  },
];

const operatingRulesSections: LegalSection[] = [
  {
    heading: "1. Úvodné ustanovenia",
    body: [
      <>
        1.1 Tento prevádzkový poriadok (ďalej len „Prevádzkový poriadok“)
        upravuje pravidlá správania a užívania coworkingových priestorov,
        zasadacej miestnosti, súkromnej kancelárie a eventových priestorov
        prevádzkovaných spoločnosťou {companyName}, IČO:{" "}
        {workspaceSiteConstants.company.identificationNumber}, so sídlom
        Turnovská 430/10, Praha 8 (ďalej len „Prevádzkovateľ“).
      </>,
      "1.2 Tento Prevádzkový poriadok je záväzný pre všetky osoby nachádzajúce sa v priestoroch Prevádzkovateľa (ďalej len „Používateľ“).",
      "1.3 Klient, ktorý vytvoril rezerváciu, zabezpečí, aby sa s Prevádzkovým poriadkom oboznámili a dodržiavali ho aj jeho hostia a ďalšie osoby, ktorým umožní vstup.",
    ],
  },
  {
    heading: "2. Základné pravidlá správania",
    body: [
      "2.1 Používateľ je povinný správať sa v priestoroch ohľaduplne a s rešpektom k ostatným osobám.",
      "2.2 V zdieľaných a spoločných priestoroch Používateľ udržiava hladinu hluku zodpovedajúcu bežnej tichej konverzácii. V zasadacej miestnosti alebo súkromnej kancelárii udržiava hluk vo vnútri rezervovaného priestoru.",
      "2.3 Používateľ nesmie svojím konaním nadmerne rušiť ostatných používateľov ani obmedzovať ich užívanie priestorov. Klient zodpovedá za správanie svojich hostí.",
    ],
  },
  {
    heading: "3. Zákazy v priestoroch",
    body: [
      "3.1 V priestoroch je zakázané:",
      "a) fajčiť vrátane používania elektronických cigariet,",
      "b) užívať omamné alebo psychotropné látky,",
      "c) vstupovať do priestorov pod vplyvom alkoholu alebo iných návykových látok v miere obmedzujúcej schopnosť bezpečného správania,",
      "d) vykonávať činnosti v rozpore s právnymi predpismi,",
      "e) poškodzovať vybavenie alebo zariadenie priestorov,",
      "f) obťažovať ostatných používateľov nevhodným alebo agresívnym správaním,",
      "g) prekročiť potvrdenú kapacitu, prenechať alebo ďalej predať rezerváciu neoprávnenej osobe,",
      "h) bez písomnej dohody používať adresu priestorov ako sídlo, miesto podnikania, prevádzkareň alebo doručovaciu adresu.",
    ],
  },
  {
    heading: "4. Užívanie priestorov",
    body: [
      "4.1 Používateľ je povinný užívať priestory výlučne na účely zodpovedajúce ich povahe a určeniu.",
      "4.2 Zasadacia miestnosť a súkromná kancelária sa smú užívať iba počas potvrdenej doby a v potvrdenej kapacite. Používatelia ich vrátane svojich vecí opustia najneskôr na konci rezervácie.",
      "4.3 Používateľ je povinný udržiavať poriadok a čistotu a po skončení užívania uviesť využívané miesto a spoločné vybavenie do zodpovedajúceho stavu.",
      "4.4 Používateľ nesmie bez súhlasu Prevádzkovateľa premiestňovať vybavenie, vykonávať úpravy, inštalovať zariadenia alebo zasahovať do technických rozvodov.",
      "4.5 Používateľ používa audiovizuálne, konferenčné a iné vybavenie podľa pokynov a bez zbytočného odkladu oznámi poruchu. Po skončení rezervácie zariadenie bezpečne vypne, ak si to vyžaduje jeho povaha.",
    ],
  },
  {
    heading: "5. Občerstvenie",
    body: [
      "5.1 Používateľ je povinný využívať občerstvenie primerane a s ohľadom na ostatných používateľov.",
      "5.2 Používateľ nesmie občerstvenie zneužívať ani ním neodôvodnene plytvať.",
    ],
  },
  {
    heading: "6. Bezpečnosť",
    body: [
      "6.1 Používateľ je povinný dbať na svoju bezpečnosť aj na bezpečnosť ostatných osôb.",
      "6.2 Používateľ nesmie blokovať únikové cesty ani inak ohrozovať bezpečnú prevádzku priestorov.",
      "6.3 Používateľ je povinný bez zbytočného odkladu upozorniť Prevádzkovateľa na vznik nebezpečnej situácie alebo poruchy.",
      "6.4 Prístupový PIN kód smie Klient oznámiť iba osobám oprávneným zúčastniť sa na jeho rezervácii. Používatelia ho chránia pred sprístupnením neoprávnenej osobe alebo odpozorovaním neoprávnenou osobou a pri jeho zadávaní dbajú na zvýšenú opatrnosť.",
      "6.5 Zobrazenie PIN kódu na prístupovej stránke Rezervácie nijako neobmedzuje ani nepredlžuje dobu oprávneného užívania priestorov; o prijímaní kódu rozhoduje výlučne zamykací systém. Používatelia smú do priestorov vstúpiť a zdržiavať sa v nich iba v potvrdenom čase Rezervácie.",
      "6.6 Dvere ani iné zabezpečené vstupy nesmú zostať otvorené. Podozrenie zo zneužitia kódu alebo zo vstupu neoprávnenej osoby Používateľ bezodkladne oznámi Prevádzkovateľovi.",
      "6.7 Klient zabezpečí bezpečný príchod a odchod svojich hostí a nesmie im umožniť prístup mimo potvrdeného času alebo do iných než oprávnene užívaných priestorov.",
      "6.8 Prevádzkovateľ alebo ním poverená osoba môže vstúpiť do rezervovaného priestoru, ak je to potrebné z dôvodu mimoriadnej udalosti, bezpečnosti, odvrátenia škody alebo nevyhnutnej údržby; ak to okolnosti dovoľujú, Klienta vopred informuje.",
    ],
  },
  {
    heading: "7. Zodpovednosť za škodu",
    body: [
      "7.1 Používateľ zodpovedá za škodu, ktorú spôsobí na majetku Prevádzkovateľa alebo tretích osôb.",
      "7.2 Klient zodpovedá aj za škodu spôsobenú jeho hosťami. Bežné opotrebenie sa za škodu nepovažuje.",
      "7.3 Používateľ je povinný vznik škody, stratu kľúča alebo prístupového prostriedku a poruchu bezodkladne oznámiť Prevádzkovateľovi.",
    ],
  },
  {
    heading: "8. Porušenie Prevádzkového poriadku",
    body: [
      "8.1 V prípade porušenia tohto Prevádzkového poriadku je Prevádzkovateľ oprávnený prijať primerané opatrenia na zabezpečenie poriadku a ochrany ostatných používateľov.",
      "8.2 Tieto opatrenia môžu zahŕňať najmä výzvu na nápravu, obmedzenie prístupu, vykázanie Používateľa z priestorov alebo ukončenie rezervácie, ak je to primerané povahe a závažnosti porušenia.",
      "8.3 Ak je to možné a porušenie nie je závažné ani nebezpečné, poskytne Prevádzkovateľ pred ukončením rezervácie primeranú možnosť nápravy.",
    ],
  },
  {
    heading: "9. Záverečné ustanovenia",
    body: [
      "9.1 Prevádzkovateľ môže tento Prevádzkový poriadok meniť pre budúce rezervácie. Pre už potvrdenú rezerváciu je rozhodujúce znenie prijaté pri objednávke, ak nie sú bezodkladné opatrenia nevyhnutné z dôvodu bezpečnosti alebo kogentného právneho predpisu.",
      "9.2 Tento Prevádzkový poriadok nadobúda účinnosť dňa 12. 8. 2026.",
    ],
  },
];

const legalDocuments = {
  "privacy-policy": {
    updatedAt: "8. novembra 2026",
    sections: [
      {
        heading: "1. Prevádzkovateľ",
        body: [
          <>
            {companyName}, IČO{" "}
            {workspaceSiteConstants.company.identificationNumber}, s adresou
            prevádzky {companyAddress} a ID prevádzky{" "}
            {workspaceSiteConstants.company.establishmentId}, je
            prevádzkovateľom vašich osobných údajov.
          </>,
          commercialRegisterDisclosure,
          <>
            V prípade otázok týkajúcich sa ochrany osobných údajov nám napíšte
            na{" "}
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
        heading: "2. Aké údaje spracúvame",
        body: [
          <>
            Spracúvame údaje, ktoré nám poskytnete prostredníctvom verejného
            webu, najmä kontaktné údaje a obsah správy odoslanej cez kontaktný
            formulár a údaje o rezervácii: meno, e-mail, telefónne číslo,
            vybranú produktovú skupinu a produkt rezervácie, dátum alebo rozsah
            dátumov, čas začiatku, dobu trvania, počet miest a prípadné
            coworkingové preferencie týkajúce sa občerstvenia, monitorov alebo
            pracovnej stanice.
          </>,
          <>
            Pri pokračovaní k objednávke spracúvame aj ponúknutú a zaplatenú
            sumu, menu, použité zľavy, identifikátory a stav platby a
            rezervácie, ktoré podmienky ste prijali a kedy, či bol vydaný
            prístup, a voliteľné fakturačné údaje, ktoré požadujete uviesť na
            účtovnom doklade. Od poskytovateľa platieb nezískavame úplné údaje
            vašej platobnej karty.
          </>,
          <>
            Ak si vytvoríte zákaznícky účet, spracúvame vašu overenú e-mailovú
            adresu, údaje profilu a prihlasovacie údaje potrebné na zabezpečenie
            účtu. Heslo od vás nikdy nežiadame.
          </>,
          <>
            Ak k svojmu zákazníckemu účtu pripojíte AI asistenta, napríklad
            ChatGPT alebo Claude, spracúvame údaje o tom, o ktorého asistenta
            ide, aké oprávnenia ste mu udelili a kedy, a prístupové údaje, ktoré
            asistent používa. Keď asistent vo vašom mene začne rezerváciu,
            zaznamenáme pri nej, ktorý asistent ju začal.
          </>,
          <>
            Na prevádzku webu a ochranu pred spamom a zneužitím môžeme
            krátkodobo spracúvať aj technické údaje, napríklad vašu IP adresu a
            údaje o prehliadači.
          </>,
          <>
            Aby sme porozumeli tomu, ako web používajú vyhľadávače a AI
            asistenti, triedime požiadavky podľa údajov o prehliadači do
            všeobecných kategórií návštevnosti. Poskytovateľovi analytických
            služieb oznamujeme iba túto kategóriu, názov rozpoznaného asistenta
            alebo vyhľadávača, stránku a jazyk, formulár, ktorý sa zablokovaná
            automatizovaná požiadavka pokúsila použiť, a pri našich rezervačných
            nástrojoch pre AI asistentov to, ktorý nástroj bol použitý a či bol
            úspešný. Neodovzdávame nič, čo by vás identifikovalo, a toto meranie
            nezávisí od súhlasu s analytikou. Túto kategóriu a názov
            rozpoznaného asistenta pripájame aj k záznamom o rezerváciách a
            platbách opísaným v bode 3.
          </>,
          <>
            Ak udelíte súhlas s analytickými cookies alebo obdobnými
            technológiami, môžeme my a poskytovatelia analytických služieb
            spracúvať údaje o používaní webu a meraní kampaní, napríklad
            zobrazenia stránok, informácie o prehliadači a zariadení, technické
            údaje odvodené z IP adresy, typy udalostí a štandardné parametre
            kampaní z odkazov. S vaším analytickým súhlasom priraďujeme k
            analytickému profilu vášho účtu aj záznamy o vašich rezerváciách a
            platbách opísané v bode 3.
          </>,
          <>
            Ak sa samostatne prihlásite na odber budúcich marketingových správ,
            spracúvame aj vaše meno, e-mailovú adresu, preferovaný jazyk, čas
            udelenia súhlasu a verziu marketingového oznámenia, ktoré ste
            prijali. Zaznamenávame aj to, kde ste súhlas udelili, napríklad v
            rezervačnom formulári, vo svojom účte alebo prostredníctvom
            asistenta, a vašu voľbu uchovávame pri vašom zákazníckom zázname.
          </>,
        ],
      },
      {
        heading: "3. Na aký účel údaje používame",
        body: [
          <>
            Kontaktné, rezervačné, objednávkové a platobné údaje používame na
            overenie dostupnosti, prípravu a potvrdenie Rezervácie, dočasné
            blokovanie kapacity, prijatie alebo overenie platby, vydanie
            prístupu, zaslanie potvrdenia, vystavenie požadovaného účtovného
            dokladu, vybavenie zrušenia alebo reklamácie, prevenciu duplicitných
            či podvodných objednávok a podporu v súvislosti s Rezerváciou, keď
            nás kontaktujete.
          </>,
          <>
            Údaje zákazníckeho účtu používame na vaše overenie, správu vášho
            profilu a prepojenie účtu s rezerváciami vytvorenými s rovnakou
            overenou e-mailovou adresou.
          </>,
          <>
            Ak pripojíte AI asistenta, používame jeho pripojenie na to, aby
            podľa vašich pokynov mohol vyhľadať našu ponuku, začať rezerváciu,
            ktorú potom potvrdíte a zaplatíte na našom webe, a zobraziť vám vaše
            rezervácie.
          </>,
          <>
            Rezervačné ani dopytové údaje nepoužívame na marketing, ak na to
            neudelíte samostatný súhlas.
          </>,
          <>
            Ak tento nepovinný súhlas udelíte, môžeme vašu e-mailovú adresu
            použiť na budúce marketingové a komunitné správy Deskohub Workspace.
            Vaše kontaktné údaje neposkytujeme inej spoločnosti na jej vlastný
            marketing.
          </>,
          <>
            S vaším analytickým súhlasom používame analytické a externé meracie
            služby, aby sme porozumeli používaniu webu, úspešnosti odosielania
            rezervácií a účinnosti kampaní. Toto meranie nezahŕňa údaje, ktoré
            zadáte do rezervačného formulára.
          </>,
          <>
            Bez ohľadu na analytický súhlas tiež odovzdávame poskytovateľovi
            analytických služieb záznam o jednotlivých krokoch rezervácie a
            platby, napríklad o začatej, dokončenej, neúspešnej alebo opustenej
            platbe a jej sume. Tieto záznamy používame na meranie priebehu
            rezervácií a platieb a na odhaľovanie problémov s platbami. Sú
            spojené s vašou rezerváciou a s vaším analytickým súhlasom aj s
            analytickým profilom vášho účtu. Neobsahujú vaše meno ani kontaktné
            údaje.
          </>,
          <>
            Vybrané zákaznícke údaje z nášho rezervačného systému Dotypos tiež
            odovzdávame nášmu analytickému poskytovateľovi, aby sme porozumeli
            tomu, ako zákazníci využívajú naše služby a ako to súvisí s ich
            aktivitou na webe: identifikátor zákazníka, meno, názov spoločnosti,
            e-mail, telefón, adresu, dátum narodenia, zľavovú skupinu, vernostné
            body, štítky zákazníka a údaj o tom, kedy bol záznam zákazníka
            vytvorený, naposledy zmenený alebo vymazaný. Poznámky a ďalšie
            zákaznícke údaje zostávajú v Dotypose. Pri prihlásenom zákazníkovi,
            ktorý udelil analytický súhlas, prepája identifikátor zákazníka
            tieto údaje s jeho analytikou webu.
          </>,
        ],
      },
      {
        heading: "4. Právny základ",
        body: [
          <>
            Pred uzavretím zmluvy spracúvame rezervačné údaje na vykonanie
            opatrení na vašu žiadosť. Po uzavretí zmluvy ich spracúvame na jej
            plnenie vrátane platby, prístupu, podpory, zrušenia a reklamácií.
            Účtovné a transakčné záznamy spracúvame aj na splnenie právnych
            povinností.
          </>,
          <>
            Prihlásenie do účtu, správu profilu a históriu rezervácií
            spracúvame, aby sme poskytli službu účtu, o ktorú žiadate, a podľa
            okolností aj plnili alebo pripravovali súvisiacu rezervačnú zmluvu.
            Zabezpečenie účtu, integrita relácií a ochrana pred zneužitím
            vychádzajú z našich oprávnených záujmov.
          </>,
          <>
            Pripojenie AI asistenta a vybavovanie jeho požiadaviek spracúvame,
            aby sme poskytli službu účtu, o ktorú žiadate, a podľa okolností na
            vašu žiadosť pripravili súvisiacu rezervačnú zmluvu.
          </>,
          <>
            Pri zabezpečení webu, prevencii zneužitia a podvodov, spoľahlivom
            preukázaní platby a rezervácie a pri preukazovaní, uplatňovaní alebo
            obhajovaní právnych nárokov vychádzame z našich oprávnených záujmov,
            ak nad nimi neprevažujú vaše práva.
          </>,
          <>
            Nepovinné cookies spracúvame iba na základe vášho súhlasu. Analytika
            vášho používania webu a meranie kampaní sú založené na súhlase,
            ktorý môžete kedykoľvek odvolať alebo zmeniť v nastaveniach cookies.
          </>,
          <>
            Meranie automatizovanej návštevnosti podľa kategórií vychádza z
            nášho oprávneného záujmu na prevádzke webu a jeho zlepšovaní pre
            vyhľadávače a AI asistentov. Nepoužíva žiadne údaje, ktoré by vás
            identifikovali.
          </>,
          <>
            Zaznamenávanie krokov rezervácie a platby vychádza z nášho
            oprávneného záujmu merať priebeh rezervácií a platieb a odhaľovať
            neúspešné alebo opustené platby, ak nad ním neprevažujú vaše práva.
            Proti tomuto spracúvaniu môžete kedykoľvek vzniesť námietku.
            Prepojenie týchto záznamov s analytickým profilom vášho účtu
            vychádza z vášho analytického súhlasu.
          </>,
          <>
            Odovzdávanie zákazníckych údajov z nášho rezervačného systému
            analytickému poskytovateľovi vychádza z nášho oprávneného záujmu
            porozumieť našim službám a zlepšovať ich, ak nad ním neprevažujú
            vaše práva. Proti tomuto spracúvaniu môžete kedykoľvek vzniesť
            námietku.
          </>,
          <>
            Budúce marketingové správy sú založené na vašom samostatnom súhlase.
            Udelenie súhlasu je dobrovoľné a nie je podmienkou na vytvorenie ani
            zaplatenie rezervácie.
          </>,
        ],
      },
      {
        heading: "5. Doba uchovávania",
        body: [
          <>
            Údaje z neúspešných dopytov a opustených rezervácií uchovávame iba
            počas doby potrebnej na vybavenie požiadavky, obnovenie nedokončenej
            objednávky, prevenciu zneužitia alebo ochranu právnych nárokov. Pri
            dokončených Rezerváciách uchovávame transakčné, účtovné, reklamačné
            a právne záznamy počas doby vyžadovanej právnymi predpismi alebo
            rozumne potrebnej na preukazovanie, uplatňovanie alebo obhajovanie
            právnych nárokov. Technické signály na ochranu pred zneužitím sú
            krátkodobé.
          </>,
          <>
            Zákaznícky účet uchovávame počas doby jeho používania; prihlasovacie
            relácie a odkazy automaticky vypršia a pravidelne ich mažeme.
            Vymazaním účtu vymažeme vaše prihlasovacie údaje a deaktivujeme
            prepojený zákaznícky profil. Rezervačné, platobné a účtovné záznamy
            a záznamy potrebné na prevenciu podvodov alebo ako právne dôkazy sa
            spolu s prihlasovacím účtom nevymazávajú a zostávajú iba počas
            príslušnej zmluvnej, zákonnej alebo oprávnenej doby uchovávania.
          </>,
          <>
            Prístupové údaje pripojeného asistenta automaticky vypršia a
            pravidelne ich mažeme. Pripojenie a udelené oprávnenia trvajú, kým
            asistenta neodpojíte v sekcii Pripojení asistenti vo svojom účte
            alebo kým nevymažete účet. Odpojením asistenta alebo vymazaním účtu
            sa pripojenie a oprávnenia okamžite ukončia: prístupové údaje
            asistenta okamžite prestanú fungovať a vymažú sa. Údaj o tom, ktorý
            asistent rezerváciu začal, zostáva pri zázname rezervácie.
          </>,
          <>
            Analytické údaje a údaje na meranie kampaní vrátane zákazníckych
            údajov odovzdaných analytickému poskytovateľovi uchovávame podľa
            nastavení príslušných analytických a technických poskytovateľov a
            iba počas doby potrebnej na uvedené účely merania.
          </>,
          <>
            Záznam o vašom marketingovom súhlase vrátane jeho odvolania
            uchovávame pri vašom zákazníckom zázname, aby sme mohli preukázať,
            ako ste sa rozhodli.
          </>,
        ],
      },
      {
        heading: "6. Príjemcovia",
        body: [
          <>
            K údajom môže mať prístup náš interný tím Workspace a v rozsahu
            nevyhnutnom pre ich úlohu poskytovatelia hostingu, rezervačného a
            zákazníckeho systému, spracovania platieb, doručovania e-mailov,
            tvorby účtovných dokladov, zabezpečenia, analytiky, externého
            merania a ďalších technických služieb. Platobné údaje odovzdávame
            poskytovateľovi platieb iba na vytvorenie a overenie transakcie. Pri
            prístupe poskytovateľov používame primerané zmluvné, organizačné a
            technické záruky.
          </>,
          <>
            Zákaznícke profily a rezervácie vedieme v našom rezervačnom systéme
            Dotypos.
          </>,
          <>
            Ak pripojíte AI asistenta, informácie, ktoré na vašu žiadosť získa,
            napríklad našu ponuku a vaše rezervácie, odovzdávame poskytovateľovi
            tohto asistenta, ktorý s nimi nakladá podľa vlastných podmienok ako
            príjemca, ktorého ste si zvolili. Tento poskytovateľ môže sídliť
            mimo Európskej únie, napríklad v Spojených štátoch, a vaše údaje sa
            tam dostanú preto, že ste o to požiadali.
          </>,
          <>
            Ak budeme v budúcnosti zasielať marketingové správy, môže náš
            poskytovateľ e-mailových služieb v našom mene spracúvať kontaktné a
            doručovacie údaje potrebné na ich odoslanie.
          </>,
        ],
      },
      {
        heading: "7. Prenos mimo EÚ",
        body: [
          <>
            Niektorí naši poskytovatelia alebo firmy, ktoré pre nich pracujú,
            sídlia mimo Európskej únie, a vaše údaje sa preto môžu spracúvať aj
            tam. V Spojených štátoch využívame iba firmy certifikované podľa
            rámca ochrany údajov medzi EÚ a USA alebo viazané štandardnými
            zmluvnými doložkami Európskej komisie. Mapa na našom webe sa
            načítava od poskytovateľa v Spojenom kráľovstve. Európska komisia
            rozhodla, že Spojené kráľovstvo a americké firmy certifikované podľa
            tohto rámca zabezpečujú primeranú ochranu osobných údajov.
            Informácie o prenose alebo kópiu príslušných záruk si môžete
            vyžiadať na{" "}
            <a
              className="text-burned-orange underline underline-offset-4"
              href={`mailto:${contactEmail}`}
            >
              {contactEmail}
            </a>
            .
          </>,
          <>
            Náš poskytovateľ dverových zámkov sídli v Singapure, pre ktorý
            takéto rozhodnutie neexistuje. Na zabezpečenie prístupu do
            priestorov počas vašej rezervácie dostáva údaje o vašom prístupovom
            kóde, napríklad dobu jeho platnosti. Odovzdávame mu ich iba preto,
            že sú nevyhnutné na poskytnutie služby, ktorú ste si rezervovali.
          </>,
        ],
      },
      {
        heading: "8. Vaše práva",
        body: [
          <>
            Podľa platných predpisov môžete požadovať prístup, opravu,
            vymazanie, obmedzenie spracúvania, vzniesť námietku alebo požadovať
            prenosnosť údajov, ak je uplatniteľná. Sťažnosť môžete podať
            dozornému orgánu Úřad pro ochranu osobních údajů (český Úrad pre
            ochranu osobných údajov) na{" "}
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
            Marketingový súhlas môžete kedykoľvek udeliť alebo odvolať na
            stránke ochrany osobných údajov vo svojom účte, odkazom v
            ktoromkoľvek marketingovom e-maile alebo napísaním na{" "}
            <a
              className="text-burned-orange underline underline-offset-4"
              href={`mailto:${contactEmail}`}
            >
              {contactEmail}
            </a>
            . Odvolanie nemá vplyv na spracúvanie, ktoré prebehlo pred ním.
          </>,
          <>
            Zákaznícky účet môžete vymazať na stránke svojho profilu. Tento
            samoobslužný úkon vymaže prihlasovací účet, ale nenahrádza širšiu
            žiadosť podľa predpisov o ochrane osobných údajov týkajúcu sa
            rezervácií alebo zákonne uchovávaných záznamov; takúto žiadosť
            pošlite na{" "}
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
    updatedAt: "5. augusta 2026",
    sections: [
      {
        heading: "1. Kto vás môže kontaktovať",
        body: [
          <>
            Pri budúcich marketingových správach je odosielateľom a
            prevádzkovateľom {companyName}, IČO{" "}
            {workspaceSiteConstants.company.identificationNumber}, na adrese{" "}
            {companyAddress}.
          </>,
        ],
      },
      {
        heading: "2. S čím súhlasíte",
        body: [
          "Súhlasíte s tým, že môžeme vaše meno, e-mailovú adresu a preferovaný jazyk použiť na budúce zasielanie marketingových a komunitných správ Deskohub Workspace e-mailom.",
          "Súhlas sa vzťahuje na e-mailový marketing našich vlastných služieb Deskohub Workspace. Vaše kontaktné údaje neposkytujeme inej spoločnosti na jej vlastný marketing.",
          "Súhlas je spojený s príslušným záznamom zákazníka, nie s e-mailovou adresou. Ak sa e-mailová adresa tohto záznamu zmení, súhlas zostáva pri tomto zázname. Záznamy zákazníkov s rovnakou e-mailovou adresou majú samostatné súhlasy.",
        ],
      },
      {
        heading: "3. Vaša voľba",
        body: [
          "Súhlas je dobrovoľný a oddelený od rezervácie. Ak marketingové políčko nezačiarknete, nijako vám to nebráni rezerváciu vytvoriť ani zaplatiť.",
          "Ak marketingové políčko nezačiarknete, neodvolávate tým už existujúcu preferenciu.",
          "Súhlas zaznamenávame pri príslušnom zázname zákazníka spolu s časom a verziou oznámenia, aby sme mohli preukázať, čo ste prijali.",
          "Anonymná rezervácia môže založiť počiatočnú marketingovú preferenciu zákazníka iba vtedy, ak žiadna preferencia neexistuje. Existujúcu preferenciu nemôže prepísať.",
        ],
      },
      {
        heading: "4. Správa a odvolanie súhlasu",
        body: [
          <>
            Súhlas môžete udeliť alebo odvolať na stránke ochrany osobných
            údajov vo svojom účte, ak ste prihlásení overeným účtom prepojeným s
            príslušným záznamom zákazníka. Udelenie alebo odvolanie súhlasu vám
            môže umožniť aj vyhradený odkaz pre konkrétneho zákazníka v budúcej
            marketingovej správe. Ak nie je dostupná žiadna z týchto možností,
            kontaktujte našu podporu na{" "}
            <a
              className="text-burned-orange underline underline-offset-4"
              href={`mailto:${contactEmail}`}
            >
              {contactEmail}
            </a>
            . Odvolanie platí pre budúci marketing a nemá vplyv na
            predchádzajúce zákonné spracúvanie.
          </>,
        ],
      },
      {
        heading: "5. Poskytovatelia a vaše práva",
        body: [
          <>
            Ak budeme v budúcnosti zasielať marketingové správy, môže náš
            poskytovateľ e-mailových služieb v našom mene spracúvať kontaktné a
            doručovacie údaje potrebné na ich odoslanie. Viac informácií o
            príjemcoch, zárukách a vašich právach nájdete v našich{" "}
            <a
              className="text-burned-orange underline underline-offset-4"
              href="/sk-SK/privacy-policy"
            >
              zásadách ochrany osobných údajov
            </a>
            .
          </>,
        ],
      },
    ],
  },
  "terms-and-conditions": {
    updatedAt: "12. augusta 2026",
    sections: termsAndConditionsSections,
  },
  "cookie-policy": {
    updatedAt: "8. novembra 2026",
    sections: [
      {
        heading: "1. Čo sú cookies",
        body: [
          <>
            Cookies sú malé textové súbory uložené v prehliadači, ktoré webu
            pomáhajú zapamätať si technické voľby, zlepšovať použiteľnosť a
            riadiť zapnutie voliteľných funkcií.
          </>,
        ],
      },
      {
        heading: "2. Nevyhnutné cookies",
        body: [
          <>
            Nevyhnutné cookies podporujú základnú prevádzku webu, prácu s
            jazykom, zabezpečenie a uloženie stavu vášho súhlasu s cookies.
            Tieto cookies sú vždy aktívne, pretože bez nich web nemôže
            spoľahlivo fungovať.
          </>,
          <>
            Po prihlásení do zákazníckeho účtu vás nevyhnutná cookie relácie
            udržiava prihlásených najviac 30 dní. Nastaví sa až po prihlásení a
            odstráni sa pri odhlásení alebo vymazaní účtu.
          </>,
          <>
            Keď otvoríte odporúčací odkaz od iného zákazníka, nevyhnutná cookie
            si najviac 30 dní pamätá jeho odporúčací kód, aby bolo možné
            uplatniť zľavu, o ktorú ste požiadali, pri dokončení profilu alebo
            pri rezervácii. Neskôr otvorený odporúčací odkaz už zapamätaný kód
            nenahradí; nahradí ho však odporúčací kód, ktorý zadáte pri
            dokončení objednávky a ktorý je prijatý. Cookie sa odstráni, hneď
            ako je odporúčanie zaznamenané alebo je zaplatená vaša prvá
            rezervácia, a nepoužíva sa na sledovanie.
          </>,
        ],
      },
      {
        heading: "3. Preferenčné cookies",
        body: [
          <>
            Preferenčné cookies si pamätajú voliteľné nastavenia zobrazenia
            alebo interakcie, ak sú takéto funkcie na webe aktívne.
          </>,
        ],
      },
      {
        heading: "4. Analytické a marketingové cookies",
        body: [
          <>
            Analytické a marketingové cookies sú voliteľné. Ak sú na webe
            využité analytické, externé meracie, kampaňové alebo obdobné
            technické nástroje poskytovateľov, aktivujú sa až po vašom súhlase
            cez cookie lištu alebo stránku s nastaveniami cookies.
          </>,
          <>
            Analytické cookies nám pomáhajú porozumieť používaniu webu,
            úspešnosti odosielania rezervácií a účinnosti kampaní. Podľa
            kategórie poskytovateľa môžu spracúvané údaje zahŕňať zobrazenia
            stránok, informácie o prehliadači a zariadení, technické údaje
            odvodené z IP adresy, typy udalostí a štandardné parametre kampaní z
            URL: utm_source, utm_medium, utm_campaign, utm_content a utm_term.
          </>,
          <>
            S vaším analytickým súhlasom priraďujeme k analytickému profilu
            vášho účtu aj záznamy o vašich rezerváciách a platbách, ako ich
            opisujú naše{" "}
            <a
              className="text-burned-orange underline underline-offset-4"
              href="/sk-SK/privacy-policy"
            >
              zásady ochrany osobných údajov
            </a>
            .
          </>,
          <>
            Konverzné udalosti o odoslaní rezervácie neobsahujú hodnoty z
            rezervačného formulára ani osobné údaje, ako je meno, e-mail,
            telefón, správa, dátumy alebo časy rezervácie, doba trvania, počet
            miest, vybraný produkt ani voľby občerstvenia, monitora alebo
            pracovnej stanice.
          </>,
        ],
      },
      {
        heading: "5. Ako spravovať súhlas",
        body: [
          <>
            Môžete prijať všetky voliteľné kategórie, odmietnuť nepovinné
            kategórie alebo ich spravovať jednotlivo cez cookie lištu a
            samostatnú stránku s nastaveniami cookies dostupnú z päty stránky.
          </>,
        ],
      },
    ],
  },
  "operating-rules": {
    updatedAt: "12. augusta 2026",
    sections: operatingRulesSections,
  },
} satisfies LegalDocumentBodies;

export const translation = {
  translationNotice:
    "Toto je preklad českého originálu. V prípade akéhokoľvek rozporu medzi týmto prekladom a českým znením je rozhodujúce české znenie.",
  documents: legalDocuments,
} satisfies LegalDocumentTranslation;
