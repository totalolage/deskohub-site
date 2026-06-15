import { siteConstants } from "@/shared/utils/constants";

export const gdprCzech = (
  <section>
    <h2>Správce osobních údajů</h2>
    <p>
      deskohub s.r.o., IČO: {siteConstants.contact.ico}, se sídlem{" "}
      {siteConstants.contact.address.street},{" "}
      {siteConstants.contact.address.postalCode}{" "}
      {siteConstants.contact.address.city}{" "}
      {siteConstants.contact.address.countryCode}, e-mail:{" "}
      {siteConstants.contact.gdprEmail}.
    </p>

    <h2>1. Jaké údaje zpracováváme a proč</h2>
    <p>
      Zpracováváme údaje, které nám poskytnete prostřednictvím rezervace /
      kontaktního formuláře:
    </p>
    <ul>
      <li>jméno a příjmení</li>
      <li>kontaktní údaje (e-mail, telefon)</li>
      <li>ostatní informace uvedené ve formuláři</li>
    </ul>
    <p>Účel: vyřízení rezervace / poptávky.</p>
    <p>
      Právní základ: váš výslovný souhlas podle čl. 6 odst. 1 písm. a) GDPR.
    </p>

    <h2>2. Fotografie a video – účel, veřejné použití a doba uchovávání</h2>
    <p>
      Během akcí pořizujeme fotografie a videozáznamy za účelem propagace našeho
      podnikání, včetně zveřejnění na webu, sociálních sítích a jiných
      komunikačních kanálech.
    </p>
    <p>
      <strong>Indefinované použití:</strong> Pokud udělíte souhlas, tyto
      fotografie a videozáznamy mohou být uchovávány a používány bez časového
      omezení pro propagační a veřejné účely.
    </p>
    <p>
      <strong>Odvolání souhlasu:</strong> Máte právo odvolat svůj souhlas
      kdykoliv kontaktováním nás na {siteConstants.contact.gdprEmail} nebo jiným
      snadno dostupným způsobem. Odvolání souhlasu se vztahuje na budoucí
      použití a znamená, že přestaneme dané osoby v nových médiích používat.
    </p>

    <h3>Co se stane s již publikovaným obsahem:</h3>
    <ul>
      <li>
        Odvolání souhlasu neznamená, že před tím zákonně publikované materiály
        byly zpracovány neoprávněně — GDPR nevyžaduje zpětné “retroaktivní”
        zrušení zpracování, které již proběhlo.
      </li>
      <li>
        Pokud si přejete odstranit konkrétní fotografie či video, které jsme již
        zveřejnili, uděláme to vždy, když je to technicky možné, a to co
        nejdříve poté, co obdržíme vaši žádost. Technická proveditelnost
        odstranění z veřejných kanálů (např. archivované příspěvky na sociálních
        sítích nebo v externích médiích) může být omezená a v takovém případě
        vás budeme o tom informovat.
      </li>
    </ul>

    <h2>3. Kdo s údaji pracuje</h2>
    <ul>
      <li>deskohub s.r.o. (správce údajů)</li>
      <li>
        naši technickí zpracovatelé (na základě smlouvy o zpracování osobních
        údajů)
      </li>
      <li>
        případně jiní příjemci jen s vaším souhlasem nebo pokud to zákon
        vyžaduje
      </li>
    </ul>

    <h2>4. Vaše práva</h2>
    <p>V souladu s GDPR máte právo kdykoliv:</p>
    <ul>
      <li>získat přístup ke svým údajům</li>
      <li>požadovat opravu nepřesných údajů</li>
      <li>odvolat souhlas (viz výše)</li>
      <li>
        požádat o výmaz osobních údajů, pokud neexistuje jiný právní důvod pro
        jejich další zpracování
      </li>
      <li>požádat o omezení zpracování</li>
      <li>podat stížnost u Úřadu pro ochranu osobních údajů</li>
    </ul>
    <p>
      Souhlas lze odvolat kdykoliv prostřednictvím e-mailu:{" "}
      {siteConstants.contact.gdprEmail}.
    </p>
  </section>
);
