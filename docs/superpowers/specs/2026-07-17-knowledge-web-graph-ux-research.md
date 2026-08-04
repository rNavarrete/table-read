# Knowledge Web graph UX research

**Date:** 2026-07-17  
**Status:** research note — hybrid recommendation implemented on main (2026-07-17)  
**Scope:** Table Read Ledger → Knowledge Web (`KnowledgeWeb.tsx`, `knowledgeGraph.ts`, UI spec §7e)  
**Non-goals:** no code changes in this note; no new graph libraries; no contract/schema changes.

Companion canvas (visual summary): open beside chat at  
`~/.cursor/projects/Users-rolandonavarrete-Documents-tableread-worktrees-import-coverage-cost/canvases/knowledge-web-ux-research.canvas.tsx`

---

## 1. Diagnosis — why the current layout fails

The Web fans up to **24 full fact cards** (168×72px) onto a **~109° arc** at radius **~248px** with only a **36px alternate-ring stagger** (`layoutFactArc` in `knowledgeGraph.ts`). Chord spacing between centers is on the order of **~20px** when dense — far below card height — so cards stack into an unreadable fan: only edges or a single selected card stay legible. Mini-edges between facts add further ink without clarifying who-knows-what.

This is a geometry problem, not a styling polish problem. Radial hub-and-spoke is fine for **small markers**; it fails when every node is a **dense text card**.

---

## 2. Patterns that work in real products / literature

