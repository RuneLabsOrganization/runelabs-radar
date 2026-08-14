import type { Metadata } from 'next';
import { config } from '@/lib/config';
import { getIdentity } from '@/lib/identity';
import './globals.css';

const identity = getIdentity();

export const metadata: Metadata = {
  metadataBase: new URL(config.siteUrl),
  title: {
    default: `${identity.productName} — AI stack & opportunity intelligence`,
    template: `%s · ${identity.productName}`,
  },
  description:
    'Independent, continuously-updated intelligence on the AI landscape: the best stack for each job right now, cost-benefit boards per domain, and monetizable openings detected from the noise.',
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
    <html lang="en" suppressHydrationWarning>
      <body>
        {/* restore the saved theme before first paint — dark is the default,
            only 'light' ever needs the attribute */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{if(localStorage.getItem('radar.theme')==='light')document.documentElement.dataset.theme='light'}catch(e){}`,
          }}
        />
        {children}
      </body>
    </html>
  );
}
