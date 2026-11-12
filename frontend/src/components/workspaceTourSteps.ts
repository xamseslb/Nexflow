type Step = { target: string; title: string; body: string }
const step = (target: string, title: string, body: string): Step => ({ target, title, body })

const newLead = step('[data-tour="new-lead"]', 'Legg til en kontakt', 'Velg «Nytt lead» for å registrere en bedrift eller privatperson i prosjektet. For en bedrift kan du legge inn organisasjonsnummeret for å få et presist bedriftsoppslag.')
const leadCard = step('.lead-row:is(button), .board-card', 'Åpne leadkortet', 'Velg en kontakt for å se samtalegrunnlag og historikk. På bedriftskortet finner du også bedriftsopplysninger. Når du har ringetilgang, kan du starte en samtale herfra og registrere utfallet.')
const search = step('[aria-label="Søk i leads"]', 'Finn riktig kontakt', 'Skriv inn en bedrift, kontaktperson eller by. Listen viser treff mens du skriver.')
const book = step('[data-tour="meeting-sale"]', 'Book et møte', 'Velg «Book møte», finn kontakten og fyll ut tidspunkt, møteansvarlig og det dere har avklart.')

const pages: Record<string, Step[]> = {
  discovery: [step('[data-tour="discovery-settings"]', 'Velg hvem systemet skal finne', 'Velg bransjer og en Cold-kø. Aktiver søket og lagre. Systemet søker i Oslo hver time og oppretter høyst 20 nye bedriftskort per norsk kalenderdag.'),
    step('[data-tour="discovery-results"]', 'Kontroller treffene', 'Her ser du importerte bedrifter og treff som ble utelatt. Trykk på et bedriftsnavn for å åpne kundekortet. Treff uten telefon må gjennomgås og få et kontrollert bedriftsnummer før de legges i Cold-køen.')],
  overview: [
    step('.day-metrics button', 'Start med neste samtale', '«Klar til oppfølging» åpner ringelisten med nye leads og tilbakekallinger. De øvrige nøkkeltallene åpner tilbakekallinger, møter eller salg.'),
    step('.console-pipeline', 'Les leadstatusen', 'Hver rad viser hvor mange kontakter som har den statusen nå. Velg for eksempel «Ring tilbake» for å åpne ringelisten med det filteret.'),
    step('.day-panel:nth-child(2) header button', 'Sjekk kommende møter', '«Se alle møter» åpner møtekalenderen for prosjektet. Velger du et av møtene under, vises akkurat den avtalen.'),
    newLead, leadCard,
  ],
  leads: [search, step('.table-toolbar .tabs', 'Velg hvem du vil følge opp', '«Klar til samtale» snevrer inn listen. «Ring tilbake» viser kontaktene som skal ringes opp igjen.'),
    step('.view-switch', 'Bytt mellom tavle og liste', 'Tavlen grupperer kontaktene etter status. Listen viser dem som rader du kan åpne.'), leadCard, newLead],
  queues: [step('.cq-filters', 'Velg type ringekø', 'Hot, Cold og Winback er tre ulike køer. Bruk Hot for varme kontakter, Cold for kald kontakt og Winback for å vinne tilbake kunder. «Alle lister» fjerner kategorifilteret.'),
    step('.cq-actions button[aria-label^="Åpne"]', 'Arbeid gjennom en liste', '«Åpne liste» henter neste tilgjengelige kontakt. Les kundekortet før du velger å ringe. Etter samtalen lagrer du utfallet og går videre.'),
    step('.cq-toolbar > button', 'Opprett en ringeliste', 'Velg «Ny ringeliste», gi listen et navn og velg kategori. Etterpå kan du åpne tannhjulet for å fordele kontakter og tildele en selger.'),
    step('.cq-actions button[aria-label^="Administrer"]', 'Fordel arbeidet', 'Tannhjulet åpner listen for administrasjon. Her kan du velge ansvarlig selger og flytte kontakter til listen.')],
  customers: [step('.customer-search input', 'Søk i kunderegisteret', 'Finn en kunde med navn eller telefonnummer. Velg treffet for å åpne kundekortet.'),
    step('.customer-index .customer-row', 'Forbered neste samtale', 'På kundekortet ser du kontaktinformasjon, salgstrinn og historikk. For bedrifter kan du lese regnskap, lederroller og utdrag fra nettsiden før du ringer.'),
    step('.business-example', 'Se et ekte bedriftsoppslag', 'Denne demoknappen åpner et datert oppslag for Bouvet Norge AS. Se omsetning, driftsresultat, egenkapital, lederroller og hva bedriften forteller på nettsiden sin.'),
    step('.customer-detail .business-facts', 'Les deg opp før du ringer', 'Sjekk hvilket regnskapsår tallene gjelder, se hvem som leder bedriften og les nettsideutdraget. Kildelenkene og datoene viser hvor opplysningene kommer fra.'),
    step('.customer-stage select', 'Følg salgsprosessen', 'Fremdriften viser hvor kunden står i salgsprosessen. Velg neste salgstrinn når dere faktisk har kommet videre. Et gjennomført salg registreres fra leadkortet.'),
    step('.customer-switch button:nth-child(2)', 'Gjennomgå flaggede samtaler', '«Kvalitetskontroll» åpner samtaler som er sendt til leder for gjennomgang.'), newLead],
  meetings: [book, step('.meeting-card .record-name', 'Åpne kunden bak møtet', 'Trykk på kundenavnet for å se historikk og tidligere avtaler.'),
    step('.meeting-card dl', 'Les kvalifiseringen', 'Se hva som ble avklart om behov, budsjett, beslutningstaker og tidslinje ved booking. Etter møtet kan ansvarlig registrere utfallet når knappen blir tilgjengelig.'),
    step('[data-tour="calendar"]', 'Legg møtet i kalenderen', 'Last ned kalenderfilen og åpne den i kalenderappen din.')],
  sales: [step('.sales-summary h2', 'Les opptjeningen', 'Beløpet viser foreløpig provisjon for salgene i prosjektet. Status på hver salgsrad viser hvor langt salget har kommet i godkjenningen.'),
    step('[data-tour="meeting-sale"]', 'Registrer et salg', 'Velg kunden og produktet, og send salget til godkjenning. På salgssiden kan du deretter følge status og opptjening.'),
    step('.sale-row .record-name', 'Se salget på kundekortet', 'Velg kundenavnet for å åpne de registrerte salgene for denne kunden.'),
    step('.sale-row .badge', 'Følg godkjenningen', 'Les status på salgsraden. «Til godkjenning» betyr at salget er registrert og avventer behandling. Salgsverdien og selgerens provisjon står hver for seg.'),
    step('.sales-summary button:enabled', 'Eksporter salg', '«Eksporter CSV» laster ned salgsdataene som en fil du kan åpne i et regneark.')],
  projects: [step('.project-card .project-meta', 'Les prosjektkortet', 'Se om prosjektet er aktivt, hvilket kundesegment det gjelder og rollen du har. Rollen avgjør hvilke handlinger du får utføre.'),
    step('[aria-label^="Endre prosjekttype"]', 'Sett prosjekttype', '«Endre» ved prosjekttypen åpner feltet for redigering. Prosjekttypen kan senere brukes til å filtrere lederrapporten.'),
    step('.access-members button', 'Administrer prosjektmedlemmer', 'Velg en medarbeider for å se og redigere vedkommendes tilgang og team. Kontroller at du står i riktig prosjekt før du lagrer.'),
    step('[data-tour="open-project"]', 'Arbeid i et prosjekt', 'Knappen på prosjektkortet åpner ringelisten i det valgte prosjektet. Din rolle vises på kortet.')],
  tasks: [step('.task-filters', 'Finn oppgavene som haster', 'Velg status, eller kryss av for «Kun forfalte» for å finne oppgaver som har passert fristen.'),
    step('.task-create select[name="lead"]', 'Planlegg neste steg', 'Velg kontakten, beskriv oppgaven og sett en frist. Trykk «Opprett oppfølging» for å legge den i køen.'),
    step('.task-create input[name="due"]', 'Sett fristen', 'Velg både dato og klokkeslett. Skriv gjerne et notat om hva som er avtalt, slik at den som følger opp vet hva kunden venter på.'),
    step('.task-actions button', 'Fullfør oppgaven', 'Velg «Fullfør» når arbeidet er gjort. Du finner oppgaven igjen under statusen «Fullført».')],
  reports: [step('.report-switch', 'Velg rapport', '«Lederoversikt» viser resultater på tvers av prosjekter. «Prosjektanalyse» viser utviklingen i det aktive prosjektet.'),
    step('.pf-filters', 'Avgrens rapporten', 'Bruk filtrene for å undersøke resultater for et prosjekt, en prosjekttype, et kundesegment eller et team.'),
    step('.pf-metrics button', 'Undersøk tallene', 'Velg Leads, Fullførte samtaler, Registrerte møter eller Kjøpende kunder for å se postene bak tallet. Listen følger filtrene du har valgt.'),
    step('.pf-sale', 'Åpne et registrert salg', 'Velg en salgsrad for å se beløp, status og fordeling. Fra detaljene kan du gå videre til kunden.'),
    step('.report-switch button:nth-child(2)', 'Se utviklingen over tid', 'Prosjektanalyse lar deg velge periode og måltall. Bruk datagrunnlaget per dag når du vil undersøke hva som ligger bak en endring.')],
}

