import { useEffect, useState } from 'react'
import type {
  Project,
  Scene,
  StructureLens,
  StructureStageStatus,
} from 'contract'
import { Chip, type ChipHue } from '../../plan/Chip'
import { structureSourceHash } from './sourceHash'
import {
  STAGE_LABELS,
  STAGE_ORDER,
  STRUCTURE_PICKS,
  type StructurePick,
} from './stages'
import { StructureStrip } from './StructureStrip'
import { tvActStages } from './tvActStructure'

type Props = {
  project: Project
  busy: boolean
  error: string | null
  onCheck: (lens: StructureLens) => void
  onOpenBeat: (sceneId: string, beatId: string) => void
  hashScenes?: (scenes: Scene[]) => Promise<string> // defaults to structureSourceHash; tests inject
}

type Row = {
  key: string
  label: string
  status: StructureStageStatus
  beatId: string | null
  sceneId: string | null
  reason: string
  quote: string | null
}

const STATUS: Record<StructureStageStatus, { label: string; hue: ChipHue }> = {
  hit: { label: 'Hit', hue: 'sage' },
  thin: { label: 'Thin', hue: 'amber' },
  missing: { label: 'Missing', hue: 'neutral' },
  unverified: { label: "Couldn't verify", hue: 'sky' },
}

const NO_SCENES: Scene[] = []
const pickKey = (projectId: string) => `tr.ledger.structure.${projectId}`

function loadPick(projectId: string): StructurePick {
  try {
    const raw = window.localStorage.getItem(pickKey(projectId))
    const known = STRUCTURE_PICKS.find((option) => option.value === raw)
    if (known) return known.value
  } catch {
    // Blocked storage: fall back to the default pick.
  }
  return 'tv_act_structure'
}

function savePick(projectId: string, pick: StructurePick): void {
  try {
    window.localStorage.setItem(pickKey(projectId), pick)
  } catch {
    // Blocked storage: the pick still holds for this visit.
  }
}

function summaryLine(rows: Row[], ai: boolean): string {
  const count = (status: StructureStageStatus) =>
    rows.filter((row) => row.status === status).length
  const parts = [`${count('hit')} of ${rows.length} stages hit`]
  if (ai) parts.push(`${count('thin')} thin`)
  parts.push(`${count('missing')} missing`)
  if (count('unverified') > 0)
    parts.push(`${count('unverified')} couldn't verify`)
  return parts.join(' · ')
}

function StageRow({
  row,
  onOpenBeat,
}: {
  row: Row
  onOpenBeat: (sceneId: string, beatId: string) => void
}) {
  const status = STATUS[row.status]
  const content = (
    <>
      <span className="flex items-start justify-between gap-3">
        <span className="text-13 font-medium text-tr-text-primary">
          {row.label}
        </span>
        <Chip hue={status.hue} className="shrink-0">
          {status.label}
        </Chip>
      </span>
      {row.reason ? (
        <span className="mt-1 block text-13 text-tr-text-secondary">
          {row.reason}
        </span>
      ) : null}
      {row.quote ? (
        <span className="mt-1 block text-12 italic text-tr-text-muted">
          &quot;{row.quote}&quot;
        </span>
      ) : null}
    </>
  )
  const testId = `structure-row-${row.key}`
  const { sceneId, beatId } = row
  if (!sceneId || !beatId) {
    return (
      <div className="px-1 py-3" data-testid={testId}>
        {content}
      </div>
    )
  }
  return (
    <button
      type="button"
      title="Open this beat in Write"
      onClick={() => onOpenBeat(sceneId, beatId)}
      className="block w-full px-1 py-3 text-left transition-colors duration-standard ease-standard hover:bg-tr-surface-clay focus-visible:outline focus-visible:outline-selected focus-visible:outline-offset-2 focus-visible:outline-tr-coral motion-reduce:transition-none"
      data-testid={testId}
    >
      {content}
    </button>
  )
}

/** Ledger Structure tab: the script against one story structure, stage by
 * stage. TV act structure is read from the beat sheet; the AI structures run
 * only from the Check structure click (rule 8). */
