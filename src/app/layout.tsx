import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Runelabs Radar',
  description: 'AI intelligence hub for Runelabs',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
