export const DOMAINS = ['coding', 'copy', 'image', 'video', 'ads', 'agentic'] as const;
export type Domain = (typeof DOMAINS)[number];

export const DOMAIN_LABELS: Record<Domain, string> = {
  coding: 'Coding',
  copy: 'Copy',
  image: 'Image Gen',
  video: 'Video Gen',
  ads: 'Ads',
  agentic: 'Agentic',
};

export const DOMAIN_COLORS: Record<Domain, string> = {
  coding: 'var(--d-coding)',
  copy: 'var(--d-copy)',
  image: 'var(--d-image)',
  video: 'var(--d-video)',
  ads: 'var(--d-ads)',
  agentic: 'var(--d-agentic)',
};

export function isDomain(s: string): s is Domain {
  return (DOMAINS as readonly string[]).includes(s);
}

// A story "belongs" to a domain when its score for that domain is >= this
export const DOMAIN_MEMBERSHIP_THRESHOLD = 40;
