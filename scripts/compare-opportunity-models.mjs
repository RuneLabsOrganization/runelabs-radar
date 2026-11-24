/** Paid, manual comparison. One call per model with the same public evidence packet.
 * Run: node --env-file=.env scripts/compare-opportunity-models.mjs <model-id>
 * Keys are read from the process environment. Outputs contain only public scenario data.
 */
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';

const models = {
  'MiniMax-M3.1-Flash': { input: 0.15, output: 0.6 },
  'claude-opus-5-5': { input: 4, output: 20 },
  'claude-sonnet-5-5': { input: 2, output: 10 },
};
const model = process.argv[2];
if (!Object.hasOwn(models, model)) throw Error('Specify one of: ' + Object.keys(models).join(', '));
const system = 'You scout actionable US commercial opportunities for a 1-2 person team. Return only a JSON object with an ideas array. Use only the supplied facts. Be concise.';
const prompt = `Develop one opportunity per evidence packet (2 ideas total). Choose the buyer, end user and business model independently for each. For each provide title, payer, differentiation vs existing alternatives, reachable market calculation or explicit missing inputs, acquisition channel and conditional CAC, pilot days and dependencies, USD inference cost per successful task, pricing hypothesis, and a cheap falsification test with threshold. Label observations, assumptions and unknowns. Cite the packet IDs wherever relying on observations. Separate reported loss from reachable revenue. Do not invent market counts or CAC measurements.
A. Merchant analytics. [A1] Elevar lists server-side tracking, monitoring and alerts. Base includes 100 orders/month free ($0.75 per extra order); Core is $225/month including 2,000 orders. https://apps.shopify.com/gtm-datalayer-by-elevar
[A2] Census County Business Patterns counts employer establishments by industry and size. This packet contains no count of Shopify merchants. https://www.census.gov/programs-surveys/cbp/technical-documentation/methodology.html
B. Consumer scam prevention. [B1] FTC received over one million imposter-scam reports in 2025, reported losses over $3.5 billion. https://www.ftc.gov/news-events/news/press-releases/2026/06/ftc-data-show-people-reported-losing-3-point-5-billion-imposter-scams-2025
[B2] FTC describes call-blocking apps including free options and advises hanging up and reporting unwanted calls. https://consumer.ftc.gov/consumer-alerts/2025/08/five-ways-help-you-cut-down-unwanted-calls
Both: use illustrative inference rates $1/M input and $5/M output tokens and a 10% retry probability (retry until success); choose and disclose tokens. If estimating paid acquisition, use a scenario $1/click and 2% click-to-paying conversion, not observed CAC. Limit total answer to 750 words.`;
const flash = model === 'MiniMax-M3.1-Flash';
const key = process.env[flash ? 'MINIMAX_API_KEY' : 'ANTHROPIC_API_KEY'];
if (!key) throw Error('Provider credential missing');
const started = performance.now();
const credentials = flash
  ? { authorization: `Bearer ${key}` }
  : { 'x-api-key': key, 'anthropic-version': '2023-06-01' };
const messages = [{ role: 'user', content: prompt }];
const endpoint = flash
  ? 'https://api.minimax.io/v1/chat/completions'
  : 'https://api.anthropic.com/v1/messages';
const body = flash
  ? { model, max_tokens: 4000, temperature: 0.2, reasoning_effort: 'low', messages: [{ role: 'system', content: system }, ...messages] }
  : { model, max_tokens: 4000, system, messages };
const response = await fetch(endpoint, {
  method: 'POST',
  redirect: 'error',
  signal: AbortSignal.timeout(150000),
  headers: { ...credentials, 'content-type': 'application/json' },
  body: JSON.stringify(body),
});
if (!response.ok) throw Error(`${model} HTTP ${response.status}`);
const data = await response.json();
if (data.base_resp?.status_code) throw Error(`MiniMax error ${data.base_resp.status_code}`);
const raw = flash
  ? data.choices?.[0]?.message?.content
  : data.content.filter(block => block.type === 'text').map(block => block.text).join('');
const answer = raw.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, '').trim();
const input = data.usage.input_tokens ?? data.usage.prompt_tokens;
const output = data.usage.output_tokens ?? data.usage.completion_tokens;
const uncachedUsd = (input * models[model].input + output * models[model].output) / 1e6;
console.log(JSON.stringify({
  model, input, output, uncachedUsd,
  seconds: (performance.now() - started) / 1000,
  packetHash: createHash('sha256').update(system + '\n' + prompt).digest('hex'),
  answer: JSON.parse(answer),
}, null, 2));
