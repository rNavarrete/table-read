# Breakdown at a glance: panel header and three board lenses (T10.12)

Owner request (2026-10-20): the Milestone 10 breakdown is on screen but not compelling. In one scene two characters' wants plainly collided, yet nothing drew the eye to it. The owner asked for research-backed ways to present these features. They chose two of five proposals to build: an "at a glance" header in the scene panel, and Turns, Clashes and Who knows board lenses. They asked for existing tokens and the redesign's rules.

## Why these two

- **Craft:** the scene checks writers run are the same few questions every time.
  - Mamet: who wants what, what happens if they don't get it, why now.
  - McKee: the opening value, the closing value, the turn.
  - Script readers' most common notes are a scene that doesn't turn, and unclear stakes.
  - The import already answers all of these; Plan buried the answers in equal-weight text.
- **Perception:** a target defined by a combination of features is found only by searching item by item. Two "Wants" rows next to each other are such a combination, which is why the conflict didn't register. A distinct mark is found at a glance, so the clash and the turn each get one.
- **Story Grid's method is scanning for scenes that don't turn.** On the owner's *Lisa's Substitute* import, 4 of the first 9 scenes hold at one value; a lens makes that one look across the board.

## What's built

- **At a glance** (`plan/panel/AtAGlance.tsx`), first in the panel body after the notes strip:
  - The turn and Why now, moved here from "What the scene does".
  - Clash: each colliding pair as stacked "Name wants …" boxes with a "vs" chip.
  - Who knows: dramatic irony and mystery as ● and ○ markers, with a spoken sentence for screen readers.
  - Each row shows only when its reading exists; the box disappears when none do.
- **Lenses** in the Highlight bar, which keeps its existing rules (ring, one tape, quiet non-matches, N / Shift+N, counts, announcements):
  - **Turns:** every scene with read charges, taped "Value − → +"; sky "holds at +" when the charge doesn't change.
  - **Clashes:** "Bergstrom vs Skinner".
  - **Who knows:** "Name +n in the dark", or "Audience in the dark".
- **Derivations** in `plan/story.ts`, with no request and no schema change:
  - `sceneTurn` (the charge wording moved from WhatTheSceneDoes);
  - `sceneClashes`;
  - `boardModel` now takes the ledger, so each card's `knowledgeModes` feeds Who knows.

## Rules kept

Plan only; Write stays quiet. No model call on hover, select or highlight. Readings are stated, never graded (holds is sky, not red; no scores). One tape per card. Non-matches are quiet, never dimmed. Existing tokens only: accent ink, sky, the secret palette, surface-sunken. Glyphs are never the only signal; turns are spoken as words. No text below 11px.

## Calls I made

- **What counts as a clash:**
  - Both characters have a want in the scene (each character's first want stands for them).
  - One's obstacle names the other as a whole word: the full name, an alias, or a capitalized name word that isn't a title or a possessive.
  - Or each acts on the other in the scene's beats.
  - Labelled "From their wants and beats", because it's a guess.
- **Turns matches every scene with charges.** The tape color separates holds from turns, so the count is the number of read scenes. I kept "every count means scenes that match" rather than counting only holds, which would read as a nag.
- **Who knows names the first character in the dark** in bible order. When a scene has both irony and a mystery, the tape shows the irony and the header shows both. Suspense (shared knowledge) isn't shown, because it's the common case.
- **Tape names are short:** the first word that isn't a title ("Mr. Bergstrom" becomes "Bergstrom"), because a tape is one truncated line.
- **Clash wants are stacked, not side by side:** at the panel's 400px width, side-by-side boxes cut each want to a few words.

## Ceilings

- **Clash detection:** it reads free text, so a nickname or pronoun the cast doesn't list is missed. If it misfires in practice, the upgrade is an import field naming the opponent, which is a prompt and schema change that needs sign-off.
- **Who knows is broad:** on a real import, 28 of 37 scenes have some present character in the dark. Naming who is in the dark is what makes the tapes useful.

## Not built (proposed, owner's call)

- A hover or focus peek on board cards.
- Hover-to-trace from a character, thread or secret to every scene it touches.
- A turn ribbon on the episode chart.
- A mini timeline for each fact's exposition.
- A kernel "spine" view.
- Lead arcs drawn on the chart.
