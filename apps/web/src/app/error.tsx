'use client';

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="narrow stack">
      <h1>Something went wrong</h1>
      {/* The message is deliberately not shown: it may carry internal detail. */}
      <div className="notice notice-danger" role="alert">
        <p style={{ marginBottom: 0 }}>
          Nothing was changed. If this keeps happening, please tell support what you were doing —
          you do not need to include any details of the archive itself.
        </p>
      </div>
      <button type="button" className="btn btn-primary" onClick={reset}>
        Try again
      </button>
    </div>
  );
}
