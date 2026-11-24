import { comparableBuyers } from './comparable-buyers';
import { comparableChannels } from './channel-cac';
import { blendedChannel, commercialUrl, parseCommercial, weightedChannelCac, type CommercialProfile, type CommercialSource } from './commercial';
import { comparableMix } from './channel-mix';
import { bootstrapAssessment } from './bootstrap';

/** Recalculate only the commercial inputs supported by matched product data. */
export function applyComparableEconomics(profile: CommercialProfile, priceUsd: number | null,
  bootstrapInputs?: Parameters<typeof bootstrapAssessment>[0]): CommercialProfile {
  const market = comparableBuyers(profile);
  const acquisition = comparableChannels(profile, priceUsd);
  const hasBootstrapInputs = bootstrapInputs && (profile.bootstrap || [bootstrapInputs.initialCostUsd, bootstrapInputs.monthlyCostUsd,
    bootstrapInputs.timeToMvpDays].some(n => n !== null && n !== undefined));
  if (!market && !acquisition && !hasBootstrapInputs) return profile;

  const sources = [...profile.sources];
  // Citation IDs are dossier-local. A prior search may already cite the same report
  // under another ID, or an older source may occupy a catalog entry's preferred ID.
  function attach(ids: string[], supplied: CommercialSource[]) {
    return [...new Set(ids.map(id => {
      const source = supplied.find(s => s.id === id);
      if (!source) throw new Error('Missing comparable source ' + id);
      const url = commercialUrl(source.url);
      if (!url) throw new Error('Invalid comparable source URL');
      const existing = sources.find(s => commercialUrl(s.url) === url);
      if (existing) {
        // Keep the original excerpt supporting earlier claims. The same report
        // may contain additional measurements used by the comparable model.
        if (existing.snippet !== source.snippet && existing.comparableEvidence?.snippet !== source.snippet) {
          sources[sources.indexOf(existing)] = { ...existing,
            comparableEvidence: { snippet: source.snippet, publishedAt: source.publishedAt } };
        }
        return existing.id;
      }
      let key = id;
      let serial = 0;
      while (sources.some(s => s.id === key)) key = id[0] + (++serial);
      sources.push({ ...source, id: key, url });
      return key;
    }))];
  }

  const next = { ...profile, sources };
  if (market) next.market = { ...market.market, scope: 'comparable-cohort', sourceIds: attach(market.market.sourceIds, market.sources) };
  if (acquisition?.channels.length) {
    next.cacChannels = acquisition.channels.map(c => ({ ...c, sourceIds: attach(c.sourceIds, acquisition.sources) }));
    const mix = comparableMix(next);
    delete next.channelMix;
    if (mix) {
      const usd = weightedChannelCac(next.cacChannels, mix.weights);
      if (!usd) throw new Error('Invalid comparable channel weights');
      const sourceIds = [...new Set([...attach(mix.sources.map(s => s.id), mix.sources), ...next.cacChannels.flatMap(c => c.sourceIds)])];
      next.channelMix = { weights: mix.weights, assumptions: mix.assumptions, usd, sourceIds };
    }
    if (profile.cac?.kind !== 'observed') {
      const primary = next.channelMix ? { channel: blendedChannel, usd: next.channelMix.usd,
        assumptions: next.channelMix.assumptions, sourceIds: next.channelMix.sourceIds } : next.cacChannels[0];
      next.cac = { ...primary, kind: 'scenario' };
    }
  }
  if (hasBootstrapInputs) next.bootstrap = bootstrapAssessment(bootstrapInputs, next);
  const valid = parseCommercial(next);
  if (!valid) throw new Error('Invalid comparable economics dossier');
  return valid;
}
