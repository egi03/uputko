"""Service categories that link CEZIH procedures to HZZO-contracted providers.

A waiting list on CEZIH is per procedure ("MR koljena"); HZZO's registries say which
institutions are contracted for an activity ("2500400 Mr-magnetska rezonanca", DTP "MG001").
Both are mapped to the same category so the assistant can name providers that are contracted
but do not publish a waiting list. Codes come from the HZZO files themselves.
"""

from dataclasses import dataclass

from app.geo.normalize import normalize


@dataclass(frozen=True)
class Category:
    key: str
    label: str  # spoken, genitive-free form: "magnetska rezonancija"
    procedure_prefixes: tuple[str, ...] = ()  # normalized CEZIH procedure name prefixes
    activity_codes: tuple[str, ...] = ()  # HZZO activity codes (hospitals and SKZZ)
    dtp_prefixes: tuple[str, ...] = ()  # DTP codes in the MR/CT/UZV diagnostics sheet


# Order matters: the first match wins ("uzv srca" before "uzv").
CATEGORIES: tuple[Category, ...] = (
    Category("mr", "magnetska rezonancija", ("mr ",), ("2500400",), ("MG",)),
    Category("ct", "CT", ("ct ",), ("2500300",), ("CT",)),
    Category(
        "mammography",
        "mamografija",
        ("mamografija", "kontrastna mamografija"),
        ("2500500",),
        ("RD023", "RD064"),
    ),
    Category("echo", "ultrazvuk srca", ("uzv srca",), ("2010120",), ("UZ062",)),
    Category("ultrasound", "ultrazvuk", ("uzv ",), ("2500200", "2010020"), ("UZ",)),
    Category("xray", "rendgen", ("rtg ",), ("2500000",)),
    Category("densitometry", "denzitometrija", ("denzitometrija",), ("2500600",)),
    Category(
        "holter", "holter", ("holter", "pedijatrijski holter"), ("2010150",), ("KD004", "KD005")
    ),
    Category("ergometry", "ergometrija", ("ergometrija",), ("2010140",), ("KD002",)),
    Category(
        "endoscopy",
        "endoskopija probavnog trakta",
        ("kolonoskopija", "gastroskopija"),
        ("2010330", "2100040"),
    ),
    Category("cardiology", "kardiologija", ("kardiologija",), ("2010100",)),
    Category(
        "ophthalmology",
        "oftalmologija",
        (
            "oftalmologija",
            "djecja oftalmologija",
            "glaukom",
            "prednji ocni segment",
            "straznji ocni segment",
        ),
        ("2170000",),
    ),
    Category("dermatology", "dermatologija", ("dermatologija",), ("2040000",)),
    Category("neurology", "neurologija", ("neurologija",), ("2060000",)),
    Category("psychiatry", "psihijatrija", ("psihijatrija", "psihijatar"), ("2070000",)),
    Category("orthopedics", "ortopedija", ("ortopedija",), ("2150000",)),
    Category("ent", "otorinolaringologija", ("otorinolaringologija", "orl "), ("2160000",)),
    Category("urology", "urologija", ("urologija",), ("2140000",)),
    Category("gynecology", "ginekologija", ("ginekologija",), ("2180000",)),
    Category("internal", "interna medicina", ("interna medicina",), ("2010000",)),
    Category("pulmonology", "pulmologija", ("pulmologija",), ("2010200",)),
    Category("gastroenterology", "gastroenterologija", ("gastroenterologija",), ("2010300",)),
    Category(
        "endocrinology", "endokrinologija", ("endokrinologija", "dijabetologija"), ("2010800",)
    ),
    Category("rheumatology", "reumatologija", ("reumatologija",), ("2010600", "2050100")),
    Category(
        "physical_medicine",
        "fizikalna medicina i rehabilitacija",
        ("fizikalna medicina",),
        ("2050000",),
    ),
    Category("surgery", "opća kirurgija", ("opca kirurgija",), ("2100000",)),
    Category("pediatrics", "pedijatrija", ("pedijatrija ",), ("2090000",)),
    Category("orthodontics", "ortodoncija", ("ortodoncija",), ("2310000",)),
    Category("oral_surgery", "oralna kirurgija", ("oralna kirurgija",), ("2360000",)),
    Category("periodontology", "parodontologija", ("parodontologija",), ("2350000",)),
    Category(
        "endodontics",
        "dentalna patologija i endodoncija",
        ("dentalna patologija",),
        ("2330000",),
    ),
    Category("prosthodontics", "stomatološka protetika", ("stomatoloska protetika",), ("2300000",)),
)
_BY_ACTIVITY = {code: c for c in CATEGORIES for code in c.activity_codes}


def category_for_procedure(name: str) -> Category | None:
    norm = normalize(name, drop_words=False) + " "
    return next((c for c in CATEGORIES if norm.startswith(c.procedure_prefixes)), None)


# CEZIH names a variant at the end: "Kardiologija - Prvi pregled", "... - konzultacija bez
# pacijenta", "Mamografija u sklopu nacionalnih preventivnih programa".
_VARIANTS = (
    ("consult", "konzultacija bez pacijenta"),
    ("control", "kontrolni pregled"),
    ("first", "prvi pregled"),
    ("preventive", "nacionalnih preventivnih programa"),
    ("other", "ostali postupci"),
)
# "Sluh - jednostavno ispitivanje kod djeteta" is for a child, as "... kod odraslog" is not.
_PEDIATRIC = ("za djecu", "djecj", "djece", "djeteta", "pedijatrij", "neonatus", "dojenc")


def procedure_variant(name: str) -> str:
    norm = normalize(name, drop_words=False)
    return next((key for key, words in _VARIANTS if words in norm), "")


def is_pediatric_procedure(name: str) -> bool:
    norm = normalize(name, drop_words=False)
    return any(word in norm for word in _PEDIATRIC)


def category_for_activity(code: str | None, dtp: str | None = None) -> Category | None:
    """HZZO activity code (7 digits); a DTP code decides first where the file has one."""
    dtp = (dtp or "").strip().upper()
    if dtp:
        hit = next(
            (c for c in CATEGORIES if c.dtp_prefixes and dtp.startswith(c.dtp_prefixes)), None
        )
        if hit is not None:
            return hit
    return _BY_ACTIVITY.get((code or "").strip())
