import type { Metadata } from 'next';
import { config } from '@/lib/config';
import { getIdentity } from '@/lib/identity';

export function siteMeta(
  title: string,
  description: string,
  path: string,
  opts?: { index?: boolean },
): Metadata {
  const canonical = new URL(path, config.siteUrl).toString();
  const meta: Metadata = {
    title,
    description,
    alternates: { canonical },
    openGraph: { title, description, url: canonical },
    twitter: { card: 'summary_large_image', title, description },
  };
  if (opts?.index === false) {
    meta.robots = { index: false, follow: false };
  }
  return meta;
}

type JsonLd = Record<string, unknown> & { '@type': string };

export function landingJsonLd(): JsonLd[] {
  const name = getIdentity().productName;
  const url = config.siteUrl;

  return [
    {
      '@context': 'https://schema.org',
      '@type': 'Organization',
      name,
      url,
    },
    {
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      name,
      url,
      applicationCategory: 'BusinessApplication',
      offers: [
        { '@type': 'Offer', price: '0', priceCurrency: 'USD', name: 'Free' },
        { '@type': 'Offer', price: '19', priceCurrency: 'USD', name: 'Builder' },
      ],
    },
    {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: [
        {
          '@type': 'Question',
          name: 'What is Radar?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'Radar reads every source in the AI field daily and turns it into one answer per job: what is best, what is best value, and what is cheapest that still works.',
          },
        },
        {
          '@type': 'Question',
          name: 'What is free vs paid?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'Start free. Everything you need to decide costs nothing. You pay from $19/mo when you want Radar doing work for you, not just telling you things.',
          },
        },
        {
          '@type': 'Question',
          name: 'How are picks funded?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'We take $0 vendor money. Nobody pays us to recommend anything. Picks come from dated, graded evidence — not sponsorships.',
          },
        },
      ],
    },
  ];
}
