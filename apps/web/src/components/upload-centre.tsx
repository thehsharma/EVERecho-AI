'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { uploadFile } from '@/lib/upload';
import { ApiRequestError } from '@/lib/api';

interface Item {
  name: string;
  percent: number;
  state: 'uploading' | 'done' | 'failed';
  error?: string;
}

function kindFor(mimeType: string): 'audio' | 'video' | 'photo' | 'document' | 'text' {
  if (mimeType.startsWith('audio/')) return 'audio';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('image/')) return 'photo';
  if (mimeType === 'text/plain') return 'text';
  return 'document';
}

export function UploadCentre({ archiveId }: { archiveId: string }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [caption, setCaption] = useState('');
  const [sensitivity, setSensitivity] = useState<'normal' | 'sensitive'>('normal');

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;

    for (const file of Array.from(files)) {
      const index = items.length;
      setItems((prev) => [...prev, { name: file.name, percent: 0, state: 'uploading' }]);

      try {
        await uploadFile(archiveId, file, {
          filename: file.name,
          mimeType: file.type || 'application/octet-stream',
          kind: kindFor(file.type),
          caption: caption || undefined,
          sensitivity,
          onProgress: (progress) =>
            setItems((prev) =>
              prev.map((item, i) => (i === index ? { ...item, percent: progress.percent } : item)),
            ),
        });
        setItems((prev) =>
          prev.map((item, i) => (i === index ? { ...item, percent: 100, state: 'done' } : item)),
        );
      } catch (caught) {
        setItems((prev) =>
          prev.map((item, i) =>
            i === index
              ? {
                  ...item,
                  state: 'failed',
                  error:
                    caught instanceof ApiRequestError
                      ? caught.message
                      : caught instanceof Error
                        ? caught.message
                        : 'The upload failed.',
                }
              : item,
          ),
        );
      }
    }

    setCaption('');
    if (inputRef.current) inputRef.current.value = '';
    router.refresh();
  }

  return (
    <div className="stack">
      <div>
        <label htmlFor="caption">What is this? (optional)</label>
        <p className="hint" id="caption-hint">
          A few words help later — “my mother outside the Pune house, about 1965”.
        </p>
        <input
          id="caption"
          value={caption}
          onChange={(event) => setCaption(event.target.value)}
          aria-describedby="caption-hint"
        />
      </div>

      <fieldset>
        <legend>How private is this?</legend>
        <div className="choice">
          <input
            type="radio"
            id="sensitivity-normal"
            name="sensitivity"
            checked={sensitivity === 'normal'}
            onChange={() => setSensitivity('normal')}
          />
          <label htmlFor="sensitivity-normal">
            Ordinary — anyone I have given access to may see it
          </label>
        </div>
        <div className="choice">
          <input
            type="radio"
            id="sensitivity-sensitive"
            name="sensitivity"
            checked={sensitivity === 'sensitive'}
            onChange={() => setSensitivity('sensitive')}
          />
          <label htmlFor="sensitivity-sensitive">
            More private — only people I specifically allow
          </label>
        </div>
      </fieldset>

      <div>
        <label htmlFor="files">Choose files</label>
        <input
          ref={inputRef}
          id="files"
          type="file"
          multiple
          onChange={(event) => void handleFiles(event.target.files)}
        />
      </div>

      {items.length > 0 ? (
        <ul className="list-plain" aria-live="polite">
          {items.map((item, index) => (
            <li key={`${item.name}-${index}`}>
              <div className="spread">
                <span>{item.name}</span>
                <span className="small muted">
                  {item.state === 'done'
                    ? 'Added'
                    : item.state === 'failed'
                      ? 'Not added'
                      : `${item.percent}%`}
                </span>
              </div>
              {item.state === 'uploading' ? (
                <div className="progress">
                  <span style={{ width: `${item.percent}%` }} />
                </div>
              ) : null}
              {item.error ? (
                <p className="small" style={{ color: 'var(--danger)', margin: '0.25rem 0 0' }}>
                  {item.error} Nothing was changed — you can try again.
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
