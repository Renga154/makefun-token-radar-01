// The token radar's model: one snapshot of the protocol universe in, one ranked board out.
//
// The board covers every slug in the snapshot's watchlist and every rankable pre-token protocol below
// the watchlist floor, by TVL. Pre-token means the index records no market cap, no CoinGecko id and no
// symbol. Protocols with a token never enter the ranking; they only calibrate the multiples below.
//
//   implied_value_usd = max(1, round(tvl_usd x base_multiple x growth_factor x age_factor x chain_factor))
//
//   base_multiple   What one dollar of TVL is worth as token value, per CATEGORY FAMILY (FAMILIES below).
//                   Each family states a prior: high where TVL is small collateral behind large flow
//                   (perps), low where TVL is someone else's capital passing through (curators, staking).
//                   The prior is then pulled toward evidence: the median mcap_usd / tvl_usd of the same
//                   family's live-token protocols in this snapshot, winsorized to [prior/3, prior x 3]
//                   and blended geometrically by sample size n:
//                     w = n / (n + 8);  base_multiple = prior^(1-w) x observed^w
//                   With no live comparable w = 0 and the prior stands. The prior is a judgement call;
//                   prior, observed median, n and w are all carried on the row.
//   growth_factor   1 + 0.5 x clamp(change_7d, -40, 60) / 100   (null: 0). One week is noisy, so half
//                   weight; the clamp stops a migration (+4448%) from dominating. Range 0.80 .. 1.30.
//   age_factor      0.70 + 0.45 x min(age_days, 730) / 730   (age unknown: 365 days). Longer listed and
//                   still tokenless reads as more launch-ready; saturates at two years. 0.70 .. 1.15.
//   chain_factor    1 + 0.05 x log2(min(chain_count, 16)). Wider deployment widens the user base, with
//                   diminishing returns. Range 1.00 .. 1.20.
//
// Every factor is rounded to 4 places BEFORE multiplying, so a page can reproduce the value exactly.
// This is a heuristic fully diluted estimate, conditional on a token launching: it is neither a price
// target nor a launch probability. No protocol name or slug is ever special-cased.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them and the sandbox may change them. */
export interface ModelConstants {
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  chain_weight: number;
  chain_cap: number;
  shrink_n: number;
  winsor: number;
}

export const MODEL: ModelConstants = {
  growth_weight: 0.5,
  growth_floor: -40,
  growth_cap: 60,
  maturity_floor: 0.7,
  maturity_range: 0.45,
  maturity_days: 730,
  unknown_age_days: 365,
  chain_weight: 0.05,
  chain_cap: 16,
  shrink_n: 8,
  winsor: 3,
};

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-2';

/** The most early rows below the watchlist floor, by TVL: with the watchlist of 40, at most 300 rows. */
export const EARLY_ROWS = 260;

/** The least TVL an early row may have. */
export const EARLY_MIN_TVL = 5_000_000;

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** A category family: the categories it covers, its prior value per TVL dollar, and why. */
export interface Family {
  id: string;
  categories: string[];
  prior: number;
  why: string;
}

