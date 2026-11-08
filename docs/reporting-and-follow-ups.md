# Rapporter og oppfølging

## Hva som er bygget

Rapportkurven kan bytte mellom leads, fullførte samtalelogger, møteregistreringer, salg og salgsverdi.

Egne sider for **Rapporter** og **Oppfølging**, et rapporterings-API, en prosjektisolert oppgavekø og en redigert aktivitetstidslinje på leadkortet. Eksisterende autentisering, transaksjoner og Supabase RLS brukes videre. Ingen nye produksjonsavhengigheter.

Rapporter er for `leader` og `admin`. Oppfølging og aktivitet er for `seller`, `booker`, `closer`, `leader` og `admin`. Partnerrollen får ingen av de nye endepunktene. API-et håndhever dette uavhengig av hvilke knapper som vises.

## API

Alle stier har prefikset `/api/v1/projects/{project_id}` og krever et gyldig Supabase-token.

| Metode | Sti | Formål |
|---|---|---|
| GET | `/reports?start=2026-10-01&end=2026-10-31&timezone=Europe/Oslo` | Måltall, daglig serie, pipeline, konvertering og fordelingsstatistikk |
| GET | `/follow-ups?status=open&overdue=false&limit=50&offset=0` | Oppgavekø, eventuelt med `lead_id` |
| POST | `/follow-ups` | Opprett egen oppgave, eller tildel den som leder til en medarbeider med tilgang til leadet |
| PATCH | `/follow-ups/{task_id}` | Avslutt med `done` eller `cancelled` |
| PATCH | `/follow-ups/{task_id}/assignee` | Tildel en åpen oppgave til en annen medarbeider som leder |
| GET | `/leads/{lead_id}/activity?limit=30&offset=0` | Tidslinje med handlingstype og tidspunkt |

Eksempel på oppretting (UUID-er erstattes med faktiske verdier):

```json
{
  "lead_id": "00000000-0000-0000-0000-000000000001",
  "title": "Følg opp tilbud",
  "note": "Avklar neste steg",
  "due_at": "2026-11-02T09:00:00+01:00",
  "idempotency_key": "00000000-0000-0000-0000-000000000002"
}
```

Uten `assignee_id` tildeles oppgaven den innloggede brukeren. Med en annen ansvarlig krever API-et leder- eller administratorrolle og validerer at mottakeren er aktiv og kan åpne leadet i prosjektet. Nøkkelen må gjenbrukes ved nettverksretry av samme oppretting. Samme nøkkel med endret innhold gir 409. Gjentatt avslutning med samme status er idempotent; en allerede avsluttet oppgave kan ikke bytte sluttilstand. Det sendes ingen e-post eller push. Forfalte åpne oppgaver vises ved lesing av køen.

Køen returnerer `items`, `has_more`, `offset` og `truncated`. Sidestørrelsen er maksimalt 100 og offset maksimalt 10 000. Ved visningsgrensen signaliseres `truncated`; avgrens søket. Aktivitet har samme sidekontrakt. Tidslinjen returnerer aldri rå auditdetaljer, salgsfordeling, notater eller tokenopplysninger. Relaterte salg og oppgaver følger sine egne RLS-regler.

## Definisjoner for rapporter

Periodens start- og sluttdato er **inklusive lokale kalenderdatoer**. SQL bruker et halvt åpent UTC-intervall `[start, neste lokale midnatt etter slutt)`. Europe/Oslo er standard; døgn ved klokkeomstilling håndteres som 23/25 timer. Maksimum 366 kalenderdager. Uten datoer brukes de siste 30 dagene, inkludert dagens dato i valgt tidssone.

- `totals.leads`: leads opprettet i perioden.
- `totals.calls`: samtalelogger fullført i perioden (`completed_at`), inkludert «ikke svar». En autorisert telefonlenke alene teller ikke som en fullført samtale eller en besvart telefonsamtale.
- `totals.meetings`: møteposter opprettet i perioden, uavhengig av fremtidig møtedato. Dette er registreringer, ikke dokumentert oppmøte.
- `totals.sales` / `revenue_ore`: NOK-salg registrert i perioden og summen i heltallsøre, eks. mva. Venter-på-bekreftelse og ikke-godkjente salg er inkludert. Dette er ikke utbetalt provisjon eller regnskapsført inntekt.
- `series`: de samme definisjonene per lokal dato, med nuller for dager uten aktivitet. Summer beregnes i PostgreSQL, uavhengig av frontendens 500-raders lister.
- `pipeline`: **nåværende** leadstatus for hele prosjektet. Den beskriver ikke status ved en historisk sluttdato og er ikke en sekvensiell salgstrakt.
- `cohort`: leads opprettet i perioden og hvor mange av disse som har minst ett NOK-salg registrert før periodens slutt. Hvert lead teller én gang, og direkte salg uten møte er inkludert. Tom gruppe gir `null` konvertering, ikke en oppdiktet prosent.
- `distributions.sale_amount`: femtallssammendrag av periodens registrerte NOK-salg i øre.
- `distributions.hours_to_sale`: samme sammendrag av timer fra leadets oppretting til hver salgsregistrering i perioden. Negative tidsintervaller utelates.

