// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { checkStructure, createProject, extractPdf } from './client'

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

describe('extractPdf', () => {
  it('posts the PDF as multipart form data', async () => {
    const fetchSpy = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({
            text: 'INT. BAR - NIGHT\nA scene.',
            method: 'text_layer',
            pageCount: 4,
            warnings: [],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
    )
    vi.stubGlobal('fetch', fetchSpy)
    const file = new File(['%PDF-1.4'], 'pilot.pdf', {
      type: 'application/pdf',
    })

    const result = await extractPdf(file)

    expect(result).toEqual({
      text: 'INT. BAR - NIGHT\nA scene.',
      method: 'text_layer',
      pageCount: 4,
      warnings: [],
    })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [url, init] = fetchSpy.mock.calls[0]
    expect(url).toBe('/api/v1/projects/import/extract-pdf')
    expect(init).toMatchObject({ method: 'POST' })
    expect(init?.headers).toBeUndefined()
    expect(init?.body).toBeInstanceOf(FormData)
    expect((init?.body as FormData).get('file')).toBe(file)
  })
})

describe('checkStructure', () => {
  it('posts an empty body to the lens path with If-Match', async () => {
    const fetchSpy = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({ id: 'proj-1', headSnapshotId: 'snap-2' }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
    )
    vi.stubGlobal('fetch', fetchSpy)

    await checkStructure('proj-1', 'story_circle', {
      expectedHeadSnapshotId: 'snap-1',
    })

    const [url, init] = fetchSpy.mock.calls[0]
    expect(url).toBe('/api/v1/projects/proj-1/structure-checks/story_circle')
    expect(init).toMatchObject({
      method: 'POST',
      body: '{}',
      headers: expect.objectContaining({ 'If-Match': 'snap-1' }),
    })
  })
})
