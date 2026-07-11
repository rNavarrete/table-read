// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createProject } from './client'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('createProject', () => {
  it('sends the idempotency key header with the project body', async () => {
    const fetchSpy = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            id: 'proj-1',
            title: 'Test Show',
            format: {
              genre: 'drama',
              runtimeMinutes: 60,
              actCount: 5,
              coldOpen: true,
              tag: true,
              serialization: 0.7,
            },
            enabledComponents: [],
            premise: 'A premise.',
            seriesBible: {
              existentialQuestion: { text: '', locked: false },
              worldRules: [],
              storiesToAvoid: [],
              characters: [],
              relationships: [],
              audienceGoals: [],
              narratorGoals: [],
              worldQA: [],
            },
            seasons: [],
            headSnapshotId: 'snap-1',
          }),
          { status: 201, headers: { 'Content-Type': 'application/json' } },
        ),
    )
    vi.stubGlobal('fetch', fetchSpy)

    await createProject(
      {
        title: 'Test Show',
        premise: 'A premise.',
        format: {
          genre: 'drama',
          runtimeMinutes: 60,
          actCount: 5,
          coldOpen: true,
          tag: true,
          serialization: 0.7,
        },
      },
      { idempotencyKey: '00000000-0000-4000-8000-000000000010' },
    )

    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/v1/projects',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          'Idempotency-Key': '00000000-0000-4000-8000-000000000010',
        }),
      }),
    )
  })
})
