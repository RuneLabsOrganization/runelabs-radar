# Opportunity generation comparison, 24 November 2026

Each model received the same system message and two public US evidence packets in one call. The first covered merchant analytics and the second consumer scam prevention. Models chose their own buyers and revenue models. The request specified identical hypothetical click costs, conversion, inference rates and retry probability. All three returned two ideas as JSON.

| Model | Input tokens | Output tokens | Wall time | Estimated USD for both ideas |
| --- | ---: | ---: | ---: | ---: |
| MiniMax-M3.1-Flash | 634 | 2,227 | 40.1 s | 0.001431 |
| Claude Sonnet 5.5 | 741 | 3,270 | 26.4 s | 0.034182 |
| Claude Opus 5.5 | 741 | 2,669 | 27.2 s | 0.056344 |

Costs use API-reported tokens and uncached list rates per million input/output tokens of $0.15/$0.60, $2/$10 and $4/$20 respectively. Measurements cover generation only. Each model had a 4,000-token output cap. Flash used its production low reasoning setting and temperature 0.2. Claude used provider defaults. [MiniMax pricing](https://platform.minimax.io/docs/pricing/overview) · [Anthropic models](https://platform.claude.com/docs/en/models/overview)

## Commercial judgment in the responses

- Flash identified consumer and agency offers and correctly computed the illustrative $50 CAC. Its agency revenue formula multiplied the number of stores by a subscription price charged per agency, inflating revenue for multi-store agencies.
- Sonnet identified a credit union as a potential payer for a product its members use. It described the compliance dependency, questioned paid search for this channel and proposed testing institutional interest. It cost 39% less than Opus on this run.
- Opus proposed a $99 wholesale tracking audit with a test of three paid audits from 30 agencies. For the family anti-scam service, it showed that a hypothetical $50 CAC would take at least 8.3 months to recover at $6/month, before expenses and churn.

All three distinguished consumer losses from obtainable revenue and called out missing market counts. These judgments come from reading six proposals on two topics. One sample per model is insufficient to estimate typical latency, predictive quality, or the return on choosing a more expensive model. A paid pilot or customer interview would provide evidence about the proposals themselves.

## Reproduction

Run `node --env-file=.env scripts/compare-opportunity-models.mjs <model-id>` with an appropriate provider key in the environment. The script prints the raw response, token counts, cost, latency, and SHA-256 of the combined prompts. The recorded prompt hash was `896d21cb5d98ad49e421732a600e12e4fd0d3f6089a43dfd7e294ed8660449cb`.

The fixed inputs isolate the generation step from changes in search results. Sources were the [Elevar listing](https://apps.shopify.com/gtm-datalayer-by-elevar), [US Census methodology](https://www.census.gov/programs-surveys/cbp/technical-documentation/methodology.html), [FTC imposter-scam figures](https://www.ftc.gov/news-events/news/press-releases/2026/06/ftc-data-show-people-reported-losing-3-point-5-billion-imposter-scams-2025), and [FTC call-blocking guidance](https://consumer.ftc.gov/consumer-alerts/2025/08/five-ways-help-you-cut-down-unwanted-calls).
