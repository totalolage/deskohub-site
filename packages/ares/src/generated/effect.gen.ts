// @effect-diagnostics schemaNumber:off unnecessaryTypeofType:off
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import type { SchemaError } from "effect/Schema"
import * as Schema from "effect/Schema"
import type * as HttpClient from "effect/unstable/http/HttpClient"
import * as HttpClientError from "effect/unstable/http/HttpClientError"
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest"
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse"
// non-recursive definitions
export type EkonomickySubjekt = { readonly "ico"?: string, readonly "obchodniJmeno"?: string, readonly "sidlo"?: { readonly "kodStatu"?: string, readonly "nazevStatu"?: string, readonly "kodKraje"?: number, readonly "nazevKraje"?: string, readonly "kodOkresu"?: number, readonly "nazevOkresu"?: string, readonly "kodObce"?: number, readonly "nazevObce"?: string, readonly "kodSpravnihoObvodu"?: number, readonly "nazevSpravnihoObvodu"?: string, readonly "kodMestskehoObvodu"?: number, readonly "nazevMestskehoObvodu"?: string, readonly "kodMestskeCastiObvodu"?: number, readonly "kodUlice"?: number, readonly "nazevMestskeCastiObvodu"?: string, readonly "nazevUlice"?: string, readonly "cisloDomovni"?: number, readonly "doplnekAdresy"?: string, readonly "kodCastiObce"?: number, readonly "cisloOrientacni"?: number, readonly "cisloOrientacniPismeno"?: string, readonly "nazevCastiObce"?: string, readonly "kodAdresnihoMista"?: number, readonly "psc"?: number, readonly "textovaAdresa"?: string, readonly "cisloDoAdresy"?: string, readonly "standardizaceAdresy"?: boolean, readonly "pscTxt"?: string, readonly "typCisloDomovni"?: number }, readonly "pravniForma"?: string, readonly "pravniFormaRos"?: string, readonly "financniUrad"?: string, readonly "datumVzniku"?: string, readonly "datumZaniku"?: string, readonly "datumAktualizace"?: string, readonly "dic"?: string, readonly "icoId"?: string, readonly "adresaDorucovaci"?: { readonly "radekAdresy1"?: string, readonly "radekAdresy2"?: string, readonly "radekAdresy3"?: string }, readonly "czNace2008"?: ReadonlyArray<string>, readonly "seznamRegistraci"?: { readonly "stavZdrojeRos"?: string, readonly "stavZdrojeVr"?: string, readonly "stavZdrojeRes"?: string, readonly "stavZdrojeRzp"?: string, readonly "stavZdrojeNrpzs"?: string, readonly "stavZdrojeRpsh"?: string, readonly "stavZdrojeRcns"?: string, readonly "stavZdrojeSzr"?: string, readonly "stavZdrojeDph"?: string, readonly "stavZdrojeSkDph"?: string, readonly "stavZdrojeSd"?: string, readonly "stavZdrojeIr"?: string, readonly "stavZdrojeCeu"?: string, readonly "stavZdrojeRs"?: string, readonly "stavZdrojeRed"?: string, readonly "stavZdrojeMonitor"?: string }, readonly "primarniZdroj"?: string, readonly "dalsiUdaje"?: ReadonlyArray<{ readonly "obchodniJmeno"?: ReadonlyArray<{ readonly "platnostOd"?: string, readonly "platnostDo"?: string, readonly "obchodniJmeno"?: string, readonly "primarniZaznam"?: boolean }>, readonly "sidlo"?: ReadonlyArray<{ readonly "sidlo"?: { readonly "kodStatu"?: string, readonly "nazevStatu"?: string, readonly "kodKraje"?: number, readonly "nazevKraje"?: string, readonly "kodOkresu"?: number, readonly "nazevOkresu"?: string, readonly "kodObce"?: number, readonly "nazevObce"?: string, readonly "kodSpravnihoObvodu"?: number, readonly "nazevSpravnihoObvodu"?: string, readonly "kodMestskehoObvodu"?: number, readonly "nazevMestskehoObvodu"?: string, readonly "kodMestskeCastiObvodu"?: number, readonly "kodUlice"?: number, readonly "nazevMestskeCastiObvodu"?: string, readonly "nazevUlice"?: string, readonly "cisloDomovni"?: number, readonly "doplnekAdresy"?: string, readonly "kodCastiObce"?: number, readonly "cisloOrientacni"?: number, readonly "cisloOrientacniPismeno"?: string, readonly "nazevCastiObce"?: string, readonly "kodAdresnihoMista"?: number, readonly "psc"?: number, readonly "textovaAdresa"?: string, readonly "cisloDoAdresy"?: string, readonly "standardizaceAdresy"?: boolean, readonly "pscTxt"?: string, readonly "typCisloDomovni"?: number }, readonly "primarniZaznam"?: boolean, readonly "platnostOd"?: string, readonly "platnostDo"?: string }>, readonly "pravniForma"?: string, readonly "pravniFormaRos"?: string, readonly "spisovaZnacka"?: string, readonly "datovyZdroj"?: string }>, readonly "czNace"?: ReadonlyArray<string>, readonly "subRegistrSzr"?: string, readonly "dicSkDph"?: string }
export const EkonomickySubjekt = Schema.Struct({ "ico": Schema.optionalKey(Schema.String.annotate({ "description": "Identifikační číslo osoby - IČO" }).check(Schema.isMinLength(8)).check(Schema.isMaxLength(8)).check(Schema.isPattern(new RegExp("^\\d{8}$")))), "obchodniJmeno": Schema.optionalKey(Schema.String.annotate({ "description": "Obchodní jméno ekonomického subjektu" }).check(Schema.isMinLength(1)).check(Schema.isMaxLength(2000))), "sidlo": Schema.optionalKey(Schema.Struct({ "kodStatu": Schema.optionalKey(Schema.String.annotate({ "description": "Kód státu (ciselnikKod: Stat) " })), "nazevStatu": Schema.optionalKey(Schema.String.annotate({ "description": "Název státu" }).check(Schema.isMaxLength(32))), "kodKraje": Schema.optionalKey(Schema.Number.annotate({ "description": "Kód kraje" }).check(Schema.isInt()).check(Schema.isGreaterThanOrEqualTo(0)).check(Schema.isLessThanOrEqualTo(999))), "nazevKraje": Schema.optionalKey(Schema.String.annotate({ "description": "Název kraje" }).check(Schema.isMaxLength(32))), "kodOkresu": Schema.optionalKey(Schema.Number.annotate({ "description": "Kód okresu", "format": "int32" }).check(Schema.isInt()).check(Schema.isGreaterThanOrEqualTo(0)).check(Schema.isLessThanOrEqualTo(9999))), "nazevOkresu": Schema.optionalKey(Schema.String.annotate({ "description": "Název okresu" }).check(Schema.isMaxLength(32))), "kodObce": Schema.optionalKey(Schema.Number.annotate({ "description": "Kód obce", "format": "int32" }).check(Schema.isInt()).check(Schema.isGreaterThanOrEqualTo(0)).check(Schema.isLessThanOrEqualTo(999999))), "nazevObce": Schema.optionalKey(Schema.String.annotate({ "description": "Název obce" }).check(Schema.isMaxLength(48))), "kodSpravnihoObvodu": Schema.optionalKey(Schema.Number.annotate({ "description": "Kód správního obvodu Prahy" }).check(Schema.isInt()).check(Schema.isGreaterThanOrEqualTo(0)).check(Schema.isLessThanOrEqualTo(999))), "nazevSpravnihoObvodu": Schema.optionalKey(Schema.String.annotate({ "description": "Název správního obvodu Prahy " }).check(Schema.isMaxLength(32))), "kodMestskehoObvodu": Schema.optionalKey(Schema.Number.annotate({ "description": "Kód městského obvodu Prahy" }).check(Schema.isInt()).check(Schema.isGreaterThanOrEqualTo(0)).check(Schema.isLessThanOrEqualTo(999))), "nazevMestskehoObvodu": Schema.optionalKey(Schema.String.annotate({ "description": "Název městského obvodu Prahy" }).check(Schema.isMaxLength(32))), "kodMestskeCastiObvodu": Schema.optionalKey(Schema.Number.annotate({ "description": "Kód městské části statutárního města", "format": "int32" }).check(Schema.isInt()).check(Schema.isGreaterThanOrEqualTo(0)).check(Schema.isLessThanOrEqualTo(999999))), "kodUlice": Schema.optionalKey(Schema.Number.annotate({ "description": "Kód ulice, veřejného prostranství ze zdroje", "format": "int32" }).check(Schema.isInt()).check(Schema.isGreaterThanOrEqualTo(0)).check(Schema.isLessThanOrEqualTo(9999999))), "nazevMestskeCastiObvodu": Schema.optionalKey(Schema.String.annotate({ "description": "Název městské části statutárního města " }).check(Schema.isMaxLength(48))), "nazevUlice": Schema.optionalKey(Schema.String.annotate({ "description": "Název ulice, veřejného prostranství " }).check(Schema.isMaxLength(48))), "cisloDomovni": Schema.optionalKey(Schema.Number.annotate({ "description": "Číslo domovní" }).check(Schema.isInt()).check(Schema.isLessThanOrEqualTo(9999))), "doplnekAdresy": Schema.optionalKey(Schema.String.annotate({ "description": "Doplňující informace adresního popisu" }).check(Schema.isMaxLength(1500))), "kodCastiObce": Schema.optionalKey(Schema.Number.annotate({ "description": "Kód časti obce", "format": "int32" }).check(Schema.isInt()).check(Schema.isGreaterThanOrEqualTo(0)).check(Schema.isLessThanOrEqualTo(999999))), "cisloOrientacni": Schema.optionalKey(Schema.Number.annotate({ "description": "Číslo orientační - číselná část" }).check(Schema.isInt()).check(Schema.isLessThanOrEqualTo(999))), "cisloOrientacniPismeno": Schema.optionalKey(Schema.String.annotate({ "description": "Číslo orientační - písmenná část" }).check(Schema.isMaxLength(1))), "nazevCastiObce": Schema.optionalKey(Schema.String.annotate({ "description": "Název části obce" }).check(Schema.isMaxLength(48))), "kodAdresnihoMista": Schema.optionalKey(Schema.Number.annotate({ "description": "Kód adresního místa" }).check(Schema.isInt()).check(Schema.isGreaterThanOrEqualTo(0)).check(Schema.isLessThanOrEqualTo(999999999))), "psc": Schema.optionalKey(Schema.Number.annotate({ "description": "Poštovní směrovací číslo adresní pošty" }).check(Schema.isInt())), "textovaAdresa": Schema.optionalKey(Schema.String.annotate({ "description": "Nestrukturovaná adresa (formátovaná adresa)" }).check(Schema.isMaxLength(1500))), "cisloDoAdresy": Schema.optionalKey(Schema.String.annotate({ "description": "Nestrukturované číslo/a použíté v adrese" }).check(Schema.isMaxLength(255))), "standardizaceAdresy": Schema.optionalKey(Schema.Boolean.annotate({ "description": "Stav standardizace adresy dle RÚIAN" })), "pscTxt": Schema.optionalKey(Schema.String.annotate({ "description": "Psč zahraničních nebo nestandardně definovaných čísel" })), "typCisloDomovni": Schema.optionalKey(Schema.Number.annotate({ "description": "Typ čísla domu - kód (ciselnikKod: TypCislaDomovniho) " }).check(Schema.isInt()).check(Schema.isLessThanOrEqualTo(9999))) }).annotate({ "description": "Sídlo ekonomického subjektu" })), "pravniForma": Schema.optionalKey(Schema.String.annotate({ "description": "Právní forma - kód (ciselnikKod: PravniForma, zdroj: res, com) " }).check(Schema.isMinLength(3)).check(Schema.isMaxLength(3)).check(Schema.isPattern(new RegExp("^\\d{3}$")))), "pravniFormaRos": Schema.optionalKey(Schema.String.annotate({ "description": "Právní forma ekonomického subjektu - kód (ciselnikKod: PravniFormaRos, zdroj:ros)" }).check(Schema.isMinLength(3)).check(Schema.isMaxLength(3)).check(Schema.isPattern(new RegExp("^\\d{3}$")))), "financniUrad": Schema.optionalKey(Schema.String.annotate({ "description": "Správně příslušný finanční úřad - kód (ciselnikKod: FinancniUrad, zdroj:ufo)" }).check(Schema.isMinLength(3)).check(Schema.isMaxLength(3)).check(Schema.isPattern(new RegExp("^\\d{3}$")))), "datumVzniku": Schema.optionalKey(Schema.String.annotate({ "description": "Datum vzniku ekonomického subjektu ", "format": "date" })), "datumZaniku": Schema.optionalKey(Schema.String.annotate({ "description": "Datum zániku ekonomického subjektu", "format": "date" })), "datumAktualizace": Schema.optionalKey(Schema.String.annotate({ "description": "Datum aktualizace záznamu", "format": "date" })), "dic": Schema.optionalKey(Schema.String.annotate({ "description": "Daňové identifikační číslo ve formátu CZNNNNNNNNNN" })), "icoId": Schema.optionalKey(Schema.String.annotate({ "description": "Ičo ekonomického subjektu, pokud je ičo přidělené. Id ekonomického subjektu, pokud je ičo nepřidělené." }).check(Schema.isMaxLength(32)).check(Schema.isPattern(new RegExp("^(ARES_)?\\d{8}$")))), "adresaDorucovaci": Schema.optionalKey(Schema.Struct({ "radekAdresy1": Schema.optionalKey(Schema.String.annotate({ "description": "1. řádek doručovací adresy" }).check(Schema.isMaxLength(255))), "radekAdresy2": Schema.optionalKey(Schema.String.annotate({ "description": "2. řádek doručovací adresy" }).check(Schema.isMaxLength(255))), "radekAdresy3": Schema.optionalKey(Schema.String.annotate({ "description": "3. řádek doručovací adresy" }).check(Schema.isMaxLength(255))) }).annotate({ "description": "Doručovací adresa sídla ekonomického subjektu" })), "czNace2008": Schema.optionalKey(Schema.Array(Schema.String.annotate({ "description": "CZ-NACE_2008 ekonomického subjektu - kód (ciselnikKod: CzNace2008, zdroj:res)" }).check(Schema.isMinLength(1)).check(Schema.isMaxLength(5)))), "seznamRegistraci": Schema.optionalKey(Schema.Struct({ "stavZdrojeRos": Schema.optionalKey(Schema.String.annotate({ "description": "Stav ekonomického subjektu ve zdroji ROS (Základní registr - Registr osob) - kód (ciselnikKod: StavZdroje, zdroj: com)" }).check(Schema.isMinLength(1)).check(Schema.isMaxLength(64))), "stavZdrojeVr": Schema.optionalKey(Schema.String.annotate({ "description": "Stav ekonomického subjektu ve zdroji VR (Veřejné rejstříky) - kód (ciselnikKod: StavZdroje, zdroj: com)" }).check(Schema.isMinLength(1)).check(Schema.isMaxLength(64))), "stavZdrojeRes": Schema.optionalKey(Schema.String.annotate({ "description": "Stav ekonomického subjektu ve zdroji RES (Registr ekonomických subjektů) - kód (ciselnikKod: StavZdroje, zdroj: com)" }).check(Schema.isMinLength(1)).check(Schema.isMaxLength(64))), "stavZdrojeRzp": Schema.optionalKey(Schema.String.annotate({ "description": "Stav ekonomického subjektu ve zdroji RŽP (Registr živnostenského podnikání) - kód (ciselnikKod: StavZdroje, zdroj: com)" }).check(Schema.isMinLength(1)).check(Schema.isMaxLength(64))), "stavZdrojeNrpzs": Schema.optionalKey(Schema.String.annotate({ "description": "Stav ekonomického subjektu ve zdroji NRPZS (Národní registr poskytovatelů zdrovotnických služeb) - kód (ciselnikKod: StavZdroje, zdroj: com)" }).check(Schema.isMinLength(1)).check(Schema.isMaxLength(64))), "stavZdrojeRpsh": Schema.optionalKey(Schema.String.annotate({ "description": "Stav ekonomického subjektu ve zdroji RPSH (Registr politických stran a hnutí) - kód (ciselnikKod: StavZdroje, zdroj: com)" }).check(Schema.isMinLength(1)).check(Schema.isMaxLength(64))), "stavZdrojeRcns": Schema.optionalKey(Schema.String.annotate({ "description": "Stav ekonomického subjektu ve zdroji RCNS(Registr církví a náboženských společenství) - kód (ciselnikKod: StavZdroje, zdroj: com)" }).check(Schema.isMinLength(1)).check(Schema.isMaxLength(64))), "stavZdrojeSzr": Schema.optionalKey(Schema.String.annotate({ "description": "Stav ekonomického subjektu ve zdroji  SZR(Společný zemědělský registr) - kód (ciselnikKod: StavZdroje, zdroj: com)" }).check(Schema.isMinLength(1)).check(Schema.isMaxLength(64))), "stavZdrojeDph": Schema.optionalKey(Schema.String.annotate({ "description": "Stav ekonomického subjektu ve zdroji DPH(Registr plátců daně s přidané hodnoty) - kód (ciselnikKod: StavZdroje, zdroj: com)" }).check(Schema.isMinLength(1)).check(Schema.isMaxLength(64))), "stavZdrojeSkDph": Schema.optionalKey(Schema.String.annotate({ "description": "Stav ekonomického subjektu ve zdroji DPH(Registr plátců daně s přidané hodnoty - skupinové DPH) - kód (ciselnikKod: StavZdroje, zdroj: com)" }).check(Schema.isMinLength(1)).check(Schema.isMaxLength(64))), "stavZdrojeSd": Schema.optionalKey(Schema.String.annotate({ "description": "Stav ekonomického subjektu ve zdroji SD(Registr plátců spotřební daně) - kód (ciselnikKod: StavZdroje, zdroj: com)" }).check(Schema.isMinLength(1)).check(Schema.isMaxLength(64))), "stavZdrojeIr": Schema.optionalKey(Schema.String.annotate({ "description": "Stav ekonomického subjektu ve zdroji ISIR(Insolvenční rejstřík) - kód (ciselnikKod: StavZdroje, zdroj: com)" }).check(Schema.isMinLength(1)).check(Schema.isMaxLength(64))), "stavZdrojeCeu": Schema.optionalKey(Schema.String.annotate({ "description": "Stav ekonomického subjektu ve zdroji CEÚ(Centrální evidence úpadců) - kód (ciselnikKod: StavZdroje, zdroj: com)" }).check(Schema.isMinLength(1)).check(Schema.isMaxLength(64))), "stavZdrojeRs": Schema.optionalKey(Schema.String.annotate({ "description": "Stav ekonomického subjektu ve zdroji RŠ(Registr škol) - kód (ciselnikKod: StavZdroje, zdroj: com)" }).check(Schema.isMinLength(1)).check(Schema.isMaxLength(64))), "stavZdrojeRed": Schema.optionalKey(Schema.String.annotate({ "description": "Stav ekonomického subjektu ve zdroji RED(Registr evidence dotací) - kód (ciselnikKod: StavZdroje, zdroj: com)" }).check(Schema.isMinLength(1)).check(Schema.isMaxLength(64))), "stavZdrojeMonitor": Schema.optionalKey(Schema.String.annotate({ "description": "Stav ekonomického subjektu ve zdroji MONITOR(Monitor účetních jednotek státu) - kód (ciselnikKod: StavZdroje, zdroj: com)" }).check(Schema.isMinLength(1)).check(Schema.isMaxLength(64))) }).annotate({ "description": "Seznam registraci ekonomického subjektu v jednotlivých datových zdrojích" })), "primarniZdroj": Schema.optionalKey(Schema.String.annotate({ "description": "Identifikace primárního zdroje dat." }).check(Schema.isMaxLength(30))), "dalsiUdaje": Schema.optionalKey(Schema.Array(Schema.Struct({ "obchodniJmeno": Schema.optionalKey(Schema.Array(Schema.Struct({ "platnostOd": Schema.optionalKey(Schema.String.annotate({ "description": "Platnost údaje od data", "format": "date" })), "platnostDo": Schema.optionalKey(Schema.String.annotate({ "description": "Platnost údaje do data", "format": "date" })), "obchodniJmeno": Schema.optionalKey(Schema.String.annotate({ "description": "Obchodní jméno ekonomického subjektu" }).check(Schema.isMinLength(1)).check(Schema.isMaxLength(2000))), "primarniZaznam": Schema.optionalKey(Schema.Boolean.annotate({ "description": "Primární záznam " })) }).annotate({ "description": "Obchodní jméno ekonomického subjektu" }))), "sidlo": Schema.optionalKey(Schema.Array(Schema.Struct({ "sidlo": Schema.optionalKey(Schema.Struct({ "kodStatu": Schema.optionalKey(Schema.String.annotate({ "description": "Kód státu (ciselnikKod: Stat) " })), "nazevStatu": Schema.optionalKey(Schema.String.annotate({ "description": "Název státu" }).check(Schema.isMaxLength(32))), "kodKraje": Schema.optionalKey(Schema.Number.annotate({ "description": "Kód kraje" }).check(Schema.isInt()).check(Schema.isGreaterThanOrEqualTo(0)).check(Schema.isLessThanOrEqualTo(999))), "nazevKraje": Schema.optionalKey(Schema.String.annotate({ "description": "Název kraje" }).check(Schema.isMaxLength(32))), "kodOkresu": Schema.optionalKey(Schema.Number.annotate({ "description": "Kód okresu", "format": "int32" }).check(Schema.isInt()).check(Schema.isGreaterThanOrEqualTo(0)).check(Schema.isLessThanOrEqualTo(9999))), "nazevOkresu": Schema.optionalKey(Schema.String.annotate({ "description": "Název okresu" }).check(Schema.isMaxLength(32))), "kodObce": Schema.optionalKey(Schema.Number.annotate({ "description": "Kód obce", "format": "int32" }).check(Schema.isInt()).check(Schema.isGreaterThanOrEqualTo(0)).check(Schema.isLessThanOrEqualTo(999999))), "nazevObce": Schema.optionalKey(Schema.String.annotate({ "description": "Název obce" }).check(Schema.isMaxLength(48))), "kodSpravnihoObvodu": Schema.optionalKey(Schema.Number.annotate({ "description": "Kód správního obvodu Prahy" }).check(Schema.isInt()).check(Schema.isGreaterThanOrEqualTo(0)).check(Schema.isLessThanOrEqualTo(999))), "nazevSpravnihoObvodu": Schema.optionalKey(Schema.String.annotate({ "description": "Název správního obvodu Prahy " }).check(Schema.isMaxLength(32))), "kodMestskehoObvodu": Schema.optionalKey(Schema.Number.annotate({ "description": "Kód městského obvodu Prahy" }).check(Schema.isInt()).check(Schema.isGreaterThanOrEqualTo(0)).check(Schema.isLessThanOrEqualTo(999))), "nazevMestskehoObvodu": Schema.optionalKey(Schema.String.annotate({ "description": "Název městského obvodu Prahy" }).check(Schema.isMaxLength(32))), "kodMestskeCastiObvodu": Schema.optionalKey(Schema.Number.annotate({ "description": "Kód městské části statutárního města", "format": "int32" }).check(Schema.isInt()).check(Schema.isGreaterThanOrEqualTo(0)).check(Schema.isLessThanOrEqualTo(999999))), "kodUlice": Schema.optionalKey(Schema.Number.annotate({ "description": "Kód ulice, veřejného prostranství ze zdroje", "format": "int32" }).check(Schema.isInt()).check(Schema.isGreaterThanOrEqualTo(0)).check(Schema.isLessThanOrEqualTo(9999999))), "nazevMestskeCastiObvodu": Schema.optionalKey(Schema.String.annotate({ "description": "Název městské části statutárního města " }).check(Schema.isMaxLength(48))), "nazevUlice": Schema.optionalKey(Schema.String.annotate({ "description": "Název ulice, veřejného prostranství " }).check(Schema.isMaxLength(48))), "cisloDomovni": Schema.optionalKey(Schema.Number.annotate({ "description": "Číslo domovní" }).check(Schema.isInt()).check(Schema.isLessThanOrEqualTo(9999))), "doplnekAdresy": Schema.optionalKey(Schema.String.annotate({ "description": "Doplňující informace adresního popisu" }).check(Schema.isMaxLength(1500))), "kodCastiObce": Schema.optionalKey(Schema.Number.annotate({ "description": "Kód časti obce", "format": "int32" }).check(Schema.isInt()).check(Schema.isGreaterThanOrEqualTo(0)).check(Schema.isLessThanOrEqualTo(999999))), "cisloOrientacni": Schema.optionalKey(Schema.Number.annotate({ "description": "Číslo orientační - číselná část" }).check(Schema.isInt()).check(Schema.isLessThanOrEqualTo(999))), "cisloOrientacniPismeno": Schema.optionalKey(Schema.String.annotate({ "description": "Číslo orientační - písmenná část" }).check(Schema.isMaxLength(1))), "nazevCastiObce": Schema.optionalKey(Schema.String.annotate({ "description": "Název části obce" }).check(Schema.isMaxLength(48))), "kodAdresnihoMista": Schema.optionalKey(Schema.Number.annotate({ "description": "Kód adresního místa" }).check(Schema.isInt()).check(Schema.isGreaterThanOrEqualTo(0)).check(Schema.isLessThanOrEqualTo(999999999))), "psc": Schema.optionalKey(Schema.Number.annotate({ "description": "Poštovní směrovací číslo adresní pošty" }).check(Schema.isInt())), "textovaAdresa": Schema.optionalKey(Schema.String.annotate({ "description": "Nestrukturovaná adresa (formátovaná adresa)" }).check(Schema.isMaxLength(1500))), "cisloDoAdresy": Schema.optionalKey(Schema.String.annotate({ "description": "Nestrukturované číslo/a použíté v adrese" }).check(Schema.isMaxLength(255))), "standardizaceAdresy": Schema.optionalKey(Schema.Boolean.annotate({ "description": "Stav standardizace adresy dle RÚIAN" })), "pscTxt": Schema.optionalKey(Schema.String.annotate({ "description": "Psč zahraničních nebo nestandardně definovaných čísel" })), "typCisloDomovni": Schema.optionalKey(Schema.Number.annotate({ "description": "Typ čísla domu - kód (ciselnikKod: TypCislaDomovniho) " }).check(Schema.isInt()).check(Schema.isLessThanOrEqualTo(9999))) }).annotate({ "description": "Sídlo" })), "primarniZaznam": Schema.optionalKey(Schema.Boolean.annotate({ "description": "Primární záznam" })), "platnostOd": Schema.optionalKey(Schema.String.annotate({ "description": "Platnost údaje od data", "format": "date" })), "platnostDo": Schema.optionalKey(Schema.String.annotate({ "description": "Platnost údaje od data", "format": "date" })) }).annotate({ "description": "Sídlo ekonomického subjektu " }))), "pravniForma": Schema.optionalKey(Schema.String.annotate({ "description": "Právní forma - kód (ciselnikKod: PravniForma, zdroj: res, com)" }).check(Schema.isMinLength(3)).check(Schema.isMaxLength(3)).check(Schema.isPattern(new RegExp("^\\d{3}$")))), "pravniFormaRos": Schema.optionalKey(Schema.String.annotate({ "description": "Právní forma ekonomického subjektu - kód (ciselnikKod: PravniFormaRos, zdroj:res)" }).check(Schema.isMinLength(3)).check(Schema.isMaxLength(3)).check(Schema.isPattern(new RegExp("^\\d{3}$")))), "spisovaZnacka": Schema.optionalKey(Schema.String.annotate({ "description": "Aktuální spisová značka ve tvaru ODDIL xx/SOUD (např. B 100/MSPH) - poskytováno pouze pro zdroj: Veřejné rejstříky" }).check(Schema.isMaxLength(32))), "datovyZdroj": Schema.optionalKey(Schema.String.annotate({ "description": "Identifikace primárního zdroje dat - kód (ciselnikKod: TypZdroje, zdroj: com)" }).check(Schema.isMaxLength(30))) }).annotate({ "description": "Seznam dalších údajů o ekonomickém subjektu" }))), "czNace": Schema.optionalKey(Schema.Array(Schema.String.annotate({ "description": "Seznam CZ-NACE_2025 - seznam ekonomické činnosti - kód (ciselnikKod: CzNace, zdroj:res)" }).check(Schema.isMinLength(1)).check(Schema.isMaxLength(5)))), "subRegistrSzr": Schema.optionalKey(Schema.String.annotate({ "description": "Indeftifikátor sub-registru zdroje SZR - kód (ciselnikKod: SubRegistrSzr, zdroj:com)" })), "dicSkDph": Schema.optionalKey(Schema.String.annotate({ "description": "Daňové identifikační číslo skupiny plátce DPH ve formátu CZNNNNNNNNNN" })) }).annotate({ "description": "Základní informace o ekonomickém subjektu - obecný předek" })
export type Chyba = { readonly "kod"?: "OBECNA_CHYBA" | "CHYBA_VSTUPU" | "NENALEZENO" | "NENI_IMPLEMENTOVANO" | "NEPRIHLASENY_UZIVATEL" | "NENI_OPRAVNENI", readonly "popis"?: string, readonly "subKod"?: string }
export const Chyba = Schema.Struct({ "kod": Schema.optionalKey(Schema.Literals(["OBECNA_CHYBA", "CHYBA_VSTUPU", "NENALEZENO", "NENI_IMPLEMENTOVANO", "NEPRIHLASENY_UZIVATEL", "NENI_OPRAVNENI"]).annotate({ "description": "Číselníkový kód chyby" })), "popis": Schema.optionalKey(Schema.String.annotate({ "description": "Popis chyby" })), "subKod": Schema.optionalKey(Schema.String.annotate({ "description": "Subkod chyby" })) })
// schemas
export type VratEkonomickySubjekt200 = EkonomickySubjekt
export const VratEkonomickySubjekt200 = EkonomickySubjekt
export type VratEkonomickySubjekt400 = Chyba
export const VratEkonomickySubjekt400 = Chyba
export type VratEkonomickySubjekt401 = Chyba
export const VratEkonomickySubjekt401 = Chyba
export type VratEkonomickySubjekt403 = Chyba
export const VratEkonomickySubjekt403 = Chyba
export type VratEkonomickySubjekt404 = Chyba
export const VratEkonomickySubjekt404 = Chyba
export type VratEkonomickySubjekt500 = Chyba
export const VratEkonomickySubjekt500 = Chyba

