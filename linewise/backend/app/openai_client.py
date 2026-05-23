"""Tiny wrapper around the OpenAI Chat Completions API.

LineWise only uses the LLM for the explanation layer. The local model has
already selected the recommendation. We send a minimal JSON of computed
facts and ask for a structured JSON response — no dataframes, no raw rows.
"""
from __future__ import annotations

import json
from typing import Dict, Optional

from .config import OPENAI_API_KEY, OPENAI_MODEL

SYSTEM_PROMPT = (
    "You are the explanation layer for LineWise, an execution-intelligence "
    "tool for Damm canning lines 14, 17 and 19. The local model has already "
    "selected the recommendation. You only explain computed facts to a "
    "production planner.\n\n"
    "Do not invent data, order IDs, product names, percentages, or causes. "
    "If evidence is limited, say so. Use operational language: line, OF, "
    "changeover, OEE, downtime, maintenance risk, cleaning, PNP, sequence.\n\n"
    "Return ONLY valid JSON matching this schema:\n"
    "{\n"
    '  "headline": string,\n'
    '  "planner_explanation": string,\n'
    '  "risk_note": string,\n'
    '  "bullets": string[],\n'
    '  "limitations": string\n'
    "}\n"
)


def explain_with_openai(facts: Dict) -> Optional[Dict]:
    if not OPENAI_API_KEY:
        return None
    try:
        from openai import OpenAI

        client = OpenAI(api_key=OPENAI_API_KEY)
        payload = json.dumps(facts, indent=2, default=str)
        resp = client.chat.completions.create(
            model=OPENAI_MODEL,
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": payload},
            ],
            response_format={"type": "json_object"},
            temperature=0.2,
        )
        content = resp.choices[0].message.content
        if not content:
            return None
        return json.loads(content)
    except Exception:
        return None
