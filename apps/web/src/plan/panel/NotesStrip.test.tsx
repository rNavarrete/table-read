// @vitest-environment jsdom
import { act, cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ComponentProps } from 'react'
import type { Beat, ConsistencyFlag, LedgerFact, Scene } from 'contract'
import { ApiError } from '../../api/errors'
import { fixInstruction, notesForScene, type OrderNote } from '../story'
import { NotesStrip } from './NotesStrip'

afterEach(cleanup)

function beat(id: string, index: number): Beat {
  return {
    id,
    index,
    locked: false,
    whatHappens: '',
    audienceLearns: '',
    audienceFeels: '',
    scriptText: '',
    scriptLocked: false,
  }
}

function scene(id: string, index: number, beats: Beat[] = []): Scene {
  return {
    id,
    index,
    act: 3,
    storyline: 'A',
    locked: false,
    location: 'INT. THE LONG POUR - KITCHEN - NIGHT',
    time: 'Minutes later',
    socialSituation: '',
    whatHappens: '',
    audienceLearns: '',
    audienceFeels: '',
    motivations: [],
    beats,
  }
}

const SCENE_5 = scene('scene-5', 4, [beat('beat-5-1', 0)])
const SCENES = [scene('scene-2', 1), SCENE_5]

const FACT_02: LedgerFact = {
  id: 'fact-02',
  fact: "The stolen $40,000 is hidden inside the bar's basement ice machine",
  factType: 'state',
  sourceSpan: {
    episodeId: 'ep-1',
    sceneId: 'scene-2',
    beatId: 'beat-2-1',
    startLine: null,
    endLine: null,
    charStart: null,
    charEnd: null,
  },
  sourceText: '',
  knownBy: ['char-dan'],
  knowledgeEvents: [],
  audienceKnows: true,
  provenance: 'writer_confirmed',
  confidence: 0.94,
  status: 'active',
  supersedes: null,
  supersededBy: null,
  knownByAsOf: null,
}

function flag(
  id: string,
  overrides: Partial<ConsistencyFlag> = {},
): ConsistencyFlag {
  return {
    id,
    objectType: 'scene',
    objectId: 'scene-5',
    factId: null,
    explanation: '',
    severity: 'tension',
    status: 'open',
    sourceChange: 'snap-1',
    ...overrides,
  }
}

const FLAGS = [
  flag('flag-scene', {
    explanation:
      'Scene 2 moved the money, so the stakes here rest on fact-02, which is no longer true.',
    factId: 'fact-02',
  }),
  flag('flag-beat', {
    objectType: 'beat',
    objectId: 'beat-5-1',
    explanation: 'The cover story in this beat contradicts fact-zz9.',
  }),
  flag('flag-act', {
    explanation:
      'This scene plays like an act out, but the episode has no ACT THREE break before it.',
  }),
  flag('flag-import-beat', {
    objectType: 'beat',
    objectId: 'beat-5-1',
    explanation:
      '[model_unassigned] The model marked source lines 680-688 as unassigned; the server preserved them in this beat. Review the boundary.',
  }),
  flag('flag-import-scene', {
    explanation:
      '[extraction_failed] Fact extraction for this scene failed validation twice, so no continuity facts were recorded from it.',
  }),
]

// A computed Order note on scene 5: it pays off a thread set up in scene 4.
const ORDER_NOTE: OrderNote = {
  issue: {
    id: 'payoff_first:thread-key:scene-5',
    kind: 'payoff_first',
    sourceId: 'thread-key',
    label: 'The spare key',
    sceneId: 'scene-5',
    otherSceneId: 'scene-4',
  },
  otherSceneId: 'scene-4',
  otherNumber: 4,
  text: 'Pays off “The spare key” before its setup in scene 4.',
}

const DRAFT_FIX = { name: 'Draft a fix in Review…' }

function fixArea() {
  return screen.getByRole('textbox', {
    name: 'Fix instruction',
  }) as HTMLTextAreaElement
}

