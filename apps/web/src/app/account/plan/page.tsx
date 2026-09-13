import { requireUser } from '@/lib/server';
import { FamilyPlan } from '@/components/family-plan';
export const metadata = { title: 'Family plan' };
export default async function PlanPage() {
  await requireUser('/account/plan');
  return <FamilyPlan />;
}
