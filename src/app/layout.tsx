import type { Metadata } from 'next';
import { Geist, Geist_Mono, Instrument_Serif } from 'next/font/google';
import { config } from '@/lib/config';
import { getIdentity } from '@/lib/identity';
import { TooltipProvider } from '@/components/ui/tooltip';
import './globals.css';

const geistSans = Geist({
  subsets: ['latin'],
  variable: '--font-geist-sans',
  display: 'swap',
});

const geistMono = Geist_Mono({
  subsets: ['latin'],
  variable: '--font-geist-mono',
  display: 'swap',
});

const instrumentSerif = Instrument_Serif({
  weight: '400',
  subsets: ['latin'],
  variable: '--font-instrument',
  display: 'swap',
});

const identity = getIdentity();

export const metadata: Metadata = {
  metadataBase: new URL(config.siteUrl),
  title: {
    default: `${identity.productName} — AI intelligence for builders`,
    template: `%s · ${identity.productName}`,
  },
  description:
    'Radar fetches the best tech, stacks, and opportunities for creators building with AI. MCP-ready intelligence: what changed, what to use, what to build.',
  alternates: {
    types: {
      'application/rss+xml': [
        { url: '/changelog.xml', title: `${identity.productName} — Changelog` },
        { url: '/brief.xml', title: identity.briefTitle },
      ],
    },
  },
  openGraph: {
    siteName: identity.productName,
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} ${instrumentSerif.variable}`}
    >
      <body className="font-sans antialiased">
        <script
          dangerouslySetInnerHTML={{
            __html: `try{if(localStorage.getItem('radar.theme')==='light')document.documentElement.dataset.theme='light'}catch(e){}`,
          }}
        />
        <TooltipProvider delayDuration={200}>{children}</TooltipProvider>
      </body>
    </html>
  );
}
