"""Prompts for the intent layer.

Two rules govern everything here:

1. The model returns *specific, quotable* contradictions and classifications
   against a fixed taxonomy. It is never asked for a seriousness score — a
   number a model invents is a number nobody can defend to a rejected user.
2. It is prompted with Levantine and Gulf Arabic, MSA and Arabizi examples.
   A model prompted only in English misjudges Arabic bios badly, and most
   of the user base writes in one of those registers.
"""

CONSISTENCY_SYSTEM = """You review applications to a marriage platform for Arabic-speaking users.

Your only job is to find CONTRADICTIONS between what the applicant declared in structured fields and what they wrote in free text, and to classify their stated intent.

Rules:
- Report only contradictions you can quote. Every finding must carry the exact words from the text that support it.
- Do not guess age, ethnicity, sect, religiosity, health or personality from anything. Do not comment on appearance.
- Do not judge whether someone is a good match or a good person. You are checking internal consistency only.
- The text may be in Modern Standard Arabic, Levantine or Gulf dialect, Arabizi (Arabic written in Latin letters and numerals, e.g. "3andi", "7abibi", "kteer"), English, or a mix. All are normal. Never treat dialect or Arabizi as a signal of anything.
- Absence of information is not a contradiction.

Contradiction codes you may use:
  children_contradiction      - declared children count conflicts with the text
  marital_status_contradiction- declared marital status conflicts with the text
  age_contradiction           - declared age conflicts with the text
  location_contradiction      - declared city or country conflicts with the text
  occupation_contradiction    - declared occupation conflicts with the text
  timeline_contradiction      - declared marriage timeline conflicts with the text
  copied_text                 - the text reads as copied boilerplate

Intent taxonomy (choose exactly one):
  marriage_seeking     - clearly seeking marriage
  ambiguous            - too little to tell
  casual_seeking       - seeking something other than marriage
  commercial           - promoting a business, service or account
  scam_or_commercial   - romance-fraud or recruitment patterns
"""

CONSISTENCY_USER_TEMPLATE = """Structured fields:
- gender: {gender}
- age: {age}
- city: {city}, country: {country}
- marital_status: {marital_status}
- children_count: {children_count}
- occupation: {occupation}
- education: {education}
- marriage_timeline: {timeline}
- willing_to_relocate: {relocate}
- family_aware: {family_aware}

Free text written by the applicant:
\"\"\"
{bio}
\"\"\"

Return JSON only."""

ANALYSIS_SCHEMA = {
    "type": "object",
    "required": ["intent", "intent_confidence", "contradictions", "scam_signals", "effort", "language"],
    "properties": {
        "intent": {
            "type": "string",
            "enum": ["marriage_seeking", "ambiguous", "casual_seeking", "commercial", "scam_or_commercial"],
        },
        "intent_confidence": {"type": "number", "minimum": 0, "maximum": 1},
        "contradictions": {
            "type": "array",
            "items": {
                "type": "object",
                "required": ["code", "detail", "quote"],
                "properties": {
                    "code": {"type": "string"},
                    "detail": {"type": "string"},
                    "quote": {"type": "string"},
                },
            },
        },
        "scam_signals": {"type": "array", "items": {"type": "string"}},
        "effort": {"type": "number", "minimum": 0, "maximum": 1},
        "language": {"type": "string"},
    },
}

# Known romance-fraud signatures, matched as a cheap pre-filter before the
# model is called at all. Kept here so the review desk can add to it
# without touching code paths.
SCAM_PATTERNS: dict[str, list[str]] = {
    "off_platform_push": [
        "whatsapp", "telegram", "snapchat", "instagram", "واتساب", "تلغرام",
        "my number is", "رقمي", "add me on",
    ],
    "money_talk": [
        "western union", "crypto", "bitcoin", "usdt", "gold investment", "investment opportunity",
        "send money", "help me financially", "بيتكوين", "تحويل", "استثمار",
    ],
    "classic_persona": [
        "oil rig", "widowed engineer", "deployed overseas", "peacekeeping mission",
        "contract abroad", "orphan since",
    ],
    "urgency": [
        "allah brought us", "i felt it immediately", "destiny in one day",
        "marry me tomorrow", "need to travel soon",
    ],
}

MESSAGE_SAFETY_SYSTEM = """Classify a single chat message on a marriage platform.

Return JSON with:
  contains_contact_details: bool  - phone number, email, social handle, or a link
  contains_money_request: bool    - any request for money, transfer, gift card or crypto
  harassment: bool                - sexual pressure, insults, threats, coercion
  severity: "none" | "low" | "medium" | "high"

Messages may be Arabic, Arabizi or English. Numbers written as words or with
Arabic-Indic digits still count as contact details. Do not moralise, do not
summarise the message, return JSON only."""
