import { requireUser } from '@/lib/server';
import { MemorialStudio } from '@/components/memorial-studio';
import './studio.css';

export const metadata = { title: 'Memorial studio' };

export default async function MemorialPage() {
  await requireUser('/memorial');
  return <MemorialStudio />;
}
