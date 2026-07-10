import { describe, expect, it } from 'vitest';
import { isValidElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import StoryCard, { timeAgo, type Story } from '@/components/StoryCard';
import DomainChips, { parseDomainScores } from '@/components/DomainChips';
import VoteButtons from '@/components/VoteButtons';

type Collected = {
  elements: Array<{ type: unknown; props: Record<string, unknown> }>;
  text: string[];
};

/**
 * Walks a React element tree without a renderer. Server components are invoked
 * inline; client components (VoteButtons) are recorded but never invoked, since
 * they rely on next/navigation hooks.
 */
function collect(node: ReactNode, out: Collected): void {
  if (node == null || typeof node === 'boolean') return;
  if (typeof node === 'string' || typeof node === 'number') {
    out.text.push(String(node));
    return;
  }
  if (Array.isArray(node)) {
    for (const child of node) collect(child, out);
    return;
  }
  if (isValidElement(node)) {
    const props = node.props as Record<string, unknown>;
    out.elements.push({ type: node.type, props });
    if (typeof node.type === 'function' && node.type !== VoteButtons) {
      collect((node.type as (p: Record<string, unknown>) => ReactNode)(props), out);
    } else {
      collect(props.children as ReactNode, out);
    }
  }
}

function render(node: ReactNode): Collected {
  const out: Collected = { elements: [], text: [] };
  collect(node, out);
  return out;
}

describe('timeAgo', () => {
  it('formats recent times as "just now"', () => {
    expect(timeAgo(new Date())).toBe('just now');
    expect(timeAgo(new Date(Date.now() - 30_000))).toBe('just now');
  });

  it('formats minutes, hours and days', () => {
    expect(timeAgo(new Date(Date.now() - 5 * 60_000))).toBe('5m ago');
    expect(timeAgo(new Date(Date.now() - 3 * 36e5))).toBe('3h ago');
    expect(timeAgo(new Date(Date.now() - 49 * 36e5))).toBe('2d ago');
  });
});

describe('parseDomainScores', () => {
  it('returns null for null or malformed JSON', () => {
    expect(parseDomainScores(null)).toBeNull();
    expect(parseDomainScores('not json')).toBeNull();
  });

  it('keeps only numeric known-domain entries', () => {
    const parsed = parseDomainScores(
      JSON.stringify({ coding: 80, copy: 'high', bogus: 99, video: 12 }),
    );
    expect(parsed).toEqual({ coding: 80, video: 12 });
  });
});

describe('DomainChips', () => {
  it('renders chips only for domains at or above the membership threshold', () => {
    const html = renderToStaticMarkup(
      DomainChips({ scores: { coding: 92, agentic: 61, copy: 10, ads: 39 } }),
    );
    expect(html).toContain('Coding');
    expect(html).toContain('92');
    expect(html).toContain('Agentic');
    expect(html).toContain('61');
    expect(html).not.toContain('Copy');
    expect(html).not.toContain('Ads');
  });

  it('renders nothing when no domain qualifies', () => {
    expect(renderToStaticMarkup(DomainChips({ scores: { coding: 5 } }))).toBe('');
    expect(renderToStaticMarkup(DomainChips({ scores: null }))).toBe('');
  });

  it('accents the highlighted domain chip with its color', () => {
    const html = renderToStaticMarkup(
      DomainChips({ scores: { coding: 92 }, highlight: 'coding' }),
    );
    expect(html).toContain('border-color:var(--d-coding)');
  });
});

describe('StoryCard', () => {
  const story: Story = {
    id: 7,
    title: 'GPT-6 released',
    tldr: 'A very big model appeared.',
    whyItMatters: 'Cheaper coding agents overnight.',
    domainScores: JSON.stringify({ coding: 92, copy: 10, image: 0, video: 0, ads: 5, agentic: 61 }),
    topScore: 92,
    status: 'curated',
    createdAt: new Date(Date.now() - 2 * 36e5),
  };

  it('links the title to the first item url and shows meta, tldr and why-it-matters', () => {
    const out = render(
      StoryCard({
        story,
        itemCount: 3,
        firstUrl: 'https://example.com/gpt6',
        up: 4,
        down: 2,
        myVote: 1,
      }),
    );
    const link = out.elements.find((e) => e.type === 'a');
    expect(link?.props.href).toBe('https://example.com/gpt6');
    expect(link?.props.target).toBe('_blank');

    const text = out.text.join(' ');
    expect(text).toContain('GPT-6 released');
    expect(text).toContain('2h ago');
    expect(text).toContain('3 sources');
    expect(text).toContain('A very big model appeared.');
    expect(text).toContain('Cheaper coding agents overnight.');
    expect(text).toContain('Coding'); // chip for score 92
    expect(text).not.toContain('Image Gen'); // score 0 stays hidden
  });

  it('passes vote data through to VoteButtons without invoking it', () => {
    const out = render(
      StoryCard({ story, itemCount: 1, firstUrl: null, up: 4, down: 2, myVote: 1 }),
    );
    const vb = out.elements.find((e) => e.type === VoteButtons);
    expect(vb?.props).toMatchObject({ storyId: 7, up: 4, down: 2, myVote: 1 });

    const text = out.text.join(' ');
    expect(text).toContain('1 source');
    expect(out.elements.find((e) => e.type === 'a')).toBeUndefined();
  });
});
