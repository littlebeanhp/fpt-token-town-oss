import type { ModelDefinition, StopId } from '@/types/factory';

// Seven districts share the central 3x3 block grid. The busiest model takes the middle block and
// is the home camera stop; six others sit on the back/front rows. The left park is a public square.
// The order below is also the tour order: it leaves the hub, runs the back row left to right,
// then returns along the front row right to left. Buildings sit 0.9 units behind their block
// centre, which leaves a front plaza for the visitor queue.
// Usage is this week's reported figure. Context windows and prices come from the serverless
// catalog. The open edition builds every district from primitive shapes; set `assetUrl` on a
// model to load your own GLB house instead (see README, Replace a Factory With a GLB).
export const models: ModelDefinition[] = [
  {
    id: 'deepseek',
    name: 'DeepSeek-V4-Flash',
    brand: 'DeepSeek',
    logo: 'deepseek',
    category: 'Hosted by FPT',
    color: '#4d6bfe',
    position: [0, 0, -0.9],
    usage: 41_822_701_280,
    unit: 'tokens',
    cachedRate: 93,
    contextLength: '200K',
    price: '$0.14/$0.28',
    priceUnit: 'in/out · 1M',
    description:
      'The busiest address in town and the exchange at its centre. Fast-turnaround work lands here first and leaves again as tokens for every other district.',
  },
  {
    id: 'glm',
    name: 'GLM-5.2',
    brand: 'Z.ai',
    logo: 'zhipu',
    category: 'Hosted by FPT',
    color: '#9264df',
    position: [-10, 0, -10.9],
    usage: 17_285_075_544,
    unit: 'tokens',
    cachedRate: 92,
    contextLength: '~1M',
    price: '$1.40/$4.40',
    priceUnit: 'in/out · 1M',
    description:
      "The city's vertical workspace for code and agents. A dedicated route for exploring multi-step, tool-driven workflows.",
  },
  {
    id: 'gemma-26b',
    name: 'gemma-4-26B-A4B-it',
    brand: 'Google',
    logo: 'gemma',
    category: 'Hosted by FPT',
    color: '#2e96ff',
    position: [0, 0, -10.9],
    usage: 6_630_239_654,
    unit: 'tokens',
    cachedRate: 92,
    contextLength: '256K',
    price: '$0.14/$0.40',
    priceUnit: 'in/out · 1M',
    description:
      'A works where only part of the line runs on each order. Open weights with a small active share, built for everyday throughput.',
  },
  {
    id: 'qwen',
    name: 'Qwen3.8-27B',
    brand: 'Alibaba Qwen',
    logo: 'qwen',
    category: 'Hosted by FPT',
    color: '#e16b83',
    position: [10, 0, -10.9],
    usage: 2_824_163_350,
    unit: 'tokens',
    cachedRate: 91,
    contextLength: '262K',
    price: '$0.45/$3.20',
    priceUnit: 'in/out · 1M',
    description:
      'Connected modules, shared possibilities. A flexible district for building across languages and everyday tasks.',
  },
  {
    id: 'tts',
    name: 'FPT.TTS-ultra',
    brand: 'FPT AI',
    logo: 'fpt',
    category: 'Hosted by FPT',
    color: '#e59b24',
    position: [10, 0, 9.1],
    usage: 11_093_062,
    unit: 'characters',
    price: '$50.00/$0.00',
    priceUnit: 'in/out · 1M characters',
    description:
      "The city's recording studio. Text goes in and speech comes out, so the meter here counts characters rather than tokens and nothing is sent back to be read.",
  },
  {
    id: 'llama',
    name: 'Llama-3.3-70B-Instruct',
    brand: 'Meta',
    logo: 'meta',
    category: 'Hosted by FPT',
    color: '#2aab89',
    position: [0, 0, 9.1],
    usage: 1_453_468_630,
    unit: 'tokens',
    cachedRate: 90,
    contextLength: '32K',
    price: '$0.209/$0.451',
    priceUnit: 'in/out · 1M',
    description:
      'An open space for experimentation. A research district for adapting open models to your own ideas.',
  },
  {
    id: 'gemma-31b',
    name: 'gemma-4-31B-it',
    brand: 'Google',
    logo: 'gemma',
    category: 'Hosted by FPT',
    color: '#36c2d4',
    position: [-10, 0, 9.1],
    usage: 2_317_169_746,
    unit: 'tokens',
    cachedRate: 93,
    contextLength: '256K',
    price: '$0.15/$0.45',
    priceUnit: 'in/out · 1M',
    description:
      'The dense half of the Gemma pair, in the same house its sibling keeps on the back row. The whole line runs on every request, for careful instruction following.',
  },
];

/**
 * The speech studio keeps a guide in an FPT shirt standing on its plaza. The mark over their
 * head is the one object in the city that links out, so both the stop and the destination live
 * here rather than being spelled out in the scene and the overlay separately.
 */
export const townHost = {
  stop: 'tts' as StopId,
  link: 'https://linkedin.com/in/jackquesth',
  text: 'meet the creator',
  label: 'Meet the creator of Token Town on LinkedIn',
} as const;

/** The one outbound invitation in the panel, beside the city directory. */
export const gpuFarm = {
  link: 'https://hunyuan3d.altperle.id.vn/',
  label: 'Explore more: Visit GPU farm',
} as const;

/** Tour order for the locked camera. The hub is the default and home stop. */
export const stops: ModelDefinition[] = models;
/** The middle block remains the default camera stop; token routing uses TOKEN_PLAZA. */
export const hubStop: ModelDefinition = models[0];
/** Busiest first, for the city directory and the order the districts are ranked in. */
export const ranked: ModelDefinition[] = [...models].sort((a, b) => b.usage - a.usage);
export const usageIn = (unit: ModelDefinition['unit']) =>
  models.reduce((sum, model) => (model.unit === unit ? sum + model.usage : sum), 0);

/** 41_822_701_280 reads as "41.82B". */
export function formatCompact(usage: number) {
  const units: [number, string][] = [
    [1e12, 'T'],
    [1e9, 'B'],
    [1e6, 'M'],
    [1e3, 'K'],
  ];
  for (const [size, suffix] of units)
    if (usage >= size) return `${(usage / size).toFixed(2)}${suffix}`;
  return `${usage}`;
}
export const formatExact = (usage: number) => usage.toLocaleString('en-US');

/**
 * How busy a district looks on the street. The figures span four orders of magnitude, so a
 * straight ratio would leave six shops deserted; the share is taken on a log scale instead, which
 * keeps the quiet houses visibly shorter without emptying them. Characters and tokens are not the
 * same thing, but the speech studio is the smallest district either way.
 */
const QUIETEST_QUEUE = 0.45;
export function crowdLoad(usage: number) {
  const low = Math.log10(ranked.at(-1)!.usage),
    high = Math.log10(ranked[0].usage);
  const share = high === low ? 1 : (Math.log10(usage) - low) / (high - low);
  return QUIETEST_QUEUE + (1 - QUIETEST_QUEUE) * share;
}
