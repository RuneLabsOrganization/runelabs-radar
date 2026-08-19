import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  accuracyMisses,
  calibrationBuckets,
  calibrationPoints,
  forecastGrades,
  gradingSince,
  pendingGrades,
  spearman,
} from '../../src/lib/science/accuracy';
import { envelopeSchema, respond } from '../lib/payload';

export function registerForecastTools(server: McpServer): void {
  server.registerTool(
    'get_forecasts',
    {
      description:
        'Stored forecasts (e.g. frontier-model price 30 days out) graded against what actually happened. Use to judge how much to trust the analytics.',
      inputSchema: {},
      outputSchema: {
        ...envelopeSchema,
        grades: z.array(
          z.object({
            date: z.string(),
            predicted: z.number(),
            realized: z.number().nullable(),
            error_pct: z.number().nullable(),
          }),
        ),
      },
    },
    async () => {
      const grades = forecastGrades().map((g) => ({
        date: g.date,
        predicted: g.predicted,
        realized: g.realized,
        error_pct: g.errorPct,
      }));
      return respond(
        { grades },
        {
          summary: grades.length === 0 ? 'No forecasts recorded yet.' : `${grades.length} forecasts on record.`,
          next: [
            {
              tool: 'get_accuracy',
              arguments: {},
              reason: 'how calibrated the platform is',
            },
          ],
        },
      );
    },
  );

  server.registerTool(
    'get_accuracy',
    {
      description:
        'The platform\'s track record: does a higher signal score actually mean the story mattered? Calibration bands, score/hindsight correlation, biggest over/under-rates, pending grades.',
      inputSchema: {},
      outputSchema: {
        ...envelopeSchema,
        grading_since: z.string().nullable(),
        pending_grades: z.number(),
        spearman: z.number().nullable(),
        calibration: z.array(
          z.object({
            label: z.string(),
            count: z.number(),
            mean_score: z.number(),
            mean_hindsight: z.number().nullable(),
            follow_through_rate: z.number(),
          }),
        ),
        over_rated: z.array(
          z.object({ id: z.number(), title: z.string(), top_score: z.number(), hindsight: z.number() }),
        ),
        under_rated: z.array(
          z.object({ id: z.number(), title: z.string(), top_score: z.number(), hindsight: z.number() }),
        ),
      },
    },
    async () => {
      const pts = calibrationPoints();
      const corr = spearman(
        pts.map((p) => p.score),
        pts.map((p) => p.hindsight),
      );
      const misses = accuracyMisses(3);
      const shape = (m: { id: number; title: string; topScore: number; hindsight: number }) => ({
        id: m.id,
        title: m.title,
        top_score: m.topScore,
        hindsight: m.hindsight,
      });
      const pending = pendingGrades();
      return respond(
        {
          grading_since: gradingSince(),
          pending_grades: pending,
          spearman: corr,
          calibration: calibrationBuckets().map((b) => ({
            label: b.label,
            count: b.count,
            mean_score: b.meanScore,
            mean_hindsight: b.meanHindsight,
            follow_through_rate: b.followThroughRate,
          })),
          over_rated: misses.overRated.map(shape),
          under_rated: misses.underRated.map(shape),
        },
        {
          summary: `${pending} forecasts awaiting grading${corr !== null ? ` — score/hindsight correlation ${corr.toFixed(2)}` : ''}.`,
          next: [
            {
              tool: 'get_forecasts',
              arguments: {},
              reason: 'graded forecasts',
            },
          ],
        },
      );
    },
  );
}
