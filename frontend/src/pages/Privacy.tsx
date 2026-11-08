import { ExtLink } from "../components/ExtLink";
import { PageSection } from "../components/PageSection";
import { Ac } from "../components/Typeset";
import { useTitle } from "../hooks/useTitle";

/**
 * The privacy notice. Each line states what the code and the agent's settings do: the statistics
 * (services/tool_log.py), the cards (services/cards.py), the rate limit (ratelimit.py), the
 * location (api/public/locate.py), no request logs (backend Dockerfile, deploy/Caddyfile) and the
 * agent (PRIVACY in scripts/elevenlabs_tools.py). Change them together.
 */
export function PrivacyPage() {
  useTitle("Privatnost");
  return (
    <div className="ab">
      <header className="phead phead--big">
        <div className="phead__text">
          <h1>Privatnost</h1>
          <p className="phead__lede">
            Uputko je prototip za Datathon Portala otvorenih podataka 2026. Liste čekanja i&nbsp;lijekovi koriste se bez
            računa i&nbsp;bez kolačića. Razgovor s&nbsp;asistentom počinje tek kad ga sami pokrenete.
          </p>
        </div>
      </header>

      <PageSection id="razgovor" title="Razgovor s asistentom">
        <ul className="ab-list">
          <li>
            <b>Ne navodite ime, OIB, broj zdravstvene iskaznice ni druge osobne podatke.</b> Za odgovor su dovoljni pregled
            ili lijek i&nbsp;mjesto.
          </li>
          <li>
            Glas i&nbsp;tekst razgovora obrađuju ElevenLabs (prepoznavanje i&nbsp;sinteza govora) i&nbsp;jezični model OpenAI
            gpt-5.4-mini, preko ElevenLabsa. ElevenLabs pritom vidi i&nbsp;IP adresu vašeg uređaja.
          </li>
          <li>
            U&nbsp;postavkama agenta snimanje glasa je isključeno, a&nbsp;zapis razgovora briše se odmah nakon završetka.
          </li>
          <li>
            Podaci se prenose u&nbsp;SAD. ElevenLabs se pritom poziva na Okvir EU-a i&nbsp;SAD-a za privatnost podataka
            i&nbsp;standardne ugovorne klauzule:{" "}
            <ExtLink href="https://elevenlabs.io/privacy-policy">politika privatnosti</ExtLink>,{" "}
            <ExtLink href="https://elevenlabs.io/dpa">ugovor o&nbsp;obradi</ExtLink>.
          </li>
        </ul>
      </PageSection>

      <PageSection id="posluzitelj" title="Što ostaje na poslužitelju">
        <p>Poslužitelj Uputka je u&nbsp;Google Cloudu, u&nbsp;Frankfurtu.</p>
        <ul className="ab-list">
          <li>
            Statistika upita: alat, tema (npr. kardiologija), naselje, općina i&nbsp;županija, profil, vrijeme te ishod
            i&nbsp;trajanje odgovora. Ne sadrži tekst pitanja, IP adresu ni oznaku razgovora.
          </li>
          <li>Odgovori prikazani na ekranu čuvaju se 24 sata uz nasumičnu oznaku razgovora, a&nbsp;zatim se brišu.</li>
          <li>
            Snimke, transkripti i&nbsp;IP adrese ne spremaju se. IP adresa je samo kratko u&nbsp;radnoj memoriji, za
            ograničenje broja zahtjeva.
          </li>
        </ul>
      </PageSection>

      <PageSection id="lokacija" title="Lokacija">
        <p>
          Lokacija se koristi samo kad je sami zatražite. Koordinate služe za pronalazak najbližeg naselja i&nbsp;ne spremaju
          se. U&nbsp;razgovoru se asistentu šalje samo naziv naselja.
        </p>
      </PageSection>

      <PageSection id="kolacici" title="Kolačići i praćenje">
        <p>
          Nema kolačića, analitike ni oglasa. Slova i&nbsp;ikone dolaze s&nbsp;poslužitelja Uputka. Postavke prikaza spremaju
          se samo u&nbsp;vašem pregledniku.
        </p>
      </PageSection>

      <PageSection id="osnova" title="Pravna osnova i dob">
        <p>
          Razgovor se temelji na vašoj privoli: pokrećete ga sami, pritiskom na mikrofon ili slanjem pitanja, a&nbsp;možete
          ga prekinuti bilo kad. Ako spomenete podatke o&nbsp;zdravlju, privola vrijedi i&nbsp;za njih. Za razgovor
          s&nbsp;asistentom trebate imati najmanje 16 godina.
        </p>
      </PageSection>

      <PageSection id="prava" title="Odgovorna osoba i vaša prava">
        <p>
          Eugen Sedlar, autor prototipa: <a href="mailto:esedlar@student.ferit.hr">esedlar@student.ferit.hr</a>
        </p>
        <p>
          Možete zatražiti pristup podacima, ispravak ili brisanje, prigovoriti obradi i&nbsp;povući privolu. Podaci se ne
          vežu uz osobu, pa uz zahtjev navedite vrijeme razgovora. Prigovor možete podnijeti i&nbsp;Agenciji za zaštitu
          osobnih podataka (<ExtLink href="https://azop.hr">azop.hr</ExtLink>).
        </p>
        <p className="small">
          Uputko nije služba države ni <Ac end="a">HZZO</Ac>. Zadnja izmjena: 4. studenoga 2026.
        </p>
      </PageSection>
    </div>
  );
}
