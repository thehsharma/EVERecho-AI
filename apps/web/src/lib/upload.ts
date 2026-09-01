import { api } from './api';

export interface UploadProgress {
  stage: 'preparing' | 'uploading' | 'finishing' | 'done';
  percent: number;
}

/**
 * The real upload path: reserve a source, PUT the bytes to a short-lived signed
 * URL, then confirm. The bytes never pass through the application server, and
 * nothing is processed until the confirmation queues a scan.
 */
export async function uploadFile(
  archiveId: string,
  file: Blob,
  options: {
    filename: string;
    mimeType: string;
    kind: 'audio' | 'video' | 'photo' | 'document' | 'text';
    sidecarText?: string;
    durationMs?: number;
    sensitivity?: 'normal' | 'sensitive' | 'restricted' | 'embargoed';
    caption?: string;
    onProgress?: (progress: UploadProgress) => void;
  },
): Promise<{ sourceId: string }> {
  const report = options.onProgress ?? (() => {});
  report({ stage: 'preparing', percent: 5 });

  const ticket = await api.post<{
    ticket: { sourceId: string; uploadUrl: string; method: string };
  }>(`/v1/archives/${archiveId}/sources`, {
    filename: options.filename,
    mimeType: options.mimeType,
    byteSize: file.size,
    kind: options.kind,
    idempotencyKey: `${options.filename}-${file.size}-${Date.now()}`,
    caption: options.caption,
    privacy: {
      allowTranscription: true,
      allowOcr: true,
      allowEmbedding: true,
      allowGeneration: true,
      allowExport: true,
      sensitivity: options.sensitivity ?? 'normal',
      dataCategories: [
        options.kind === 'photo' ? 'photo' : options.kind === 'document' ? 'document' : 'audio',
      ],
    },
  });

  report({ stage: 'uploading', percent: 20 });

  // XHR rather than fetch: it reports upload progress, which matters when a
  // storyteller is sending a long recording over a slow connection.
  await new Promise<void>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('PUT', ticket.ticket.uploadUrl, true);
    request.withCredentials = false;
    request.setRequestHeader('content-type', options.mimeType);
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        report({ stage: 'uploading', percent: 20 + Math.round((event.loaded / event.total) * 65) });
      }
    };
    request.onload = () =>
      request.status >= 200 && request.status < 300
        ? resolve()
        : reject(new Error(`The upload was refused (${request.status}).`));
    request.onerror = () => reject(new Error('The connection dropped during the upload.'));
    request.ontimeout = () => reject(new Error('The upload timed out.'));
    request.send(file);
  });

  report({ stage: 'finishing', percent: 90 });
  await api.post(`/v1/archives/${archiveId}/sources/${ticket.ticket.sourceId}/complete`, {
    ...(options.sidecarText ? { sidecarText: options.sidecarText } : {}),
    ...(options.durationMs ? { durationMs: options.durationMs } : {}),
  });

  report({ stage: 'done', percent: 100 });
  return { sourceId: ticket.ticket.sourceId };
}
