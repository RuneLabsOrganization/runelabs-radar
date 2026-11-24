// npx tsx scripts/refresh-finalist-economics.ts [--apply] 578 580 579
import { isDeepStrictEqual as equal } from 'node:util';
import { pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';
import { config } from '../src/lib/config';
import { loadDotEnv } from '../src/lib/env';
import { parseCommercial } from '../src/lib/opportunities/commercial';
import { applyComparableEconomics } from '../src/lib/opportunities/comparable-economics';
import { compareOpportunities } from '../src/lib/opportunities/ranking';
import { rankingFromRow } from '../src/lib/opportunities/view';

type Row = Parameters<typeof rankingFromRow>[0];
const scope = "status = 'active' AND owner_user_id IS NULL";

export function parseArgs(argv: string[]) {
  const ids: number[] = [];
  let apply = false;
  for (const arg of argv) {
    if (arg === '--apply' && !apply) {
      apply = true;
      continue;
    }
    const id = Number(arg);
    if (!/^[1-9]\d*$/.test(arg) || !Number.isSafeInteger(id) || ids.includes(id)) {
      throw new Error('Expected distinct positive integer IDs and at most one --apply flag.');
    }
    ids.push(id);
  }
  if (!ids.length) throw new Error('Usage: tsx scripts/refresh-finalist-economics.ts [--apply] ID [ID ...]');
  return { ids, apply };
}

function activeRows(db: Database.Database) {
  return db.prepare<[], Row>(`SELECT id, verdict, flip_score AS flipScore, hold_score AS holdScore, kpis
    FROM opportunities WHERE ${scope} ORDER BY id`).all();
}

function ranked(rows: Row[]) {
  return new Map(rows.map(rankingFromRow).sort(compareOpportunities).map((r, index) => [r.id, { ...r, rank: index + 1 }]));
}

function object(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

// Apply the helper's delta to the stored JSON. The commercial parser strips unknown
// properties and normalizes text, so serializing its entire result would lose data.
function overlay(raw: unknown, before: unknown, after: unknown): unknown {
  if (equal(before, after)) return raw;
  if (object(raw) && object(before) && object(after)) {
    const merged = { ...raw };
    for (const key of Object.keys(after)) merged[key] = overlay(raw[key], before[key], after[key]);
    for (const key of Object.keys(before)) {
      if (!Object.hasOwn(after, key)) {
        if (!equal(raw[key], before[key])) throw new Error('Removing this field would discard stored metadata.');
        delete merged[key];
      }
    }
    return merged;
  }
  if (Array.isArray(raw) && Array.isArray(before) && Array.isArray(after)) {
    // Sources can be appended and acquisition channels can change order.
    const key = ['id', 'channel'].find(k => [...before, ...after].every(v => object(v) && typeof v[k] === 'string'));
    if (key) {
      const indexes = new Map(before.map((v, i) => [v[key], i]));
      const result = after.map(v => {
        const i = indexes.get(v[key]);
        indexes.delete(v[key]);
        return i === undefined ? v : overlay(raw[i], before[i], v);
      });
      for (const i of indexes.values()) {
        if (!equal(raw[i], before[i])) throw new Error('Removing this entry would discard stored metadata.');
      }
      return result;
    }
  }
  if (before !== undefined && !equal(raw, before) && (object(raw) || Array.isArray(raw))) {
    throw new Error('Replacing this field would discard stored metadata.');
  }
  return after;
}

type Ranking = ReturnType<typeof rankingFromRow> & { rank: number };
function summary(r: Ranking) {
  const p = r.kpis?.commercial;
  return {
    rank: r.rank, commercialScore: r.commercialScore, flipScore: r.flipScore, holdScore: r.holdScore,
    priceUsd: r.kpis?.priceUsd ?? null,
    market: p?.market ?? null, cac: p?.cac ?? null, cacChannels: p?.cacChannels ?? [],
    coverage: {
      referencePopulation: !!p?.marketReference, sectorSpending: !!p?.sectorSpending,
      reachableMarket: !!p?.market, competitors: p?.competition?.length ?? 0, sources: p?.sources.length ?? 0,
      acquisition: !!p?.cac, acquisitionBenchmarks: p?.cacReferences?.length ?? 0,
      acquisitionChannels: p?.cacChannels?.length ?? 0, pilot: !!p?.execution, aiCost: !!p?.execution?.ai,
    },
  };
}

export function planRefresh(db: Database.Database, ids: number[]) {
  const original = activeRows(db);
  const baseline = ranked(original);
  const projected = original.map(row => ({ ...row }));
  const byId = new Map(projected.map(row => [row.id, row]));
  const unavailableIds = ids.filter(id => !byId.has(id));
  const mismatches: string[] = unavailableIds.map(id => `ID ${id} is unavailable in the active public set.`);
  const finalists = ids.flatMap(id => {
    const row = byId.get(id);
    if (!row) return [];
    const before = baseline.get(id)!;
    const profile = before.kpis?.commercial;
    let changedFields: string[] = [];
    let note = 'Stored economics already match the proposal.';
    try {
      if (!profile || !row.kpis) throw new Error('Missing or invalid stored commercial profile.');
      const input = structuredClone(profile);
      const next = applyComparableEconomics(input, before.kpis?.priceUsd ?? null);
      if (next === input) note = 'No comparable economics proposal matched the stored profile.';
      if (!equal(profile, next)) {
        const raw = JSON.parse(row.kpis);
        const commercial = overlay(raw.commercial, profile, next);
        if (!equal(parseCommercial(commercial), next)) throw new Error('Stored projection differs from helper output.');
        row.kpis = JSON.stringify({ ...raw, commercial });
        changedFields = [...new Set([...Object.keys(profile), ...Object.keys(next)])]
          .filter(k => !equal(profile[k as keyof typeof profile], next[k as keyof typeof next]));
        note = 'Comparable economics changed the listed commercial fields.';
      }
    } catch (err) {
      note = err instanceof Error ? err.message : 'Could not project comparable economics.';
      mismatches.push(`ID ${id}: ${note}`);
    }
    return [{ id, changedFields, note, before: summary(before) }];
  });
  const after = ranked(projected);
  const publicRanking = Array.from(baseline.values(), before => {
    const next = after.get(before.id)!;
    return { id: before.id, beforeRank: before.rank, afterRank: next.rank,
      beforeScore: before.commercialScore, afterScore: next.commercialScore };
  });
  const report = {
    activePublic: original.length, requested: ids.length, available: finalists.length,
    changed: finalists.filter(f => f.changedFields.length > 0).length, unavailableIds, mismatches,
    ranksChangedAcrossActivePublic: publicRanking.filter(r => r.beforeRank !== r.afterRank).length,
    publicRanking,
    finalists: finalists.map(f => ({ ...f, after: summary(after.get(f.id)!) })),
  };
  return { original, projected, report };
}

export function applyRefresh(db: Database.Database, plan: ReturnType<typeof planRefresh>) {
  if (plan.report.mismatches.length) throw new Error('Requested batch has unresolved mismatches.');
  return db.transaction(() => {
    if (!equal(activeRows(db), plan.original)) throw new Error('Active public ranking inputs changed since preview.');
    const update = db.prepare(`UPDATE opportunities SET kpis = ? WHERE id = ? AND ${scope} AND kpis IS ?`);
    let updated = 0;
    for (const [i, row] of plan.projected.entries()) {
      const original = plan.original[i];
      if (original.kpis === row.kpis) continue;
      if (update.run(row.kpis, row.id, original.kpis).changes !== 1) throw new Error(`Update mismatch for ID ${row.id}.`);
      updated++;
    }
    if (!equal(activeRows(db), plan.projected)) throw new Error('Stored result mismatch. Rolling back the batch.');
    return updated;
  }).immediate();
}

function main() {
  const { ids, apply } = parseArgs(process.argv.slice(2));
  loadDotEnv();
  const db = new Database(config.databasePath, { readonly: !apply, fileMustExist: true });
  try {
    const plan = planRefresh(db, ids);
    let updated = 0;
    if (apply && !plan.report.mismatches.length) updated = applyRefresh(db, plan);
    console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', updated, ...plan.report }, null, 2));
    if (plan.report.mismatches.length) process.exitCode = 1;
  } finally {
    db.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (err) {
    console.error(err instanceof Error ? err.message : 'Economics refresh failed.');
    process.exitCode = 1;
  }
}
