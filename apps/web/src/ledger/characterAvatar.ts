/**
 * Stable per-character avatar colors / initials for Ledger.
 *
 * Preferred hue comes from the handoff hash; assignment then walks hue slots
 * so castmates don't share a tint. Initials prefer first+last, then a
 * disambiguation ladder when two names would collide.
 */

export interface CharacterAvatar {
  initials: string
  /** Avatar background — oklch string */
  tint: string
  /** Avatar text — oklch string */
  ink: string
  hue: number
}

/** 24 slots × 15° — enough for a typical episode cast without near-duplicates. */
const HUE_SLOTS = 24
const SLOT_DEG = 360 / HUE_SLOTS

export function hueForName(name: string): number {
  let hue = 0
  for (let i = 0; i < name.length; i++) {
    hue = (hue * 31 + name.charCodeAt(i)) % 360
  }
  return hue
}

function nameParts(name: string): string[] {
  return name
    .replace(/[^A-Za-z. ]/g, '')
    .split(/[ .]+/)
    .filter(Boolean)
}

/** Preferred initials (no collision pass): first+last parts, else first two letters. */
export function initialsForName(name: string): string {
  const candidates = initialsCandidates(name)
  return candidates[0] ?? '??'
}

/** Ordered candidates for disambiguation. */
export function initialsCandidates(name: string): string[] {
  const parts = nameParts(name)
  const out: string[] = []
  if (parts.length >= 2) {
    const first = parts[0]!
    const last = parts[parts.length - 1]!
    out.push((first[0]! + last[0]!).toUpperCase())
    if (parts[1] && parts[1] !== last) {
      out.push((first[0]! + parts[1][0]!).toUpperCase())
    }
    if (last.length >= 2) {
      out.push((first[0]! + last[1]!).toUpperCase())
    }
  }
  const word = parts[0] ?? ''
  if (word.length >= 2) out.push(word.slice(0, 2).toUpperCase())
  if (word.length >= 3) out.push((word[0]! + word[2]!).toUpperCase())
  if (word.length >= 3) out.push(word.slice(0, 3).toUpperCase())
  if (word.length >= 4) out.push((word[0]! + word[3]!).toUpperCase())
  // Deduplicate while preserving order.
  return [...new Set(out.filter((s) => s.length >= 2))]
}

function preferredSlot(name: string): number {
  return Math.floor(hueForName(name) / SLOT_DEG) % HUE_SLOTS
}

function hueFromSlot(slot: number): number {
  return Math.round(slot * SLOT_DEG + SLOT_DEG / 2) % 360
}

function avatarFrom(hue: number, initials: string): CharacterAvatar {
  return {
    initials,
    tint: `oklch(0.93 0.045 ${hue})`,
    ink: `oklch(0.44 0.11 ${hue})`,
    hue,
  }
}

/** Single-name avatar without roster context (Audience, isolated previews). */
export function characterAvatar(name: string): CharacterAvatar {
  return avatarFrom(hueForName(name), initialsForName(name))
}

/**
 * Assign distinct hues + initials across a cast list. Order is the claim
 * order (earlier names keep their preferred slot/initials when possible).
 * Same input order ⇒ same map — call with `seriesBible.characters` order
 * from both the CAST rail and Atlas cards.
 */
export function assignCharacterAvatars(
  names: readonly string[],
): Map<string, CharacterAvatar> {
  const usedSlots = new Set<number>()
  const usedInitials = new Set<string>()
  const result = new Map<string, CharacterAvatar>()

  for (const name of names) {
    if (result.has(name)) continue

    let slot = preferredSlot(name)
    for (let i = 0; i < HUE_SLOTS; i++) {
      const candidate = (preferredSlot(name) + i) % HUE_SLOTS
      if (!usedSlots.has(candidate)) {
        slot = candidate
        break
      }
    }
    usedSlots.add(slot)

    let initials = '??'
    for (const candidate of initialsCandidates(name)) {
      if (!usedInitials.has(candidate)) {
        initials = candidate
        break
      }
    }
    // Last resort: append a digit-like letter from the hash so we never collide.
    if (usedInitials.has(initials) || initials === '??') {
      const base = (initialsCandidates(name)[0] ?? 'X').slice(0, 2)
      for (let n = 0; n < 26; n++) {
        const letter = String.fromCharCode(65 + ((hueForName(name) + n) % 26))
        const trial = (base[0]! + letter).toUpperCase()
        if (!usedInitials.has(trial)) {
          initials = trial
          break
        }
      }
    }
    usedInitials.add(initials)

    result.set(name, avatarFrom(hueFromSlot(slot), initials))
  }

  return result
}