Prosjektanalysen viser median for salgsbeløp og tid til salg når utvalget har minst fem observasjoner. API-et beregner kvartilene med PostgreSQL `percentile_cont`. Velg et måltall for å se dagsserien, eller åpne en dato for å se alle dagens summer. Leadstatus viser prosjektets nåværende kontakter, også når perioden endres.

## Demo

I prosjektet Digitale vekstpakker viser den historiske serien et merket eksempel fra oktober 2026. Fordelingen på leadstatus og kundene du åpner derfra, kommer fra det aktive demoprosjektet. Kilden er `backend/scripts/generate_demo_report.py`, som bruker den samme rapportassembleren som backend. Generer på nytt fra prosjektroten med `.venv/bin/python backend/scripts/generate_demo_report.py`.

Demooppgaver ligger kun i komponentens minne og nullstilles når oppfølgingssiden forlates. Demoen skriver ingen journalposter; aktivitetshistorikken sier dette eksplisitt. Ingen database eller skjult suksess-stub benyttes.

## Databaseoppsett og kontroll i neste steg

Migrering **0002** oppretter `hub.follow_ups` og rapportindeksene. **0006** utvider tilgangsreglene slik at en leder kan delegere en åpen oppgave til en aktiv medarbeider med tilgang til leadet. Kjør alle migreringene i rekkefølge før du bruker lederporteføljen.

1. Bruk den separate disponibel-testdatabaseflyten i README og CI, med `backend/tests/bootstrap_postgres.sql` før første migrering.
2. Fra `backend`: sett `MIGRATION_DATABASE_URL` gjennom sikker konfigurasjon og kjør `../.venv/bin/python -m alembic upgrade head` med administrativ migreringsrolle.
3. Kjør `.venv/bin/python -m pytest backend/tests -q` fra roten med `TEST_DATABASE_URL` til den migrerte disponible databasen. Kontroller at PostgreSQL-testene blir kjørt. Nye tester dekker oppgaveisolasjon, samtidige idempotente opprettinger og faktisk PostgreSQL-rapportaggregering.
4. Koble API-et til den begrensede runtime-rollen og kontroller to prosjekter og to selgere. Kontroller rapporter som leder og avvisning som partner/selger. Bekreft at en selger ikke kan lese eller avslutte en annens oppgaver.

Kontroll uten database: Python-enhetstester, autentiseringskrav for API, TypeScript/produksjonsbygg, Playwright på desktop/mobil og offline-generering av hele migrerings-SQL-en. Dette verifiserer ikke kjørte migreringer, PostgreSQL-privilegier, RLS eller faktisk SQL-ytelse. Live API krever migrert database; dette må fullføres før reelle data tas i bruk.

## Lederens salgsportefølje

`GET /api/v1/portfolio/sales` summerer alle registrerte salg i prosjektene der brukeren har aktivt leder- eller administratormedlemskap. Uten prosjektfilter dekker tallene disse prosjektene samlet. Filtrene `project_id`, `kind` (B2B/B2C), `project_type` og `team` kan kombineres. `offset` gjelder salgsradene. Summer og sammenligning per prosjekt bruker hele utvalget.

- **Leads** teller kontakter. Med teamfilter brukes dagens team for ringelistens ansvarlige. Kontakter uten listetildeling telles når alle team er valgt.
- **Samtaler** teller fullførte samtalelogger, også «ikke svar». **Møter** teller registrerte møter. Teamfilteret bruker samtaleeierens eller bookerens nåværende aktive prosjektmedlemskap.
- **Kjøpere** teller ulike leads med registrert salg, slik at flere salgsrader på samme kundecase gir én kjøper. **Salg og omsetning** bruker salgsradene i FastAPI. Beløp er i øre.
- Kjøpere, salg og omsetning følger teamet som databasen lagret ved salget. Et senere teambytte flytter aktivitetsmålingene til dagens team, mens salget fortsatt inngår i teamets historiske tall. Eldre salg uten lagret team inngår når alle team er valgt.
