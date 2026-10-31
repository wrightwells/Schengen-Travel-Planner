"""Versioned reference data; v1's coverage begins at the modern rule's lookback limit.

Do not alter v1 data after release: use a new version and migration for updates.
Sources and geographic scope are recorded in docs/country-catalogue.md.
"""

from datetime import date, timedelta

from sqlalchemy import insert

from app.models import Country, Membership

CATALOGUE_VERSION = "2026-10-28-v1"
COVERAGE_START = date(2013, 4, 22)
RULE_START = date(2013, 10, 18)
MAX_DATE = date(2100, 12, 31)

# These states were already members when the supported coverage interval began.
MEMBERS_AT_COVERAGE_START = {
    "AT": "Austria",
    "BE": "Belgium",
    "CH": "Switzerland",
    "CZ": "Czechia",
    "DE": "Germany",
    "DK": "Denmark",
    "EE": "Estonia",
    "ES": "Spain",
    "FI": "Finland",
    "FR": "France",
    "GR": "Greece",
    "HU": "Hungary",
    "IS": "Iceland",
    "IT": "Italy",
    "LI": "Liechtenstein",
    "LT": "Lithuania",
    "LU": "Luxembourg",
    "LV": "Latvia",
    "MT": "Malta",
    "NL": "Netherlands",
    "NO": "Norway",
    "PL": "Poland",
    "PT": "Portugal",
    "SE": "Sweden",
    "SI": "Slovenia",
    "SK": "Slovakia",
}
ACCESSIONS = {
    "HR": ("Croatia", date(2023, 1, 1)),
    "BG": ("Bulgaria", date(2024, 3, 31)),
    "RO": ("Romania", date(2024, 3, 31)),
}
NON_MEMBERS = {
    "GB": "United Kingdom",
    "IE": "Ireland",
    "CY": "Cyprus",
    "AL": "Albania",
    "BA": "Bosnia and Herzegovina",
    "ME": "Montenegro",
    "MK": "North Macedonia",
    "RS": "Serbia",
    "TR": "Türkiye",
    "US": "United States",
    "CA": "Canada",
    "AU": "Australia",
    "NZ": "New Zealand",
    "MA": "Morocco",
    "EG": "Egypt",
    "AE": "United Arab Emirates",
    "JP": "Japan",
    "TH": "Thailand",
    "GE": "Georgia",
    "UA": "Ukraine",
    "GL": "Greenland",
    "FO": "Faroe Islands",
    "GF": "French Guiana",
    "RE": "Réunion",
    "GP": "Guadeloupe",
    "MQ": "Martinique",
    "YT": "Mayotte",
    "GI": "Gibraltar",
    "JE": "Jersey",
    "GG": "Guernsey",
    "IM": "Isle of Man",
    "CW": "Curaçao",
    "SX": "Sint Maarten",
}


def seed_catalogue(connection):
    """Called once by migration, or explicitly in disposable tests."""
    names = {
        **MEMBERS_AT_COVERAGE_START,
        **NON_MEMBERS,
        **{code: value[0] for code, value in ACCESSIONS.items()},
    }
    rows = []
    for code, name in names.items():
        note = ""
        if code in {"FR", "NL", "DK", "NO"}:
            note = "European Schengen territory only; select overseas destinations separately."
        rows.append({"code": code, "name": name, "note": note})
    connection.execute(insert(Country.__table__), rows)
    intervals = []
    for code in names:
        accession = ACCESSIONS.get(code)
        if accession:
            intervals.append(
                {
                    "country_code": code,
                    "effective_from": COVERAGE_START,
                    "effective_to": accession[1] - timedelta(days=1),
                    "is_schengen": False,
                }
            )
        intervals.append(
            {
                "country_code": code,
                "effective_from": accession[1] if accession else COVERAGE_START,
                "effective_to": None,
                "is_schengen": code in MEMBERS_AT_COVERAGE_START or bool(accession),
            }
        )
    connection.execute(insert(Membership.__table__), intervals)
