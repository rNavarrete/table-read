export function NewProjectStub({ title }: { title: string }) {
  return (
    <div className="min-h-screen bg-tr-surface-page">
      <main className="mx-auto flex max-w-xl flex-col gap-4 px-6 py-24 text-center">
        <h1 className="font-display text-28 font-semibold text-tr-text-primary">
          {title}
        </h1>
        <p className="text-15 text-tr-text-secondary">Coming soon.</p>
        <a href="/projects" className="text-13 text-tr-sky underline">
          Back to projects
        </a>
      </main>
    </div>
  )
}
