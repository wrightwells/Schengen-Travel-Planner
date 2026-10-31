# Country reference catalogue v1

Version: `2026-10-28-v1`. Reviewed 28 October 2026. Reference data is seeded by
migration 0002, stored in PostgreSQL, and queried by each segment's calendar date.
No automatic legal updates are performed.

The catalogue covers the 29 Schengen states plus common other destinations and
selected overseas territories. Every supported date has an explicit true/false
membership interval; missing coverage is an error, never assumed non-Schengen.
Coverage starts **22 April 2013**, the oldest lookback input used by the European
Commission's modern short-stay calculator. Assessments start **18 October 2013**.
Earlier travel requires a separately researched catalogue/rule extension.

## Membership intervals

The 26 states already within Schengen at the start of coverage are seeded as
members from the coverage date. That date is **not their accession date**. Croatia
is non-Schengen before 1 January 2023. Bulgaria and Romania are non-Schengen before
31 March 2024. Later removal of air/land border checks is not used to defer
short-stay counting.

- [Council: current Schengen membership and exclusions](https://www.consilium.europa.eu/en/policies/schengen-area/)
- [Commission: Schengen history](https://home-affairs.ec.europa.eu/policies/schengen/schengen-area/history-schengen_en)
- [Council Decision 2022/2451: Croatia](https://eur-lex.europa.eu/eli/dec/2022/2451/oj/eng)
- [Council Decision 2024/210: Bulgaria/Romania](https://eur-lex.europa.eu/eli/dec/2024/210/oj/eng)
- [Bulgarian MFA: short-stay counting from 31 March 2024](https://www.mfa.bg/en/services-travel/consular-services/travel-bulgaria/visa-bulgaria)
- [Romanian MFA: visits count within Schengen from 31 March 2024, question 3](https://eviza.mae.ro/ro_QASchengen)
- [Commission calculator manual: effective rule date and lookback input limit](https://home-affairs.ec.europa.eu/system/files/2020-09/short_stay_schengen_calculator_user_manual_en.pdf)

## Geographic scope and maintenance

France, Netherlands, Denmark and Norway refer to their European Schengen territory;
the UI displays a note to select overseas destinations separately. Greenland,
Faroe Islands and common French/Dutch overseas destinations have separate neutral
entries. This is a destination catalogue, not a list claiming sovereign status.
Unlisted destinations cannot be entered as arbitrary countries. Svalbard and
unlisted territories need explicit reference-data additions before use.

To update: research primary sources, add a new version and data migration, validate
non-overlapping contiguous intervals, test boundaries and recalculate affected
trips. Preserve v1 seed data so installations can replay old migrations. Expected
future membership remains based on the latest reviewed catalogue and may change.
