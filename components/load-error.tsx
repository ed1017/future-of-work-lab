export function LoadError({ message }: { message: string }) {
  return (
    <main className="mx-auto max-w-2xl px-4 py-24">
      <h1 className="text-3xl font-semibold">The data didn&apos;t load</h1>
      <p className="mt-3 text-muted-foreground">
        The pages read the fow views on the server. Check the Supabase environment variables and that the fow schema
        is exposed in the Data API, then reload.
      </p>
      <pre className="mt-4 overflow-x-auto whitespace-pre-wrap rounded-lg border border-border bg-card p-3 text-xs text-muted-foreground">
        {message}
      </pre>
    </main>
  );
}
