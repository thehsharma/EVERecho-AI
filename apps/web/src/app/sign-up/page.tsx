import { Suspense } from 'react';
import { AuthForm } from '@/components/auth-form';
import { Card } from '@/components/ui';
import { productMeta } from '@/lib/server';

export const metadata = { title: 'Create an account' };

export default async function SignUpPage() {
  const meta = await productMeta();
  return (
    <div className="narrow stack">
      <h1>Create an account</h1>
      <p className="muted">
        An account is just a way to sign in. It does not create an archive and it does not give you
        access to anyone else’s.
      </p>
      <Card>
        <Suspense fallback={<p className="spinner-text">Loading</p>}>
          <AuthForm mode="sign-up" legalCopyVersion={meta.legalCopyVersion} productName={meta.productName} />
        </Suspense>
      </Card>
    </div>
  );
}
