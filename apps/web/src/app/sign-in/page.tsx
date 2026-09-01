import { Suspense } from 'react';
import { AuthForm } from '@/components/auth-form';
import { Card } from '@/components/ui';
import { productMeta } from '@/lib/server';

export const metadata = { title: 'Sign in' };

export default async function SignInPage() {
  const meta = await productMeta();
  return (
    <div className="narrow stack">
      <h1>Sign in</h1>
      <Card>
        <Suspense fallback={<p className="spinner-text">Loading</p>}>
          <AuthForm mode="sign-in" legalCopyVersion={meta.legalCopyVersion} productName={meta.productName} />
        </Suspense>
      </Card>
    </div>
  );
}
