import { comparableBuyers } from './comparable-buyers';
import { comparableChannels } from './channel-cac';
import { commercialUrl, parseCommercial, type CommercialProfile, type CommercialSource } from './commercial';

/** Recalculate only the commercial inputs supported by matched product data. */
export function applyComparableEconomics(profile: CommercialProfile, priceUsd: number | null): CommercialProfile {
  const market = comparableBuyers(profile);
  const acquisition = comparableChannels(profile, priceUsd);
  if (!market && !acquisition) return profile;

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
    // Use the high end of a designated route to market for payback. An observed
    // local, matched CAC already stored in a dossier takes precedence.
    if (profile.cac?.kind !== 'observed') next.cac = { ...next.cacChannels[0], kind: 'scenario' };
  }
  const valid = parseCommercial(next);
  if (!valid) throw new Error('Invalid comparable economics dossier');
  return valid;
}
