import { NotPaired } from '@/components/NotPaired';

// The production-room board. Until display tokens and the board feed exist, every token shows the pairing screen.
export const dynamic = 'force-dynamic';

export default function StaffBoard() {
  return <NotPaired />;
}
