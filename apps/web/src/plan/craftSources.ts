// Craft notes (spec 2026-10-20-craft-notes-design): the two checks the
// server's `review_craft` op files, and the reviewed "Read more" sources.
// Defined here, not from the contract: the web never parses a CraftReview,
// only the `[craft_<check>]` code on a ConsistencyFlag (story.craftNote).

export type CraftCheck = 'theme_stated' | 'on_the_nose'

export const CRAFT_LABELS: Record<CraftCheck, string> = {
  theme_stated: 'Says the theme out loud',
  on_the_nose: "Says what they're doing",
}

export interface CraftSource {
  title: string
  by: string
  url: string
  /** One line in our own words; never a quote over 15 words. */
  gist: string
}

/** Vetted 2026-10-20: each page was opened and read, and its gist matches
 * it. The model never produces links. A check with no vetted source shows no
 * "Read more". */
export const CRAFT_SOURCES: Record<CraftCheck, CraftSource[]> = {
  on_the_nose: [
    {
      title: "Guillermo del Toro's advice for young filmmakers",
      by: 'Guillermo del Toro (BFI)',
      url: 'https://www.bfi.org.uk/features/guillermo-del-toros-advice-young-filmmakers-stay-untamed-irrational-stubborn',
      gist: "del Toro on letting what's unsaid carry the scene",
    },
    {
      title: 'A letter to the writers of The Unit',
      by: 'David Mamet (/Film)',
      url: 'https://www.slashfilm.com/a-letter-from-david-mamet-to-the-writers-of-the-unit/',
      gist: 'Mamet: show it through what the characters do',
    },
  ],
  theme_stated: [],
}