export const FAMILIES: Family[] = [
  { id: 'perp', categories: ['Derivatives'], prior: 1.0, why: 'Margin is small next to the fee-paying volume it supports.' },
  { id: 'prediction', categories: ['Prediction Market'], prior: 0.9, why: 'Open interest understates fee-bearing turnover.' },
  { id: 'options', categories: ['Options', 'Options Vault'], prior: 0.5, why: 'Premium income on collateral, with thinner volume than perps.' },
  { id: 'rates', categories: ['Interest Rate Derivatives'], prior: 0.6, why: 'Leveraged notional on small margin, in a young market.' },
  { id: 'chain', categories: ['Chain'], prior: 0.6, why: 'A network token also prices blockspace and security.' },
  { id: 'payments', categories: ['Payments', 'Crypto Card Issuer'], prior: 0.3, why: 'Payment float turns over, but take rates are thin.' },
  { id: 'privacy', categories: ['Privacy'], prior: 0.4, why: 'Small pools with specialised demand.' },
  { id: 'dex', categories: ['Dexs'], prior: 0.35, why: 'Pools turn over and fees are directly capturable.' },
  { id: 'lending', categories: ['Lending', 'Collateral Markets', 'Collateral Management'], prior: 0.22, why: 'Reserve factors capture part of the borrow interest.' },
  { id: 'credit', categories: ['Uncollateralized Lending'], prior: 0.25, why: 'Wider spreads than secured lending, with more credit risk.' },
  { id: 'cdp', categories: ['CDP', 'Dual-Token Stablecoin'], prior: 0.25, why: 'Stability fees accrue to the issuer.' },
  { id: 'stable', categories: ['Stablecoin Wrapper'], prior: 0.15, why: 'A share of reserve or strategy yield on wrapped dollars.' },
  { id: 'basis', categories: ['Basis Trading', 'CeDeFi'], prior: 0.25, why: 'Performance fees on a yield that fades with funding rates.' },
  { id: 'yield', categories: ['Yield', 'Farm', 'Yield Aggregator', 'Indexes', 'Governance Incentives'], prior: 0.16, why: 'Performance fees on deposits that can move easily.' },
  { id: 'leveraged', categories: ['Leveraged Farming'], prior: 0.18, why: 'Borrow and performance fees on looped capital.' },
  { id: 'lpmanager', categories: ['Liquidity Manager'], prior: 0.1, why: 'A fee on another venue\'s fees.' },
  { id: 'rwa', categories: ['RWA'], prior: 0.15, why: 'Management fees of tens of basis points on sticky assets.' },
  { id: 'insurance', categories: ['Insurance'], prior: 0.3, why: 'Capital pools earn premiums, with loss risk.' },
  { id: 'restaking', categories: ['Restaking', 'Liquid Restaking', 'Restaked BTC'], prior: 0.12, why: 'A commission on rewards that are still small.' },
  { id: 'bridge', categories: ['Bridge', 'Cross Chain Bridge'], prior: 0.15, why: 'Locked value earns only when it moves.' },
  { id: 'canonical', categories: ['Canonical Bridge'], prior: 0.2, why: 'A proxy for the network behind the bridge, not for bridge fees.' },
  { id: 'btc', categories: ['Anchor BTC', 'Decentralized BTC'], prior: 0.1, why: 'Custodied or wrapped BTC carries minting fees only.' },
  { id: 'lst', categories: ['Liquid Staking'], prior: 0.06, why: 'A commission on a few per cent of staking yield.' },
  { id: 'pool', categories: ['Staking Pool'], prior: 0.04, why: 'Validator commission, with little need for a token.' },
  { id: 'vault', categories: ['Onchain Capital Allocator'], prior: 0.08, why: 'Vault infrastructure fees; TVL is counted again downstream.' },
  { id: 'curator', categories: ['Risk Curators'], prior: 0.04, why: 'A fee on capital that sits inside other lending markets.' },
];

const OTHER: Family = { id: 'other', categories: [], prior: 0.12, why: 'No matching family: a conservative default.' };
const FAMILY_OF = new Map(FAMILIES.flatMap((f) => f.categories.map((c): [string, Family] => [c, f])));

/** The family a category belongs to. */
export function familyOf(category: string | null): Family {
  return FAMILY_OF.get(category ?? '') ?? OTHER;
}

/** A family's multiple with the evidence behind it. */
export interface Calibration {
  family: string;
  prior: number;
  why: string;
  observed_median: number | null;
  observed_n: number;
  evidence_weight: number;
  base_multiple: number;
}