export interface OperationConfig {
  /**
   * Whether or not the response should be included in the value returned from
   * an operation.
   *
   * If set to `true`, a tuple of `[A, HttpClientResponse]` will be returned,
   * where `A` is the success type of the operation.
   *
   * If set to `false`, only the success type of the operation will be returned.
   */
  readonly includeResponse?: boolean | undefined
}

/**
 * A utility type which optionally includes the response in the return result
 * of an operation based upon the value of the `includeResponse` configuration
 * option.
 */
export type WithOptionalResponse<A, Config extends OperationConfig> = Config extends {
  readonly includeResponse: true
} ? [A, HttpClientResponse.HttpClientResponse] : A

export const make = (
  httpClient: HttpClient.HttpClient,
  options: {
    readonly transformClient?: ((client: HttpClient.HttpClient) => Effect.Effect<HttpClient.HttpClient>) | undefined
  } = {}
): AresClient => {
  const unexpectedStatus = (response: HttpClientResponse.HttpClientResponse) =>
    Effect.flatMap(
      Effect.orElseSucceed(response.json, () => "Unexpected status code"),
      (description) =>
        Effect.fail(
          new HttpClientError.HttpClientError({
            reason: new HttpClientError.StatusCodeError({
              request: response.request,
              response,
              description: typeof description === "string" ? description : JSON.stringify(description),
            }),
          }),
        ),
    )
  const withResponse = <Config extends OperationConfig>(config: Config | undefined) => (
    f: (response: HttpClientResponse.HttpClientResponse) => Effect.Effect<any, any>,
  ): (request: HttpClientRequest.HttpClientRequest) => Effect.Effect<any, any> => {
    const withOptionalResponse = (
      config?.includeResponse
        ? (response: HttpClientResponse.HttpClientResponse) => Effect.map(f(response), (a) => [a, response])
        : (response: HttpClientResponse.HttpClientResponse) => f(response)
    ) as any
    return options?.transformClient
      ? (request) =>
          Effect.flatMap(
            Effect.flatMap(options.transformClient!(httpClient), (client) => client.execute(request)),
            withOptionalResponse
          )
      : (request) => Effect.flatMap(httpClient.execute(request), withOptionalResponse)
  }
  const decodeSuccess =
    <Schema extends Schema.Top>(schema: Schema) =>
    (response: HttpClientResponse.HttpClientResponse) =>
      HttpClientResponse.schemaBodyJson(schema)(response)
  const decodeError =
    <const Tag extends string, Schema extends Schema.Top>(tag: Tag, schema: Schema) =>
    (response: HttpClientResponse.HttpClientResponse) =>
      Effect.flatMap(
        HttpClientResponse.schemaBodyJson(schema)(response).pipe(
          Effect.mapError(
            () =>
              new HttpClientError.HttpClientError({
                reason: new HttpClientError.StatusCodeError({
                  request: response.request,
                  response,
                  description: "Error response did not match the documented schema",
                }),
              }),
          ),
        ),
        (cause) => Effect.fail(AresClientError(tag, cause, response)),
      )
  return {
    httpClient,
    "vratEkonomickySubjekt": (ico, options) => HttpClientRequest.get(`/ekonomicke-subjekty/${ico}`).pipe(
    withResponse(options?.config)(HttpClientResponse.matchStatus({
      "2xx": decodeSuccess(VratEkonomickySubjekt200),
      "400": decodeError("VratEkonomickySubjekt400", VratEkonomickySubjekt400),
      "401": decodeError("VratEkonomickySubjekt401", VratEkonomickySubjekt401),
      "403": decodeError("VratEkonomickySubjekt403", VratEkonomickySubjekt403),
      "404": decodeError("VratEkonomickySubjekt404", VratEkonomickySubjekt404),
      "500": decodeError("VratEkonomickySubjekt500", VratEkonomickySubjekt500),
      orElse: unexpectedStatus
    }))
  )
  }
}

