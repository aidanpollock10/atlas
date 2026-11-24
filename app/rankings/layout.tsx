import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Rankings' };

export default function RankingsLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