/** Every family's base multiple: its prior, blended with the snapshot's live-token mcap/TVL median. */
export function calibrate(snapshot: Snapshot, model: ModelConstants = MODEL): Map<string, Calibration> {
  const out = new Map<string, Calibration>();
  for (const f of [...FAMILIES, OTHER]) {
    const ratios = f === OTHER ? [] : snapshot.protocols
      .filter((p) => familyOf(p.category) === f && p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0)
      .map((p) => p.mcap_usd! / p.tvl_usd)
      .sort((a, b) => a - b);
    const n = ratios.length;
    const mid = n >> 1;
    const median = n === 0 ? null : n % 2 === 1 ? ratios[mid]! : (ratios[mid - 1]! + ratios[mid]!) / 2;
    const w = n / (n + model.shrink_n);
    const observed = median === null ? f.prior : Math.min(f.prior * model.winsor, Math.max(f.prior / model.winsor, median));
    out.set(f.id, {
      family: f.id,
      prior: f.prior,
      why: f.why,
      observed_median: median === null ? null : round4(median),
      observed_n: n,
      evidence_weight: round4(w),
      base_multiple: round4(Math.exp((1 - w) * Math.log(f.prior) + w * Math.log(observed))),
    });
  }
  return out;
}

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** The factor breakdown every row shows. */
export interface Factors {
  family: string;
  base_multiple: number;
  growth_pct: number;
  growth_factor: number;
  age_factor: number;
  chain_factor: number;
  chain_count: number;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow extends Factors {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  on_watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  base_value_usd: number;
  multiple_basis: Calibration;
  farm_steps: string[];
}

/** The dashboard's view of one row: the factors and the same farm steps board.json carries. */
export interface RadarRow extends Factors {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  on_watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  families: Calibration[];
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The factors and the implied value one protocol gets under `model`. */
export function impliedValue(p: SnapshotProtocol, asOf: string, base: Calibration, model: ModelConstants): { implied: number; age: number | null; factors: Factors } {
  const age = ageDays(asOf, p.listed_at);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, finite(p.change_7d, 0)));
  const growth = round4(1 + (growthPct / 100) * model.growth_weight);
  const ageUsed = Math.min(age ?? model.unknown_age_days, model.maturity_days);
  const ageFactor = round4(model.maturity_floor + (ageUsed / model.maturity_days) * model.maturity_range);
  const count = new Set(p.chains).size;
  const chain = round4(1 + model.chain_weight * Math.log2(Math.min(model.chain_cap, Math.max(1, count))));
  const implied = Math.max(1, Math.round(p.tvl_usd * base.base_multiple * growth * ageFactor * chain));
  return {
    implied,
    age,
    factors: { family: base.family, base_multiple: base.base_multiple, growth_pct: growthPct, growth_factor: growth, age_factor: ageFactor, chain_factor: chain, chain_count: count },
  };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol is one the board may rank: pre-token, not an exchange, not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The headline sentence's figures: how many watchlist slugs, how many rows, how many live protocols. */
export interface BoardSummary {
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug, even one the snapshot no longer carries (it cannot, but the
  // board's coverage is the gate's row and is never gambled on a missing record).
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: pre-token protocols below the watchlist floor, by TVL, capped. Never a replacement
  // for a watchlist row: a chosen protocol stays chosen.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd && p.tvl_usd >= EARLY_MIN_TVL)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, EARLY_ROWS);
  for (const p of early) chosen.set(p.slug, p);

  const multiples = calibrate(snapshot, model);
  const watch = new Set(snapshot.watchlist);
  const scored = [...chosen.values()].map((p) => {
    const basis = multiples.get(familyOf(p.category).id)!;
    return { p, basis, ...impliedValue(p, snapshot.as_of, basis, model) };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    on_watchlist: watch.has(s.p.slug),
    age_days: s.age,
    implied_value_usd: s.implied,
    base_value_usd: Math.round(s.p.tvl_usd * s.basis.base_multiple),
    ...s.factors,
    multiple_basis: s.basis,
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A step as one string: its action, then its cost and time. boardIssue enforces the 20..600 length. */
export function stepText(step: FarmStep): string {
  return `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
}

/** A dollar figure with separators, without locale data. */
const num = (n: number): string => String(Math.round(n)).replace(/\B(?=(\d{3})+$)/g, ',');
const money = (n: number): string => (n >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : `$${num(n)}`);

/** Planning ranges for one transaction's network fee; these are assumptions, not snapshot figures. */
function gasFor(chain: string): [number, number] {
  if (chain === 'Ethereum') return [3, 15];
  if (chain === 'Bitcoin') return [2, 10];
  if (chain === 'Tron') return [1, 4];
  return [0.05, 1];
}

/** The native coin of the common chains; others are described. */
const NATIVE: Record<string, string> = {
  Ethereum: 'ETH', Base: 'ETH', Arbitrum: 'ETH', Ink: 'ETH', Bitcoin: 'BTC', Solana: 'SOL', Binance: 'BNB', Tron: 'TRX', TON: 'TON',
  Avalanche: 'AVAX', Monad: 'MON', Polygon: 'POL', Sui: 'SUI', Aptos: 'APT', Stellar: 'XLM', Ripple: 'XRP', Algorand: 'ALGO',
  Flare: 'FLR', Starknet: 'STRK', Cronos: 'CRO', XDC: 'XDC', 'Hyperliquid L1': 'HYPE', Bittensor: 'TAO', Chiliz: 'CHZ',
  Qubic: 'QU', WEMIX: 'WEMIX',
};

/** Capital ranges by TVL band: the smaller the pool, the less a tester should expose to it. */
function capitalFor(tvl: number): [number, number] {
  if (tvl >= 500_000_000) return [500, 2000];
  if (tvl >= 100_000_000) return [300, 1500];
  if (tvl >= 20_000_000) return [200, 1000];
  return [100, 500];
}

/** How many weeks to stay: younger protocols get a longer window. */
function weeksFor(age: number | null): number {
  return age === null ? 8 : age < 180 ? 12 : age < 540 ? 8 : 6;
}

/** What a category's template may use, all derived from the row's own record. */
interface PlanContext {
  name: string;
  chain: string;
  second: string | null;
  native: string;
  size: (share: number) => string;
  fees: (transactions: number) => string;
  weeks: number;
}

const step = (text: string, cost: string, time: string): FarmStep => ({ text, cost, time });

type Template = (c: PlanContext) => FarmStep[];

/** A deposit template's three steps, for families that differ in asset, venue and duty. */
const TEMPLATES: Record<string, Template> = {
  dex: (c) => [
    step(`Swap ${c.size(0.2)} between two liquid assets on ${c.name} (${c.chain}), directly or by choosing it in an aggregator route, with slippage capped at 0.5%.`, `${c.fees(1)} in network fees plus 0.05-0.5% in swap fees`, '15 minutes'),
    step(`Provide ${c.size(1)} of liquidity on ${c.chain} via ${c.name}'s deepest public pool, preferring a stable pair or a wide range; if pools are not open to the public, keep to swaps.`, `${c.fees(3)} in network fees; impermanent loss is the main risk`, '30 minutes to set up'),
    step(`Check the range and fee income weekly, and make one ordinary swap of ${c.size(0.1)} each week you need the trade for ${c.weeks} weeks.`, `${c.fees(1)} per week plus swap fees`, '15 minutes a week'),
  ],
  lending: (c) => [
    step(`Supply ${c.size(1)} of a listed stablecoin or ${c.native} to the largest ${c.name} market on ${c.chain}, after checking utilisation is below 90%.`, `${c.fees(2)} in network fees; capital stays withdrawable while utilisation allows`, '20 minutes'),
    step(`Borrow ${c.size(0.2)} against that collateral, keeping loan-to-value under 25%, and hold the debt as a small genuine position.`, `${c.fees(2)} plus the quoted borrow APR, often 3-10% a year on the loan`, '15 minutes'),
    step(`Check health factor and rates weekly; repay part of the loan and re-supply once a month for ${c.weeks} weeks.`, `${c.fees(2)} per month`, '10 minutes a week'),
  ],
  credit: (c) => [
    step(`Read ${c.name}'s borrower, default and redemption terms, then supply ${c.size(0.5)} of the accepted stablecoin to its senior or lowest-risk tranche on ${c.chain}.`, `${c.fees(2)} in network fees; principal is exposed to borrower default`, '60 minutes'),
    step(`Hold the receipt token for ${c.weeks} weeks and compare the paid yield with the advertised rate.`, 'no new spend; capital stays committed', '15 minutes a week'),
    step(`Request one small redemption of ${c.size(0.1)} to test the exit queue before adding to the position.`, c.fees(1), '15 minutes, plus the queue'),
  ],
  cdp: (c) => [
    step(`Open a ${c.name} vault on ${c.chain} with ${c.size(1)} of accepted collateral, choosing the collateral type with the deepest liquidity.`, `${c.fees(2)} in network fees; liquidation is the main risk`, '25 minutes'),
    step(`Mint ${c.size(0.25)} of its stablecoin and keep the collateral ratio above 300%; if a minimum debt is higher than that, buy the stablecoin instead.`, `${c.fees(1)} plus 0-1% minting and 1-8% yearly stability fees`, '15 minutes'),
    step(`Place the stablecoin in the protocol's savings or stability pool where one exists, for ${c.weeks} weeks, and check the peg and ratio weekly.`, `${c.fees(2)} to enter and exit`, '15 minutes, then 10 minutes a week'),
  ],
  stable: (c) => [
    step(`Convert ${c.size(1)} of an accepted stablecoin into ${c.name}'s token on ${c.chain} through its official mint or wrapper, checking eligibility first.`, `${c.fees(2)} plus 0-0.3% conversion cost`, '20 minutes'),
    step(`Hold or stake the wrapped balance for ${c.weeks} weeks, and note the backing report and market price each week.`, `${c.fees(1)} to stake; depeg risk on the balance`, '10 minutes a week'),
    step(`Redeem ${c.size(0.1)} once to confirm the published exit route and delay work.`, c.fees(1), '15 minutes, plus any cooldown'),
  ],
  basis: (c) => [
    step(`Mint or deposit ${c.size(1)} into ${c.name}'s market-neutral product on ${c.chain}, after reading where the hedge and custody sit.`, `${c.fees(2)} plus 0-0.2% entry cost`, '40 minutes'),
    step(`Stake the receipt for ${c.weeks} weeks if the cooldown is 14 days or less; otherwise keep it liquid.`, `${c.fees(1)}; exposed to negative funding and custodian risk`, '10 minutes'),
    step('Compare the paid yield with major-exchange funding rates weekly, and leave if yield is paid while funding stays negative for two weeks.', `${c.fees(1)} to exit`, '15 minutes a week'),
  ],
  yield: (c) => [
    step(`Deposit ${c.size(1)} into ${c.name}'s largest stablecoin or ${c.native} strategy on ${c.chain}, checking the withdrawal delay before signing.`, `${c.fees(2)} in network fees; strategy fees are often 5-20% of yield`, '25 minutes'),
    step(`Keep the share token for ${c.weeks} weeks; log share price and quoted APY weekly and treat reward APY separately from paid yield.`, 'no new spend; strategy loss risk', '10 minutes a week'),
    step(`At week ${Math.ceil(c.weeks / 2)}, withdraw ${c.size(0.1)} and redeposit it to confirm that the exit works.`, c.fees(2), '20 minutes'),
  ],
  leveraged: (c) => [
    step(`Deposit ${c.size(0.5)} in ${c.name}'s lowest-leverage strategy on ${c.chain}, keeping effective leverage at 2x or below.`, `${c.fees(2)} plus the borrow APR`, '30 minutes'),
    step('Record the liquidation price and set an alert 15% before it, then compare borrow cost with strategy yield.', 'free with a portfolio tracker', '20 minutes'),
    step(`Review net carry twice a week for ${c.weeks} weeks and unwind when it stays negative for three days.`, `${c.fees(2)} to unwind`, '20 minutes a week'),
  ],
  lpmanager: (c) => [
    step(`Deposit ${c.size(1)} in a ${c.name} managed vault on ${c.chain}, starting with a correlated pair.`, `${c.fees(3)} in network fees plus a share of LP fees`, '30 minutes'),
    step(`Compare the vault with simply holding both assets each week for ${c.weeks} weeks, counting impermanent loss.`, 'free to monitor', '15 minutes a week'),
    step(`Move ${c.size(0.25)} to a second managed range after two weeks if the first one trails holding by more than 2%.`, c.fees(3), '20 minutes'),
  ],
  curator: (c) => [
    step(`Find the vaults that name ${c.name} as curator on ${c.chain}, and compare collateral lists, caps and timelocks before choosing one.`, 'free research', '40 minutes'),
    step(`Deposit ${c.size(1)} of the vault's asset in the most liquid of them and verify the curator address on its official site.`, `${c.fees(2)} in network fees; performance fees are often 5-15% of yield`, '20 minutes'),
    step(`Hold for ${c.weeks} weeks and read each allocation or cap change${c.second ? `; compare the same curator's vault on ${c.second}` : ''}. The host market and not the curator may issue any reward.`, `${c.fees(1)} to exit`, '15 minutes a week'),
  ],
  vault: (c) => [
    step(`Pick a ${c.name} vault on ${c.chain} with a named manager, a public strategy and a redemption window under 14 days.`, 'free research', '35 minutes'),
    step(`Deposit ${c.size(1)} and save the share price and the manager's fee terms.`, `${c.fees(2)} in network fees; fees are often 0-2% a year plus 10-20% of profit`, '20 minutes'),
    step(`Hold for ${c.weeks} weeks${c.second ? `, then test a ${c.size(0.2)} deposit on ${c.second} if that vault is open` : ''}, and reconcile share price with strategy reports.`, `${c.fees(2)} for changes`, '15 minutes a week'),
  ],
  rwa: (c) => [
    step(`Check ${c.name}'s jurisdiction, identity and minimum-ticket rules before funding a wallet; stop if you are not eligible.`, 'free, though identity checks may be required', '30-60 minutes'),
    step(`Buy ${c.size(1)} of its asset on ${c.chain}, or the smallest ticket if that is higher and within your own limit.`, `${c.fees(2)} plus 0-1% issue or market spread`, '30 minutes'),
    step(`Hold for ${c.weeks} weeks, reading the reserve or property report and net asset value as each is published.`, 'no new spend; redemption can take days', '20 minutes a month'),
  ],
  perp: (c) => [
    step(`Deposit ${c.size(0.5)} of accepted margin to ${c.name} on ${c.chain} and withdraw ${c.size(0.05)} once to test the exit.`, `${c.fees(3)} in network fees`, '25 minutes'),
    step(`Open one BTC or ETH position of ${c.size(0.3)} notional at 1-2x with a stop, using limit orders; do not trade against yourself for volume.`, 'about 0.02-0.07% per side plus funding; trading loss is the main risk', '30 minutes'),
    step(`Make one or two intended trades weekly for ${c.weeks} weeks; place ${c.size(0.3)} in the public liquidity vault if one exists.`, 'expect $1-10 a week in fees at this size', '45 minutes a week'),
  ],
  rates: (c) => [
    step(`Deposit ${c.size(0.5)} of collateral to ${c.name} on ${c.chain} and read how its rate contract settles.`, c.fees(2), '45 minutes'),
    step(`Take one rate position at no more than 1.5x margin use, matched to a funding or yield exposure you already hold.`, 'trading fees near 0.05-0.2% of rate notional; rate moves can liquidate', '30 minutes'),
    step(`Check the implied and realised rates twice a week through one maturity or ${c.weeks} weeks.`, `${c.fees(1)} to close or roll`, '20 minutes a week'),
  ],
  options: (c) => [
    step(`Deposit ${c.size(0.5)} in ${c.name}'s covered strategy on ${c.chain} after reading strike selection and settlement.`, c.fees(2), '35 minutes'),
    step(`Stay through ${Math.ceil(c.weeks / 2)} expiry cycles and log premium against assignment loss.`, 'no new spend; capped upside and drawdown risk', '15 minutes a week'),
    step('Withdraw one tenth between expiries to test the queue.', c.fees(1), '15 minutes'),
  ],
  prediction: (c) => [
    step(`Check that ${c.name} is available where you live, then fund ${c.size(0.5)} on ${c.chain}.`, c.fees(2), '25 minutes'),
    step(`Place limit orders of ${c.size(0.05)} in three liquid markets you have researched; do not take both sides for volume.`, '0-2% fees or spread; each stake can go to zero', '60 minutes'),
    step(`Trade one new market a week for ${c.weeks} weeks and leave resting orders where maker rewards are published.`, `${c.size(0.05)} at risk per market`, '45 minutes a week'),
  ],
  bridge: (c) => [
    step(`Send ${c.size(0.1)} through ${c.name} from ${c.chain}${c.second ? ` to ${c.second}` : ' to a destination its official app supports'} as a test before any larger transfer; if minting is limited to institutions, buy the bridged asset instead.`, `${c.fees(2)} plus 0.05-0.3% bridge cost`, '20-60 minutes including settlement'),
    step(`Move ${c.size(0.5)} by the same route only when you need funds there, then supply or hold the bridged asset in an established venue.`, `${c.fees(3)} plus bridge cost and wrapped-asset risk`, '45 minutes'),
    step(`Make one useful round trip a month for ${Math.ceil(c.weeks / 4)} months, recording transaction ids on both chains.`, `${c.fees(2)} plus bridge cost per trip`, '30 minutes a month'),
  ],
  canonical: (c) => [
    step(`Deposit ${c.size(0.3)} of ETH or a listed asset through ${c.name} from ${c.chain} using the link in the network's own documentation.`, `${c.fees(2)} in network fees`, '15 minutes, plus up to an hour for settlement'),
    step(`Use the destination network for one swap, one lending deposit and one transfer, as any reward would likely follow network use and not the bridge itself.`, '$0.50-5 across three transactions', '45 minutes'),
    step(`Return every other week for ${c.weeks} weeks, then test a ${c.size(0.05)} withdrawal and note the challenge period.`, `${c.fees(2)} for the withdrawal claim`, '20 minutes per visit; withdrawals may take 7 days'),
  ],
  btc: (c) => [
    step(`Read ${c.name}'s signer, custody and redemption design, then mint or buy ${c.size(0.5)} of its BTC asset on ${c.second ?? c.chain}.`, `${c.fees(2)} plus 0.1-0.5% mint or spread cost`, '45 minutes, plus confirmations'),
    step(`Hold it or place it in one established lending venue for ${c.weeks} weeks, without borrowing against it.`, 'no leverage cost; custody and peg risk', '15 minutes a week'),
    step(`Redeem ${c.size(0.1)} to native BTC, or sell that amount if redemption has a higher minimum.`, '$2-15 in Bitcoin and protocol fees', '30-90 minutes'),
  ],
  lst: (c) => [
    step(`Stake ${c.size(1)} of ${c.native} through ${c.name} on ${c.chain} and confirm the receipt token's contract on its official site.`, `${c.fees(2)} in network fees; commission is often 5-10% of rewards`, '15 minutes'),
    step(`Hold the receipt for ${c.weeks} weeks, or place ${c.size(0.3)} of it in an established ${c.chain} lending market without looping.`, `${c.fees(2)}; discount and contract risk`, '20 minutes, then 5 minutes a week'),
    step(`Unstake ${c.size(0.1)} by the native queue and compare it with the market discount.`, c.fees(2), '10 minutes, plus the unbonding period'),
  ],
  pool: (c) => [
    step(`Delegate ${c.size(1)} of the accepted staking asset to ${c.name} on ${c.chain}, after checking commission, uptime and lock-up.`, `${c.fees(1)} in network fees plus validator commission`, '20 minutes'),
    step(`Claim or compound rewards monthly for ${c.weeks} weeks and take part in one governance vote where delegators may vote.`, `${c.fees(1)} per action`, '10 minutes a month'),
    step(`Undelegate ${c.size(0.1)} to learn the exit delay.`, c.fees(1), '10 minutes, plus the unbonding period'),
  ],
  restaking: (c) => [
    step(`Deposit ${c.size(1)} of the accepted asset through ${c.name} on ${c.chain} after reading the slashing terms and the operator list.`, `${c.fees(2)} in network fees`, '30 minutes'),
    step(`Choose an operator or vault with several months of uptime where delegation is offered, and hold for ${c.weeks} weeks.`, `${c.fees(1)}; slashing and receipt-token risk`, '20 minutes, then 10 minutes a week'),
    step(`Queue a ${c.size(0.1)} withdrawal to time the exit before considering more capital.`, c.fees(2), '15 minutes, plus a queue of days or weeks'),
  ],
  insurance: (c) => [
    step(`Read ${c.name}'s claim triggers and exclusions, then deposit ${c.size(0.5)} in its cover pool on ${c.chain} if public deposits are open.`, `${c.fees(2)}; covered losses can consume the deposit`, '60 minutes'),
    step(`Buy a ${c.weeks}-week cover for a position you already hold, where a listed policy fits it.`, 'roughly 1-5% a year of the covered amount', '20 minutes'),
    step('Review claims, pool utilisation and cooldown every week.', 'free to monitor', '15 minutes a week'),
  ],
  payments: (c) => [
    step(`Fund a ${c.size(0.3)} spending balance for ${c.name} on ${c.chain}, through an official wallet or app, after checking country availability.`, c.fees(2), '30 minutes, longer if identity checks apply'),
    step(`Use it for two ordinary payments a week for ${c.weeks} weeks, keeping the remaining balance small.`, '$0.01-2 in fees per payment on top of your normal spending', '10 minutes a week'),
    step(`Where you can provide liquidity or run a node, commit ${c.size(0.5)} and measure routed fees; otherwise skip this step.`, `${c.fees(2)} to open and close`, '1-3 hours to set up'),
  ],
  privacy: (c) => [
    step(`Check the legal position where you live, then make one ${c.size(0.1)} deposit to ${c.name} on ${c.chain}.`, c.fees(2), '30 minutes'),
    step(`Withdraw it through the compliant route and keep the records after the recommended waiting time.`, `${c.fees(2)} plus relayer fees`, '20 minutes'),
    step(`Repeat only for a genuine need, at most monthly for ${c.weeks} weeks.`, c.fees(2), '20 minutes a month'),
  ],
  chain: (c) => [
    step(`Set up the official wallet for ${c.name} and bring ${c.size(0.5)} in from ${c.chain} through the documented bridge or staking page.`, `${c.fees(2)} in network fees`, '30 minutes'),
    step(`Use two established applications on the network: one swap and one deposit or delegation of ${c.size(0.2)}.`, '$0.50-5 in network fees', '40 minutes'),
    step(`Return weekly for ${c.weeks} weeks for one useful transaction, and vote or delegate where it is open to holders.`, 'under $2 a week', '15 minutes a week'),
  ],
};

/** A protocol's farm plan: five steps from its category, chains, TVL band, age and weekly change. */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = p.chains[0] ?? 'its main chain';
  const [gasLow, gasHigh] = gasFor(chain);
  const [low, high] = capitalFor(p.tvl_usd);
  const size = (share: number): string => `$${num(low * share)}-${num(high * share)}`;
  const fee = (n: number): string => (n < 1 ? n.toFixed(2) : String(Math.round(n)));
  const c: PlanContext = {
    name: p.name,
    chain,
    second: p.chains[1] ?? null,
    native: NATIVE[chain] ?? "the chain's native coin",
    size,
    fees: (n) => `~$${fee(gasLow * n)}-${fee(gasHigh * n)}`,
    weeks: weeksFor(age),
  };
  const change = p.change_7d;
  const start = change === null
    ? "The snapshot has no weekly TVL change for it, so check the TVL history, the audit and any points terms before funding."
    : change <= -10
    ? `TVL fell ${Math.abs(change).toFixed(1)}% in the snapshot week, so fund half of the low end first and wait a week.`
    : change >= 20
      ? `TVL rose ${change.toFixed(1)}% in the snapshot week, so check whether incentives or one depositor drove it before funding.`
      : 'Weekly TVL is not flashing a warning, but read the audit and any points terms before funding.';
  const prepare = step(`Open ${p.name} from its official documentation, use one dedicated wallet and make sure no token has been announced already. ${start}`, 'free, plus a few dollars of gas money', '30 minutes');
  const family = familyOf(p.category).id;
  const template = TEMPLATES[family] ?? TEMPLATES.yield!;
  const review = step(`Review the position after ${c.weeks} weeks: log dates, transaction ids and net cost, and exit early if TVL drops under ${money(p.tvl_usd * 0.7)} (30% below the snapshot's ${money(p.tvl_usd)}). No reward is promised.`, `${c.fees(2)} to exit`, '20 minutes');
  return [prepare, ...template(c), review];
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js, with board.json's own farm steps. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    on_watchlist: row.on_watchlist,
    family: row.family,
    base_multiple: row.base_multiple,
    growth_pct: row.growth_pct,
    growth_factor: row.growth_factor,
    age_factor: row.age_factor,
    chain_factor: row.chain_factor,
    chain_count: row.chain_count,
    growth_multiplier: row.growth_factor,
    maturity_multiplier: row.age_factor,
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    families: [...calibrate(snapshot, model).values()],
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  if (slugs.size !== board.length) return 'the board repeats a slug';
  const known = bySlug(snapshot.protocols);
  for (const r of board) {
    const p = known.get(r.slug);
    if (p === undefined) return `${r.slug} is not in the snapshot`;
    if (!isPreToken(p)) return `${r.slug} already has a token`;
  }
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