export interface AresClient {
  readonly httpClient: HttpClient.HttpClient
  /**
* Vyhledání ekonomického subjektu ARES podle zadaného iča
*/
readonly "vratEkonomickySubjekt": <Config extends OperationConfig>(ico: string, options: { readonly config?: Config | undefined } | undefined) => Effect.Effect<WithOptionalResponse<typeof VratEkonomickySubjekt200.Type, Config>, HttpClientError.HttpClientError | SchemaError | AresClientError<"VratEkonomickySubjekt400", typeof VratEkonomickySubjekt400.Type> | AresClientError<"VratEkonomickySubjekt401", typeof VratEkonomickySubjekt401.Type> | AresClientError<"VratEkonomickySubjekt403", typeof VratEkonomickySubjekt403.Type> | AresClientError<"VratEkonomickySubjekt404", typeof VratEkonomickySubjekt404.Type> | AresClientError<"VratEkonomickySubjekt500", typeof VratEkonomickySubjekt500.Type>>
}

export interface AresClientError<Tag extends string, E> {
  readonly _tag: Tag
  readonly request: HttpClientRequest.HttpClientRequest
  readonly response: HttpClientResponse.HttpClientResponse
  readonly cause: E
}

class AresClientErrorImpl extends Data.Error<{
  _tag: string
  cause: any
  request: HttpClientRequest.HttpClientRequest
  response: HttpClientResponse.HttpClientResponse
}> {}

export const AresClientError = <Tag extends string, E>(
  tag: Tag,
  cause: E,
  response: HttpClientResponse.HttpClientResponse,
): AresClientError<Tag, E> =>
  new AresClientErrorImpl({
    _tag: tag,
    cause,
    response,
    request: response.request,
  }) as any
