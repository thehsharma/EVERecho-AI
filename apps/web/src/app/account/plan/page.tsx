import { HouseholdAllowance } from '@/components/household-allowance';
import { requireUser } from '@/lib/server';
import { FamilyPlan } from '@/components/family-plan';
export const metadata = { title: 'Family plan' };
export default async function PlanPage() {
  await requireUser('/account/plan');
  return (
    <div className="stack-lg">
      <FamilyPlan />
      <HouseholdAllowance />
    </div>
  );
}
