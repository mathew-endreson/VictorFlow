import { NotPaired } from '@/components/NotPaired';

// The client board. Until display tokens and the board feed exist, every token shows the pairing screen.
export const dynamic = 'force-dynamic';

export default function ClientBoard() {
  return <NotPaired />;
}