function renderStrip(
  overrides: Partial<ComponentProps<typeof NotesStrip>> = {},
) {
  const props = {
    scene: SCENE_5,
    notes: notesForScene(FLAGS, SCENE_5),
    scenes: SCENES,
    ledger: [FACT_02],
    busy: false,
    actLocked: false,
    locked: false,
    onSelectScene: vi.fn(),
    onShowBeat: vi.fn(),
    onOpenInWrite: vi.fn(),
    onOpenFact: vi.fn(),
    onDismiss: vi.fn(),
    onChangeAct: vi.fn(),
    ...overrides,
  }
  return { ...props, ...render(<NotesStrip {...props} />) }
}

describe('NotesStrip', () => {
  it('renders nothing when the scene has no notes', () => {
    const { container } = renderStrip({ notes: [] })
    expect(container.innerHTML).toBe('')
  })

  it('collapsed: counts story and import notes and peeks at the first story note, with no raw ids', () => {
    renderStrip()
    const strip = screen.getByTestId('notes-strip')
    expect(strip.id).toBe('plan-section-notes')
    expect(strip.getAttribute('data-plan-section')).toBe('notes')
    expect(
      within(strip).getByText('⚑ 3 notes · 2 from the import'),
    ).not.toBeNull()
    expect(screen.getByTestId('notes-peek').textContent).toBe(
      'Scene 2 moved the money, so the stakes here rest on a Ledger fact, which is no longer true.',
    )
    expect(strip.textContent).not.toContain('fact-02')
    expect(screen.queryByTestId('note-flag-scene')).toBeNull()
  })

  it('Show expands into note cards with linked scenes and facts and the quoted fact; Hide collapses', async () => {
    const user = userEvent.setup()
    const props = renderStrip()
    await user.click(screen.getByRole('button', { name: 'Show' }))

    const card = screen.getByTestId('note-flag-scene')
    await user.click(within(card).getByRole('button', { name: 'Scene 2' }))
    expect(props.onSelectScene).toHaveBeenCalledWith('scene-2')
    await user.click(
      within(card).getByRole('button', { name: 'a Ledger fact' }),
    )
    expect(props.onOpenFact).toHaveBeenCalledWith('fact-02')
    expect(within(card).getByText(FACT_02.fact)).not.toBeNull()
    await user.click(
      within(card).getByRole('button', { name: 'Open in Ledger →' }),
    )
    expect(props.onOpenFact).toHaveBeenCalledTimes(2)
    expect(card.textContent).not.toContain('fact-02')

    // A fact id the ledger doesn't have: plain words, no link, no raw id.
    const beatCard = screen.getByTestId('note-flag-beat')
    expect(beatCard.textContent).toContain('contradicts a Ledger fact.')
    expect(
      within(beatCard).queryByRole('button', { name: 'a Ledger fact' }),
    ).toBeNull()
    expect(beatCard.textContent).not.toContain('fact-zz9')

    await user.click(screen.getByRole('button', { name: 'Hide' }))
    expect(screen.queryByTestId('note-flag-scene')).toBeNull()
  })

  it('continuity notes: Show beat only on beat notes, Open in Write, Dismiss', async () => {
    const user = userEvent.setup()
    const props = renderStrip()
    await user.click(screen.getByRole('button', { name: 'Show' }))

    const sceneCard = screen.getByTestId('note-flag-scene')
    expect(
      within(sceneCard).queryByRole('button', { name: 'Show beat' }),
    ).toBeNull()
    await user.click(
      within(sceneCard).getByRole('button', { name: 'Open in Write' }),
    )
    expect(props.onOpenInWrite).toHaveBeenCalledWith(null)
    await user.click(within(sceneCard).getByRole('button', { name: 'Dismiss' }))
    expect(props.onDismiss).toHaveBeenCalledWith('flag-scene')

    const beatCard = screen.getByTestId('note-flag-beat')
    expect(within(beatCard).getByText('Beat 5.1')).not.toBeNull()
    await user.click(
      within(beatCard).getByRole('button', { name: 'Show beat' }),
    )
    expect(props.onShowBeat).toHaveBeenCalledWith('beat-5-1')
    await user.click(
      within(beatCard).getByRole('button', { name: 'Open in Write' }),
    )
    expect(props.onOpenInWrite).toHaveBeenLastCalledWith('beat-5-1')
  })

  it('act-split notes: Change the act and Looks right — dismiss', async () => {
    const user = userEvent.setup()
    const props = renderStrip()
    await user.click(screen.getByRole('button', { name: 'Show' }))

    const actCard = screen.getByTestId('note-flag-act')
    expect(
      within(actCard).queryByRole('button', { name: 'Dismiss' }),
    ).toBeNull()
    await user.click(
      within(actCard).getByRole('button', { name: 'Change the act' }),
    )
    expect(props.onChangeAct).toHaveBeenCalledOnce()
    await user.click(
      within(actCard).getByRole('button', { name: 'Looks right — dismiss' }),
    )
    expect(props.onDismiss).toHaveBeenCalledWith('flag-act')
  })

  it('import notes sit in a closed "From the import" group, in plain language', async () => {
    const user = userEvent.setup()
    const props = renderStrip()
    await user.click(screen.getByRole('button', { name: 'Show' }))

    const group = screen.getByTestId('notes-import-group') as HTMLDetailsElement
    expect(group.open).toBe(false)
    expect(screen.getByTestId('notes-strip').textContent).not.toMatch(
      /\[[a-z_]+\]/,
    )
    await user.click(within(group).getByText('From the import · 2'))
    expect(group.open).toBe(true)

    const beatNote = within(group).getByTestId('note-flag-import-beat')
    expect(beatNote.textContent).toContain(
      "The import couldn't place script lines 680–688 and kept them in beat 5.1.",
    )
    await user.click(
      within(beatNote).getByRole('button', { name: 'Open beat in Write' }),
    )
    expect(props.onOpenInWrite).toHaveBeenCalledWith('beat-5-1')

    const sceneNote = within(group).getByTestId('note-flag-import-scene')
    expect(sceneNote.textContent).toContain(
      "The import couldn't read continuity facts from this scene",
    )
    await user.click(
      within(sceneNote).getByRole('button', { name: 'Open in Write' }),
    )
    expect(props.onOpenInWrite).toHaveBeenLastCalledWith(null)
    await user.click(
      within(sceneNote).getByRole('button', { name: 'Looks right — dismiss' }),
    )
    expect(props.onDismiss).toHaveBeenCalledWith('flag-import-scene')
  })

  it('reads "n notes from the import" when there are only import notes', () => {
    renderStrip({
      notes: notesForScene(
        FLAGS.filter((f) => f.explanation.startsWith('[')),
        SCENE_5,
      ),
    })
    expect(screen.getByText('2 notes from the import')).not.toBeNull()
    expect(screen.queryByTestId('notes-peek')).toBeNull()
  })

  it('Dismiss is disabled while a write is in flight; Change the act while the act is locked', async () => {
    const user = userEvent.setup()
    renderStrip({ busy: true, actLocked: true })
    await user.click(screen.getByRole('button', { name: 'Show' }))
    for (const name of ['Dismiss', 'Looks right — dismiss']) {
      for (const button of screen.getAllByRole('button', { name })) {
        expect((button as HTMLButtonElement).disabled).toBe(true)
      }
    }
    expect(
      (
        screen.getByRole('button', {
          name: 'Change the act',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true)
  })
  it('a scene with only an Order note shows the strip, counts it and peeks at it', () => {
    renderStrip({ notes: [], orderNotes: [ORDER_NOTE] })
    expect(
      within(screen.getByTestId('notes-strip')).getByText('⚑ 1 note'),
    ).not.toBeNull()
    expect(screen.getByTestId('notes-peek').textContent).toBe(ORDER_NOTE.text)
  })

  it('an Order note comes first, says it is computed, and has no Dismiss', async () => {
    const user = userEvent.setup()
    renderStrip({ orderNotes: [ORDER_NOTE] })
    expect(screen.getByText('⚑ 4 notes · 2 from the import')).not.toBeNull()
    expect(screen.getByTestId('notes-peek').textContent).toBe(ORDER_NOTE.text)
    await user.click(screen.getByRole('button', { name: 'Show' }))

    const card = screen.getByTestId(`order-note-${ORDER_NOTE.issue.id}`)
    expect(screen.getByTestId('notes-strip').querySelector('article')).toBe(
      card,
    )
    expect(within(card).getByText('Order')).not.toBeNull()
    expect(card.textContent).toContain(
      'from the board order · clears when fixed',
    )
    expect(card.textContent).toContain(ORDER_NOTE.text)
    expect(within(card).queryByRole('button', { name: /dismiss/i })).toBeNull()
  })

  it('Go to scene n selects the other scene', async () => {
    const user = userEvent.setup()
    const props = renderStrip({ orderNotes: [ORDER_NOTE] })
    await user.click(screen.getByRole('button', { name: 'Show' }))
    await user.click(screen.getByRole('button', { name: 'Go to scene 4' }))
    expect(props.onSelectScene).toHaveBeenCalledWith('scene-4')
  })

  it('Undo the move only on an undoable note, disabled while busy', async () => {
    const user = userEvent.setup()
    const onUndoMove = vi.fn()
    renderStrip({ orderNotes: [ORDER_NOTE], onUndoMove, freshKey: 'issue-1' })
    expect(screen.queryByRole('button', { name: 'Undo the move' })).toBeNull()
    cleanup()

    renderStrip({
      orderNotes: [ORDER_NOTE],
      undoableIssueIds: new Set([ORDER_NOTE.issue.id]),
      onUndoMove,
      freshKey: 'issue-1',
    })
    await user.click(screen.getByRole('button', { name: 'Undo the move' }))
    expect(onUndoMove).toHaveBeenCalledOnce()
    cleanup()

    renderStrip({
      orderNotes: [ORDER_NOTE],
      undoableIssueIds: new Set([ORDER_NOTE.issue.id]),
      onUndoMove,
      freshKey: 'issue-1',
      busy: true,
    })
    expect(
      (
        screen.getByRole('button', {
          name: 'Undo the move',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true)
  })

  it('a fresh order problem (freshKey) starts the strip open', () => {
    renderStrip({ orderNotes: [ORDER_NOTE], freshKey: 'issue-1' })
    expect(
      screen
        .getByRole('button', { name: 'Hide' })
        .getAttribute('aria-expanded'),
    ).toBe('true')
    expect(
      screen.getByTestId(`order-note-${ORDER_NOTE.issue.id}`),
    ).not.toBeNull()
    expect(screen.queryByTestId('notes-peek')).toBeNull()
  })

  it('a new freshKey opens a collapsed strip again without remounting it: an open fix editor keeps its text', async () => {
    const user = userEvent.setup()
    const { rerender, ...props } = renderStrip({
      onDraftFix: vi.fn(() => Promise.resolve()),
      orderNotes: [ORDER_NOTE],
      freshKey: 'issue-1',
    })
    await user.click(
      within(screen.getByTestId('note-flag-scene')).getByRole(
        'button',
        DRAFT_FIX,
      ),
    )
    await user.type(fixArea(), ' Keep the fight.')
    const typed = fixArea().value

    rerender(<NotesStrip {...props} freshKey="" />)
    expect(fixArea().value).toBe(typed)
    await user.click(screen.getByRole('button', { name: 'Hide' }))
    rerender(<NotesStrip {...props} freshKey="issue-2" />)
    expect(
      screen
        .getByRole('button', { name: 'Hide' })
        .getAttribute('aria-expanded'),
    ).toBe('true')
    expect(fixArea().value).toBe(typed)
  })

  // ── Draft a fix in Review… (T3.9) ──

  it('Draft a fix in Review… only on continuity notes: not on act-split, import or Order notes', async () => {
    const user = userEvent.setup()
    renderStrip({
      onDraftFix: vi.fn(() => Promise.resolve()),
      orderNotes: [ORDER_NOTE],
    })
    await user.click(screen.getByRole('button', { name: 'Show' }))
    await user.click(screen.getByText('From the import · 2'))

    for (const id of ['note-flag-scene', 'note-flag-beat']) {
      expect(
        within(screen.getByTestId(id)).queryByRole('button', DRAFT_FIX),
      ).not.toBeNull()
    }
    for (const id of [
      'note-flag-act',
      'notes-import-group',
      `order-note-${ORDER_NOTE.issue.id}`,
    ]) {
      expect(
        within(screen.getByTestId(id)).queryByRole('button', DRAFT_FIX),
      ).toBeNull()
    }
    expect(screen.getAllByRole('button', DRAFT_FIX)).toHaveLength(2)
    cleanup()

    renderStrip({ orderNotes: [ORDER_NOTE], freshKey: 'issue-1' })
    expect(screen.queryByRole('button', DRAFT_FIX)).toBeNull()
  })

  it('hidden while locked; an open editor goes when the scene locks and comes back with its text', async () => {
    const user = userEvent.setup()
    const { rerender, ...props } = renderStrip({
      onDraftFix: vi.fn(() => Promise.resolve()),
      freshKey: 'issue-1',
      locked: true,
    })
    expect(screen.queryByRole('button', DRAFT_FIX)).toBeNull()

    rerender(<NotesStrip {...props} locked={false} />)
    await user.click(
      within(screen.getByTestId('note-flag-scene')).getByRole(
        'button',
        DRAFT_FIX,
      ),
    )
    const area = fixArea()
    await user.type(area, ' Keep the fight.')
    const typed = area.value
    expect(typed).toMatch(/ Keep the fight\.$/)

    // The writer is on the Lock switch (outside the strip): unlocking
    // brings the editor back without taking focus.
    const elsewhere = screen.getByRole('button', { name: 'Hide' })
    act(() => elsewhere.focus())
    rerender(<NotesStrip {...props} locked />)
    expect(screen.queryByTestId('fix-editor')).toBeNull()
    expect(screen.queryByRole('button', DRAFT_FIX)).toBeNull()

    rerender(<NotesStrip {...props} locked={false} />)
    expect(screen.getByTestId('fix-editor')).not.toBeNull()
    expect(fixArea().value).toBe(typed)
    expect(document.activeElement).toBe(elsewhere)
  })

  it('opening the editor sends nothing; it is prefilled in words with the explainer', async () => {
    const user = userEvent.setup()
    const onDraftFix = vi.fn(() => Promise.resolve())
    const props = renderStrip({ onDraftFix, freshKey: 'issue-1' })
    const card = screen.getByTestId('note-flag-scene')
    const verb = within(card).getByRole('button', DRAFT_FIX)
    expect(verb.getAttribute('aria-expanded')).toBe('false')

    await user.click(verb)
    expect(onDraftFix).not.toHaveBeenCalled()
    expect(within(card).getByTestId('fix-editor')).not.toBeNull()
    const area = fixArea()
    expect(document.activeElement).toBe(area)
    expect(area.value).toBe(
      fixInstruction(props.notes[0], SCENE_5, SCENES, [FACT_02]),
    )
    expect(area.value).not.toMatch(/scene-|fact-|\[/)
    const explainer = document.getElementById(
      area.getAttribute('aria-describedby') ?? '',
    )
    expect(explainer?.textContent).toBe(
      'Nothing changes until you apply it in Review. Locked scenes are never changed.',
    )
    expect(verb.getAttribute('aria-expanded')).toBe('true')
  })

  it('Open Review sends the edited, trimmed text; it reads Opening… and waits; Cancel closes and refocuses the verb', async () => {
    const user = userEvent.setup()
    let resolve = () => {}
    const onDraftFix = vi.fn(
      () =>
        new Promise<void>((done) => {
          resolve = done
        }),
    )
    renderStrip({ onDraftFix, freshKey: 'issue-1' })
    const verb = within(screen.getByTestId('note-flag-scene')).getByRole(
      'button',
      DRAFT_FIX,
    )
    await user.click(verb)
    const editor = screen.getByTestId('fix-editor')
    const open = within(editor).getByRole('button', {
      name: 'Open Review',
    }) as HTMLButtonElement
    const cancel = within(editor).getByRole('button', {
      name: 'Cancel',
    }) as HTMLButtonElement

    await user.clear(fixArea())
    expect(open.disabled).toBe(true)
    await user.type(fixArea(), '  Move the money talk to the marina.  ')
    await user.click(open)
    expect(onDraftFix).toHaveBeenCalledOnce()
    expect(onDraftFix).toHaveBeenCalledWith(
      'Move the money talk to the marina.',
    )
    expect(open.textContent).toBe('Opening…')
    expect(open.disabled).toBe(true)
    expect(cancel.disabled).toBe(true)

    await act(async () => resolve())
    expect(open.textContent).toBe('Open Review')
    expect(open.disabled).toBe(false)
    // Stay in Plan: focus back in the box, not on <body>.
    expect(document.activeElement).toBe(fixArea())

    await user.click(cancel)
    expect(screen.queryByTestId('fix-editor')).toBeNull()
    expect(document.activeElement).toBe(verb)
  })

  it.each([
    [
      new ApiError(502, {
        code: 'SCHEMA_INVALID_LLM',
        message:
          'classify_blast_radius: LLM output failed schema validation twice',
      }),
      "Review couldn't plan this fix (the AI's answer came back malformed twice). Nothing changed; try again.",
    ],
    [
      new ApiError(503, { code: 'LLM_UNAVAILABLE', message: 'upstream 529' }),
      'The AI service is unavailable right now. Nothing changed.',
    ],
    [
      new ApiError(502, {
        code: 'INTERNAL',
        message: 'request failed with status 502',
      }),
      "Couldn't open Review. Nothing changed; try again.",
    ],
  ])(
    'a failed send shows writer copy for its code, never the server message (%#)',
    async (err, copy) => {
      const user = userEvent.setup()
      renderStrip({
        onDraftFix: vi.fn(() => Promise.reject(err)),
        freshKey: 'issue-1',
      })
      await user.click(
        within(screen.getByTestId('note-flag-scene')).getByRole(
          'button',
          DRAFT_FIX,
        ),
      )
      await user.click(screen.getByRole('button', { name: 'Open Review' }))
      expect((await screen.findByRole('alert')).textContent).toBe(copy)
    },
  )

  it('a failed send shows the error inline, keeps the edited text and focuses it', async () => {
    const user = userEvent.setup()
    renderStrip({
      onDraftFix: vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))),
      freshKey: 'issue-1',
    })
    await user.click(
      within(screen.getByTestId('note-flag-scene')).getByRole(
        'button',
        DRAFT_FIX,
      ),
    )
    await user.type(fixArea(), ' Keep the fight.')
    const edited = fixArea().value
    const open = screen.getByRole('button', {
      name: 'Open Review',
    }) as HTMLButtonElement
    await user.click(open)

    expect((await screen.findByRole('alert')).textContent).toBe(
      "Couldn't open Review. Nothing changed; try again.",
    )
    expect(fixArea().value).toBe(edited)
    expect(document.activeElement).toBe(fixArea())
    expect(open.disabled).toBe(false)
  })

  it('the verb is disabled while a write is in flight', () => {
    renderStrip({
      onDraftFix: vi.fn(() => Promise.resolve()),
      freshKey: 'issue-1',
      busy: true,
    })
    const verbs = screen.getAllByRole('button', DRAFT_FIX)
    expect(verbs).toHaveLength(2)
    for (const verb of verbs) {
      expect((verb as HTMLButtonElement).disabled).toBe(true)
    }
  })
})