export function StructurePanel({
  project,
  busy,
  error,
  onCheck,
  onOpenBeat,
  hashScenes = structureSourceHash,
}: Props) {
  const [pick, setPick] = useState<StructurePick>(() => loadPick(project.id))
  const [currentHash, setCurrentHash] = useState<string | null>(null)
  const episode = project.seasons[0]?.episodes[0]
  const scenes = episode?.scenes ?? NO_SCENES

  useEffect(() => {
    let live = true
    // ponytail: crypto.subtle only exists in secure contexts (https,
    // localhost); elsewhere the hash rejects and the stale line stays hidden.
    hashScenes(scenes).then(
      (hash) => live && setCurrentHash(hash),
      () => live && setCurrentHash(null),
    )
    return () => {
      live = false
    }
  }, [hashScenes, scenes])

  function choose(next: StructurePick) {
    setPick(next)
    savePick(project.id, next)
  }

  const name =
    STRUCTURE_PICKS.find((option) => option.value === pick)?.label ?? pick
  const ai = pick !== 'tv_act_structure'
  const check = ai
    ? (episode?.structureChecks?.find((c) => c.lens === pick) ?? null)
    : null
  const stale =
    check !== null && currentHash !== null && currentHash !== check.sourceHash

  let rows: Row[] | null = null
  if (!ai) {
    rows =
      tvActStages(project.format, episode?.storyOverview)?.map((stage) => ({
        key: stage.key,
        label: stage.label,
        status: stage.status,
        beatId: stage.beatId,
        sceneId: stage.sceneId,
        reason: stage.summary,
        quote: null,
      })) ?? null
  } else if (check?.applies) {
    rows = STAGE_ORDER[check.lens]
      .flatMap((id) => check.stages.filter((stage) => stage.stage === id))
      .map((stage) => ({
        key: stage.stage,
        label: STAGE_LABELS[stage.stage],
        status: stage.status,
        beatId: stage.beatId,
        sceneId: stage.sceneId,
        reason: stage.reason,
        quote: stage.evidenceQuote,
      }))
  }

  return (
    <section
      className="flex flex-col gap-4 rounded-card border border-tr-border bg-tr-surface-raised p-5"
      data-testid="structure-panel"
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-script text-11 uppercase tracking-[0.1em] text-tr-text-muted">
            Structure
          </p>
          <h2 className="mt-1 font-ledger-display text-22 font-medium text-tr-text-primary">
            {name}
          </h2>
          {rows ? (
            <p className="mt-1 text-13 text-tr-text-secondary">
              {summaryLine(rows, ai)}
            </p>
          ) : null}
          {check?.applies ? (
            <p className="mt-1 text-12 text-tr-text-muted">{check.rationale}</p>
          ) : null}
        </div>
        <label className="flex items-center gap-2 text-12 text-tr-text-muted">
          Check against
          <select
            value={pick}
            onChange={(event) => choose(event.target.value as StructurePick)}
            className="rounded-control border border-tr-border bg-tr-surface-raised px-2 py-1.5 text-13 text-tr-text-primary"
            data-testid="structure-pick"
          >
            {STRUCTURE_PICKS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </header>

      {error ? (
        <p className="text-13 text-tr-danger" role="alert">
          {error}
        </p>
      ) : null}

      {stale ? (
        <div
          className="flex flex-wrap items-center gap-3 rounded-card bg-tr-amber-soft px-3 py-2 text-13 text-tr-text-primary"
          data-testid="structure-stale"
        >
          <span>The script changed since this check.</span>
          <button
            type="button"
            disabled={busy}
            onClick={() => onCheck(check.lens)}
            className="font-medium text-tr-accent-ink underline-offset-2 hover:underline disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? 'Checking…' : 'Check again'}
          </button>
        </div>
      ) : null}

      {!ai && !rows ? (
        <p className="text-13 text-tr-text-secondary">
          The show format isn&apos;t known yet.
        </p>
      ) : null}

      {ai && !check ? (
        <div className="flex flex-col items-start gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => onCheck(pick)}
            className="rounded-card bg-tr-coral px-3 py-2 text-13 font-medium text-tr-surface-raised disabled:cursor-not-allowed disabled:opacity-50"
            data-testid="structure-check-button"
          >
            {busy ? 'Checking…' : 'Check structure'}
          </button>
          <p className="text-12 text-tr-text-muted">
            About 25¢, under a minute.
          </p>
        </div>
      ) : null}

      {check && !check.applies ? (
        <div
          className="flex flex-col items-start gap-2 rounded-card bg-tr-surface-clay p-3"
          data-testid="structure-doesnt-fit"
        >
          <p className="text-13 font-medium text-tr-text-primary">
            {name} doesn&apos;t fit this script.
          </p>
          <p className="text-13 text-tr-text-secondary">{check.rationale}</p>
          <button
            type="button"
            onClick={() => choose('tv_act_structure')}
            className="rounded-card border border-tr-border bg-tr-surface-raised px-3 py-1.5 text-13 text-tr-text-primary hover:bg-tr-surface-clay"
          >
            Check TV act structure instead
          </button>
        </div>
      ) : null}

      {rows ? (
        <>
          <StructureStrip
            scenes={scenes}
            format={project.format}
            marks={rows}
          />
          <ol className="flex flex-col divide-y divide-tr-border border-y border-tr-border">
            {rows.map((row) => (
              <li key={row.key}>
                <StageRow row={row} onOpenBeat={onOpenBeat} />
              </li>
            ))}
          </ol>
        </>
      ) : null}
    </section>
  )
}