| #   | Pattern                                                       | Who uses it / source                                                                                                                                                                                                                                                                                                                                                                                           | Problem it solves                                                                                                   |
| --- | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| A   | **Local / neighborhood graph**                                | Obsidian Local Graph (depth 1–2); community consensus that global graphs past ~50–200 notes become ornamental ([Dan Holloran](https://danholloran.me/posts/making-obsidians-graph-view-actually-useful); [Code Culture](https://codeculture.store/blogs/developer-culture/obsidian-graph-view-useful); [Obsidian forum “graph sculpting”](https://forum.obsidian.md/t/design-talk-about-the-graph-view/22594)) | Scale: show the focus’s neighborhood, not the whole vault                                                           |
| B   | **Degree of interest (DOI) / focus+context**                  | Furnas generalized fisheye; Cockburn et al. survey of overview+detail / zoom / F+C ([Georgia Tech PDF](https://faculty.cc.gatech.edu/~stasko/7450/Papers/cockburn-surveys08.pdf)); iSphere CHI’17 ([paper](http://fandu.org/papers/du2017chi-2.pdf))                                                                                                                                                           | Decide _what_ stays detailed vs faded/hidden by distance from focus                                                 |
| C   | **Selective expand + dismiss**                                | Neo4j Bloom: expand neighbors with node-query limits, dismiss orphans, filter greys-out then dismiss ([Bloom scene interactions](https://neo4j.com/docs/bloom-user-guide/current/bloom-visual-tour/bloom-scene-interactions/)); Slicer for property ranges ([Neo4j blog](https://medium.com/neo4j/slice-and-dice-your-graph-data-with-neo4j-bloom-f8cc0bb62908))                                               | Start sparse; grow on demand; never dump the full result set as readable cards                                      |
| D   | **Entity panel / progressive disclosure**                     | Google Knowledge Panels: entity summary + expandable sections, not a full KG canvas ([Search Engine Roundtable expandable panels](https://www.seroundtable.com/google-knowledge-panels-expandable-38271.html))                                                                                                                                                                                                 | “What should I know about X?” is answered by structured lists, not hairball edges                                   |
| E   | **Spatial sections, not edge hairballs**                      | Heptabase: Card Library + whiteboard sections / nested boards; links optional ([Heptabase wiki — fundamentals](https://wiki.heptabase.com/fundamental-elements); [organize knowledge](https://wiki.heptabase.com/organize-knowledge-and-projects))                                                                                                                                                             | Writers scan _groups of meaning_ (type, scene, secret vs public) without needing every edge drawn                   |
| F   | **Collision-aware radial / multi-ring (when keeping radial)** | ELK Radial overlap-removal (widen radii until clear) ([ELK docs](https://eclipse.dev/elk/reference/algorithms/org-eclipse-elk-radial.html)); yFiles radial labeling ([yFiles radial](https://www.yfiles.com/the-yfiles-sdk/features/automatic-layouts/radial-layout)); ArcGIS radial tree radius factor                                                                                                        | Radial can work if nodes are small _or_ rings expand until boxes don’t intersect — never fixed radius + large cards |

**Less relevant for Table Read (noted, not recommended as primary):**

- **Miro / FigJam:** freeform spatial boards — great for human arrangement, wrong for auto-laid-out “who knows what” at 700+ facts.
- **Roam / Logseq / Notion:** graphs are secondary; value is backlinks + outlines (list+detail), which Table Read already owns via Story Atlas.
- **LinkedIn Economic Graph:** powerful _data_ graph; product UIs surface paths/insights as lists and recommendations, not end-user force-directed canvases ([LinkedIn engineering — conversation suggestions](https://www.linkedin.com/blog/engineering/graph-systems/scaling-contextual-conversation-suggestions-over-linkedins-graph)).

---

## 3. Fit to Table Read constraints

| Constraint                                 | Implication                                                                                                                             |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| Who-knows-what, character / Audience focus | Focus is a **person (or audience)**, facts are **attributes of knowledge** — bipartite, not a social “everyone connected” graph         |
| ~708 facts possible; **max ~24 visible**   | Cap is already correct; the bug is **representation density** of those 24                                                               |
| As-of filtering                            | Prefer list rows that stay legible under filter changes; avoid layouts that reshuffle into new overlap                                  |
| Quiet Tool, `--tr-*`, no new deps          | Prefer CSS/SVG hybrid; no d3/force/physics; no fisheye distortion theater                                                               |
| Atlas already exists                       | Web must earn its keep by answering **focus-centric questions** Atlas doesn’t: “What does Marta know?” / “What does the audience know?” |

Original dual-view design (2026-07-15) already allowed a **vertical/arc column, scrollable if many** — the shipping radial card fan is stricter than that approved escape hatch.

---

## 4. Ranked recommendations (Table Read–specific)

### R1 — **Recommended: hybrid focus strip + ranked fact list/detail** (primary direction)

```
┌ People chips / focus ─────────────────────────────┐
│  [Audience]  Marta  Diego  …                      │
├──────────────┬────────────────────────────────────┤
│ Small graph  │  Ranked fact rows (scrollable)     │
│ of people    │  type · 2-line fact · scene · …    │
│ (optional)   │  selected → FactCard detail        │
│ OR type/     │                                    │
│ scene cluster│  +N more → Atlas                   │
│ chips        │                                    │
└──────────────┴────────────────────────────────────┘
```

- **Left / top:** focus affordance (People filter already exists) + optional **tiny** person-to-person or cluster overview (dots / initials, not fact cards).
- **Main:** ranked, scannable fact **rows** for the focus (same ranking as today: knowledge/relationship first), capped at ~24 with overflow to Atlas.
- **Detail:** keep existing `FactCard` side/sheet panel on selection.
- **Edges:** drop default fact–fact mini-edges; if kept, show only on hover/selected (Bloom-style foreground).

**Why this wins:** matches the product question, stays Quiet Tool, needs no library, scales with as-of filters, and reuses Atlas row patterns so Web isn’t a second incomplete FactCard surface.

**Confidence:** high (~0.85) — aligns with Google entity panels, Bloom expand/limit, Obsidian local-graph discipline, and the dual-view design’s “scrollable column” note.

### R2 — Semantic zoom radial (fallback if we must keep a “web” look)

- Default: **small markers** (type cue + truncated label, ~24×24–40×40) on **2–3 collision-aware rings**.
- Selected / hovered: expand to card or open detail panel.
- Widen radius until axis-aligned boxes don’t intersect (ELK-style), or reduce visible count until they don’t (hard cap by geometry, not only 24).

**Confidence:** medium (~0.6) — prettier, more layout code, still fights Quiet Tool if cards stay the default glyph.

### R3 — Clustered sections (Heptabase-lite)

Group visible facts under **type or scene** section frames around a focus label; no spokes. Good secondary organization _inside_ the R1 list; weak as the only spatial metaphor.

### R4 — Force-directed / fisheye / honeycomb / treemap

Defer indefinitely. Physics needs a library or janky DIY; fisheye distorts reading of text; treemap answers “share of category” not “who knows what.”

---

## 5. Anti-patterns to avoid

1. **Full-size text cards as default radial nodes** at N≥12 on a fixed arc.
2. **Hairball mini-edges** among all visible facts (shared-knower complete graph) as chrome, not interaction.
3. **Global vault graph** aesthetics (Obsidian global) — writers audit focus knowledge, not ledger topology.
4. **Fisheye / hyperbolic distortion** for prose cards — path-tracing and text reading suffer (iSphere itself notes hyperbolic link distortion issues).
5. **New graph dependency** for MVP polish — dual-view design already forbade it.
6. **Making Web a second Atlas** with only different chrome — if the answer is a list, own the focus affordances (people, audience, clusters) instead of fake nodes.
7. **Spacing-only tweaks** (nudge stagger from 36→48) as “the fix” — they cannot clear 168×72 cards on a ~470px arc.

---

## 6. Keep radial at all? Hybrid answer

| Keep                                                           | Drop                                                         |
| -------------------------------------------------------------- | ------------------------------------------------------------ |
| Focus metaphor (person / Audience as hub)                      | Radial **placement of full FactCards** as the default layout |
| Optional small hub→dot spokes for “these are about this focus” | Fact–fact edge clutter by default                            |
| Quiet Tool spatial wash / soft canvas                          | Force / physics / library layouts                            |

**Verdict:** keep a **light radial or hub metaphor for people/focus**, not for fact bodies. Facts belong in a **readable list + detail** (hybrid). Radial returns only if nodes shrink to markers with collision-aware rings (R2).

---

## 7. Suggested implementation next (out of scope here)

1. Spec amend §7e: replace “dense fact nodes on radial/arc” with hybrid layout description.
2. Refactor `layoutFactNodes` → list ranking + optional marker layout; keep `buildKnowledgeGraph` ranking/cap.
3. UI: focus strip + scrollable rows + existing detail panel; hide related edges unless selected.
4. Tests: no overlap assertion for default view; keyboard path preserved; Audience / character focus unchanged.
5. Optional follow-up: marker-mode toggle (“Web dots”) behind a Quiet control if writers miss the spatial feel.

---

## 8. Sources (confidence)

| Source                                            | Role                                 | Confidence                         |
| ------------------------------------------------- | ------------------------------------ | ---------------------------------- |
| Current code: `layoutFactArc` / `NODE_W`/`NODE_H` | Geometry diagnosis                   | High (measured from repo)          |
| UI spec §7e + dual-view design 2026-07-15         | Product intent                       | High                               |
| Obsidian local vs global graph commentary         | Pattern A                            | Medium–high (product UX consensus) |
| Furnas DOI / Cockburn F+C survey                  | Pattern B                            | High (canonical HCI)               |
| Neo4j Bloom docs + Slicer                         | Pattern C                            | High (vendor docs)                 |
| Google Knowledge Panels (SER reports)             | Pattern D                            | Medium (secondary reporting)       |
| Heptabase public wiki                             | Pattern E                            | Medium–high                        |
| ELK / yFiles radial docs                          | Pattern F                            | High (algorithm docs)              |
| LinkedIn Economic Graph eng posts                 | Negative example for end-user canvas | Medium                             |

**Overall recommendation confidence:** **high** that hybrid list+detail with a small focus graph beats dense radial cards for Table Read’s who-knows-what job.
