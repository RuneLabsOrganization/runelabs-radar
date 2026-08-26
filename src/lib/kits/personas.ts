/**
 * Persona roster — routing presets over the kit grid, NOT a content type.
 *
 * A persona is an ordered list of (category, task) routes plus a default cost
 * tier. Answers are written once per cell and shared by every persona that
 * routes to them: image/product-shots serves four of these.
 *
 * Adding a persona is a PR, not a migration. Being wrong about one is cheap.
 *
 * Symbols are KIT_-prefixed: src/lib/agent-stacks.ts already owns
 * PERSONA_SLUGS / AgentPersona / resolvePersona for the coding-harness page.
 */
import type { KitCategory, KitTier } from './grid';

export interface KitRoute {
  category: KitCategory;
  task: string;
}

export interface KitPersona {
  slug: string;
  label: string;
  blurb: string;
  routes: KitRoute[];
  defaultTier: KitTier;
}

export const KIT_PERSONAS: KitPersona[] = [
  {
    slug: 'indie-dev',
    label: 'Indie dev / solo shipper',
    blurb: 'Ships alone, owns the whole stack, pays for it personally.',
    defaultTier: 'value',
    routes: [
      { category: 'coding', task: 'agentic-coding' },
      { category: 'coding', task: 'autocomplete' },
      { category: 'coding', task: 'code-review' },
      { category: 'connectors', task: 'code-repo' },
      { category: 'infra', task: 'hosting' },
      { category: 'infra', task: 'database-baas' },
      { category: 'infra', task: 'auth' },
      { category: 'infra', task: 'payments' },
    ],
  },
  {
    slug: 'nocode-founder',
    label: 'Non-coder founder',
    blurb: 'Getting to a live product without writing the code themselves.',
    defaultTier: 'cheapest',
    routes: [
      { category: 'coding', task: 'agentic-coding' },
      { category: 'infra', task: 'hosting' },
      { category: 'infra', task: 'database-baas' },
      { category: 'copy', task: 'long-form' },
      { category: 'image', task: 'illustration' },
    ],
  },
  {
    slug: 'entrepreneur',
    label: 'Entrepreneur / MVP',
    blurb: 'Validating and launching, watching runway rather than craft.',
    defaultTier: 'value',
    routes: [
      { category: 'infra', task: 'hosting' },
      { category: 'infra', task: 'database-baas' },
      { category: 'infra', task: 'auth' },
      { category: 'infra', task: 'payments' },
      { category: 'coding', task: 'agentic-coding' },
      { category: 'copy', task: 'ad-copy' },
      { category: 'ads', task: 'campaign-management' },
    ],
  },
  {
    slug: 'product-designer',
    label: 'Product / UI designer',
    blurb: 'Screens and systems, handing off to engineering.',
    defaultTier: 'value',
    routes: [
      { category: 'image', task: 'illustration' },
      { category: 'image', task: 'photoreal' },
      { category: 'connectors', task: 'design' },
      { category: 'coding', task: 'agentic-coding' },
    ],
  },
  {
    slug: 'brand-designer',
    label: 'Brand / graphic designer',
    blurb: 'Identity, marketing assets, client work.',
    defaultTier: 'value',
    routes: [
      { category: 'image', task: 'illustration' },
      { category: 'image', task: 'product-shots' },
      { category: 'copy', task: 'social' },
    ],
  },
  {
    slug: 'ugc-creator',
    label: 'UGC creator',
    blurb: 'High-volume short-form video for brands, on a tight budget.',
    defaultTier: 'cheapest',
    routes: [
      { category: 'video', task: 'text-to-video' },
      { category: 'video', task: 'image-to-video' },
      { category: 'video', task: 'avatar' },
      { category: 'audio', task: 'voice-tts' },
      { category: 'audio', task: 'music' },
      { category: 'image', task: 'photoreal' },
    ],
  },
  {
    slug: 'filmmaker',
    label: 'Video editor / filmmaker',
    blurb: 'Longer-form narrative work where quality beats cost.',
    defaultTier: 'best',
    routes: [
      { category: 'video', task: 'text-to-video' },
      { category: 'video', task: 'image-to-video' },
      { category: 'audio', task: 'voice-tts' },
      { category: 'audio', task: 'music' },
      { category: 'audio', task: 'transcription' },
      { category: 'image', task: 'photoreal' },
    ],
  },
  {
    slug: 'perf-marketer',
    label: 'Performance marketer',
    blurb: 'Paid acquisition — creative volume and campaign ops.',
    defaultTier: 'value',
    routes: [
      { category: 'ads', task: 'creative-generation' },
      { category: 'ads', task: 'campaign-management' },
      { category: 'copy', task: 'ad-copy' },
      { category: 'image', task: 'product-shots' },
      { category: 'video', task: 'avatar' },
    ],
  },
  {
    slug: 'content-marketer',
    label: 'Content marketer / writer',
    blurb: 'Organic content, newsletters, social, repurposing.',
    defaultTier: 'value',
    routes: [
      { category: 'copy', task: 'long-form' },
      { category: 'copy', task: 'social' },
      { category: 'image', task: 'illustration' },
      { category: 'audio', task: 'transcription' },
    ],
  },
  {
    slug: 'automation',
    label: 'Data / automation builder',
    blurb: 'Wires agents to systems — orchestration and browser work.',
    defaultTier: 'value',
    routes: [
      { category: 'agentic', task: 'orchestration' },
      { category: 'agentic', task: 'browser-automation' },
      { category: 'agentic', task: 'computer-use' },
      { category: 'connectors', task: 'data' },
      { category: 'connectors', task: 'browser' },
    ],
  },
  {
    slug: 'agency',
    label: 'Agency / multi-client',
    blurb: 'Breadth across creative disciplines, billed to clients.',
    defaultTier: 'best',
    routes: [
      { category: 'image', task: 'illustration' },
      { category: 'image', task: 'photoreal' },
      { category: 'image', task: 'product-shots' },
      { category: 'video', task: 'text-to-video' },
      { category: 'video', task: 'image-to-video' },
      { category: 'video', task: 'avatar' },
      { category: 'copy', task: 'long-form' },
      { category: 'copy', task: 'social' },
      { category: 'copy', task: 'ad-copy' },
      { category: 'ads', task: 'creative-generation' },
      { category: 'ads', task: 'campaign-management' },
    ],
  },
];

export const KIT_PERSONA_SLUGS: string[] = KIT_PERSONAS.map((p) => p.slug);

export function getKitPersona(slug: string): KitPersona | null {
  return KIT_PERSONAS.find((p) => p.slug === slug) ?? null;
}
