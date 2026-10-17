import asyncio
import json
from pathlib import Path


GROUPS = {
    "core": ["Vancouver", "Burnaby", "New Westminster", "Richmond"],
    "north-shore": ["North Vancouver City", "North Vancouver District", "West Vancouver", "Lions Bay"],
    "south-of-fraser": ["Surrey", "White Rock", "Delta", "Langley City", "Langley Township"],
    "northeast": ["Coquitlam", "Port Coquitlam", "Port Moody", "Anmore", "Belcarra"],
    "ridge-valley": ["Maple Ridge", "Pitt Meadows", "Bowen Island", "Electoral Area A"],
}

SOURCE_SCHEMA = {
    "type": "object",
    "properties": {
        "group": {"type": "string"},
        "municipalities": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "name": {"type": "string"},
                    "official_name": {"type": "string"},
                    "meeting_portal_url": {"type": "string"},
                    "calendar_url": {"type": "string"},
                    "platform": {"type": "string"},
                    "document_types": {
                        "type": "array",
                        "items": {"type": "string"},
                    },
                    "access_notes": {"type": "string"},
                    "verified": {"type": "boolean"},
                },
            },
        },
    },
    "required": ["group", "municipalities"],
}

REGISTRY_SCHEMA = {
    "type": "object",
    "properties": {
        "sources": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "id": {"type": "string"},
                    "name": {"type": "string"},
                    "officialName": {"type": "string"},
                    "meetingPortalUrl": {"type": "string"},
                    "calendarUrl": {"type": "string"},
                    "platform": {"type": "string"},
                    "documentTypes": {
                        "type": "array",
                        "items": {"type": "string"},
                    },
                    "accessNotes": {"type": "string"},
                    "enabledByDefault": {"type": "boolean"},
                },
            },
        },
        "caveats": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["sources", "caveats"],
}


async def research_group(group, municipalities):
    return await agent(
        phase="research",
        label=group,
        schema=SOURCE_SCHEMA,
        soft_time_limit_minutes=12,
        prompt=(
            "Research official local-government sources for council meeting documents in "
            "Metro Vancouver, British Columbia. Only use official municipal or official "
            "meeting-portal pages. For each municipality, find the canonical meeting portal "
            "and calendar/list URL, identify the platform when possible (for example eSCRIBE, "
            "CivicWeb, Granicus, Legistar, custom), list available document types such as "
            "agenda, minutes, reports, video, and note whether pages or documents need "
            "JavaScript, API calls, or PDF link extraction. Verify URLs by opening them. "
            "Do not invent a URL. If a municipality has no verified source, return empty URLs "
            "and explain why in access_notes.\n\n"
            f"Group: {group}\nMunicipalities: {json.dumps(municipalities)}"
        ),
    )


async def main():
    await register_workflow(
        {
            "name": "lower-mainland-source-map",
            "description": "Verify and normalize official council meeting document sources.",
            "product": "Lower Mainland Council Collector",
            "soft_time_limit_minutes": 12,
            "subscribe": "refresh",
            "phases": [
                {
                    "title": "research",
                    "detail": "Verify official meeting portals by municipality group",
                    "labels": list(GROUPS.keys()),
                },
                {
                    "title": "normalize",
                    "detail": "Merge verified findings into the application source registry",
                    "count": 1,
                },
            ],
        }
    )
    log("Starting municipality source research")
    tasks = [
        lambda group=group, municipalities=municipalities: research_group(
            group, municipalities
        )
        for group, municipalities in GROUPS.items()
    ]
    researched = await parallel(tasks)
    log("Research complete; normalizing source registry")
    normalized = await agent(
        phase="normalize",
        label="registry",
        schema=REGISTRY_SCHEMA,
        soft_time_limit_minutes=10,
        prompt=(
            "Normalize the following research results into a TypeScript-friendly source "
            "registry. Preserve only verified official URLs. Use lowercase kebab-case ids. "
            "Set enabledByDefault true only when meetingPortalUrl is verified and directly "
            "useful. Keep accessNotes concise and retain caveats about unstable portals, "
            "JavaScript-only access, ambiguous date semantics, or missing sources. Include "
            "every researched municipality exactly once.\n\n"
            + json.dumps(researched, sort_keys=True)
        ),
    )
    output = Path(
        "/home/ubuntu/repos/lower-mainland-council-collector/source-registry.json"
    )
    output.write_text(json.dumps(normalized, indent=2) + "\n")
    log(f"Wrote normalized registry with {len(normalized['sources'])} sources")


asyncio.run(main())
