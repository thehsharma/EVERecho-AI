import Link from 'next/link';
import { Notice } from '@/components/ui';

export default function NotFound() {
  return (
    <div className="narrow stack">
      <h1>We could not find that</h1>
      <Notice tone="info">
        <p style={{ marginBottom: 0 }}>
          Either it does not exist, or it is not something you have been given access to. We do not
          say which — telling you an archive exists would itself disclose something about a family.
        </p>
      </Notice>
      <p>
        <Link href="/archives">Back to your archives</Link>
      </p>
    </div>
  );
}
