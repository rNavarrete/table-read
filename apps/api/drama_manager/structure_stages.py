"""Canonical stage order and labels for the AI structure checks (spec 2026-10-11;
Turning Points, T10.5).

The web keeps its own copy for display (apps/web/src/ledger/structure/stages.ts);
both follow the spec's lists, and tests on each side pin the order.
"""

from __future__ import annotations

STRUCTURE_NAMES: dict[str, str] = {
    "heros_journey": "the Hero's Journey",
    "story_circle": "Dan Harmon's Story Circle",
    "save_the_cat": "Save the Cat (Blake Snyder's beat sheet)",
    "turning_points": "the five turning points (Michael Hauge's, as the TRIPOD study defines them)",
}

STRUCTURE_STAGES: dict[str, tuple[tuple[str, str], ...]] = {
    "heros_journey": (
        ("ordinary_world", "Ordinary world"),
        ("call_to_adventure", "Call to adventure"),
        ("refusal", "Refusal of the call"),
        ("meeting_the_mentor", "Meeting the mentor"),
        ("crossing_the_threshold", "Crossing the threshold"),
        ("tests_allies_enemies", "Tests, allies, enemies"),
        ("approach", "Approach to the inmost cave"),
        ("ordeal", "Ordeal"),
        ("reward", "Reward"),
        ("road_back", "The road back"),
        ("resurrection", "Resurrection"),
        ("return_with_elixir", "Return with the elixir"),
    ),
    "story_circle": (
        ("circle_you", "You (comfort zone)"),
        ("circle_need", "Need"),
        ("circle_go", "Go"),
        ("circle_search", "Search"),
        ("circle_find", "Find"),
        ("circle_take", "Take"),
        ("circle_return", "Return"),
        ("circle_change", "Change"),
    ),
    "save_the_cat": (
        ("opening_image", "Opening image"),
        ("theme_stated", "Theme stated"),
        ("set_up", "Set-up"),
        ("catalyst", "Catalyst"),
        ("debate", "Debate"),
        ("break_into_two", "Break into two"),
        ("b_story", "B story"),
        ("fun_and_games", "Fun and games"),
        ("midpoint", "Midpoint"),
        ("bad_guys_close_in", "Bad guys close in"),
        ("all_is_lost", "All is lost"),
        ("dark_night_of_the_soul", "Dark night of the soul"),
        ("break_into_three", "Break into three"),
        ("finale", "Finale"),
        ("final_image", "Final image"),
    ),
    "turning_points": (
        ("tp_opportunity", "Opportunity"),
        ("tp_change_of_plans", "Change of plans"),
        ("tp_point_of_no_return", "Point of no return"),
        ("tp_major_setback", "Major setback"),
        ("tp_climax", "Climax"),
    ),
}

# Sent with the stage in the check and verify prompts. Turning Points only: its
# labels are terse, and TRIPOD (Papalampidi et al., 2019) defines each one.
STAGE_DEFINITIONS: dict[str, str] = {
    "tp_opportunity": (
        "the introductory event that comes once the setting and the protagonist's "
        "background are in place"
    ),
    "tp_change_of_plans": "the main goal of the story is defined and the action starts to build",
    "tp_point_of_no_return": "the event that pushes the protagonist to commit fully to the goal",
    "tp_major_setback": "the event where everything falls apart, for a while or for good",
    "tp_climax": "the final event of the main story: its resolution and its biggest reveal",
}