const introductions: Record<string, string> = {
  leads: 'Her velger du én kontakt å arbeide med. Bruk søk eller statusfilter, og åpne et leadkort for å forberede samtalen.',
  queues: 'Arbeid gjennom en tildelt ringeliste i rekkefølge. Nexflow kontrollerer ringetillatelse før en samtale kan startes.',
  customers: 'Her samles kontaktinformasjon, bedriftsoppslag og kundens historikk. Start i registeret for å finne kunden du skal snakke med.',
  meetings: 'Her finner du tidspunkt og kvalifisering for registrerte møter. Både selger og møteansvarlig kan bruke opplysningene til å forberede seg.',
  sales: 'Her følger du salgene i prosjektet fra registrering til godkjenning. Hver rad viser kunden, salgsverdien og provisjonen.',
  projects: 'Prosjektkortene viser hvilke arbeidsområder du har tilgang til. Hvert prosjekt har egne kunder, salgsdata og rettigheter.',
  tasks: 'Bruk oppfølgingskøen for avtaler som trenger en ansvarlig og en frist, for eksempel å sende tilbud etter en samtale.',
  reports: 'Her undersøker du resultatene. Start med lederoversikten for å sammenligne prosjekter, eller åpne prosjektanalysen for å følge utviklingen over tid.',
  discovery: 'Finn nye bedrifter automatisk fra Brønnøysundregistrene. Du velger bransjer og mottakskø, og følger importhistorikken her.',
}

export function pageSteps(view: string, label: string, full: boolean, finalPage: boolean) {
  return [
    ...(!full || view === 'overview' ? [step('.project-picker', 'Velg arbeidsprosjekt', 'Prosjektvelgeren bestemmer hvilke kunder, møter og salg du arbeider med. Her kan du bytte mellom prosjektene dine.'),
    step('@menu', 'Finn fram i Nexflow', 'Bruk hovedmenyen for å bytte side. På mobil åpner du den med menyknappen. Sidene du ser, følger rollen din i prosjektet.')] : [step('.page-heading h1', label, introductions[view])]),
    ...(pages[view] || []),
    ...(!full || finalPage ? [step('[data-tour="help"]', 'Få hjelp på siden du bruker', 'Spørsmålstegnet åpner Hjelp. Velg «Vis omvisning på denne siden» når du vil se hva knappene på en annen side gjør. Du kan også starte hele omvisningen igjen.')] : []),
  ]
}

export function tourTarget(selector: string) {
  if (selector === '@menu') selector = matchMedia('(min-width:1121px)').matches ? '#workspace-menu [aria-current="page"]' : '.mobile-menu'
  return Array.from(document.querySelectorAll<HTMLElement>(selector)).find(element => element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden')
}
