# Credit Card Payoff Calculator Engine

A standalone, deterministic credit card debt payoff calculator written in TypeScript. Models 4 strategies (avalanche, snowball, hybrid, balance transfer) with month-by-month amortization across N cards.

**Powers**: [ccpayoffcalc.com](https://ccpayoffcalc.com) — the free, no-signup payoff calculator with side-by-side strategy comparison.

## Why this exists

Most "credit card payoff calculator" libraries on npm are abandoned (last published 5+ years ago), Excel-derived ports with no test coverage, or paywalled. This is the production engine behind [ccpayoffcalc.com](https://ccpayoffcalc.com), open-sourced under MIT.

If you're building a debt-tracker app, financial planner, or finance journalism interactive, this is a clean drop-in.

## Features

- **Four strategies**: avalanche (highest APR first), snowball (smallest balance first), hybrid (snowball under $1K then avalanche), balance transfer
- **Promo APR handling**: cards with active 0% promo periods are modeled correctly with post-promo APR transition
- **Balance transfer math**: target card absorbs all other balances + fee, then pays off
- **Multi-card amortization**: pure function, no I/O, deterministic output
- **Structured errors**: errors returned as `CalculatorError`, never thrown
- **Min payment floor**: honors typical issuer convention with remaining-balance cap
- **600-month termination cap**: prevents runaway simulations

## Installation

```bash
npm install @ordertoai/cc-payoff-engine
```

(Or copy `calc-engine.ts` + `types.ts` directly into your project — they have no runtime dependencies.)

## Usage

```typescript
import { calculatePayoff } from '@ordertoai/cc-payoff-engine';

const input = {
  cards: [
    { id: 'a', name: 'Card A', balance: 5000, apr: 22.99, minPayment: 100 },
    { id: 'b', name: 'Card B', balance: 12000, apr: 18.99, minPayment: 240 },
  ],
  monthlyBudget: 600,
  strategy: 'avalanche',
};

const result = calculatePayoff(input);

console.log(result.monthsToDebtFree);        // e.g. 38
console.log(result.totalInterestPaid);       // e.g. 4823.17
console.log(result.cardKilledAt);            // { 'a': 12, 'b': 38 }
console.log(result.monthlySnapshots[5]);     // month 6 state for all cards
```

## Strategy outputs

```typescript
type StrategyResult = {
  strategy: Strategy;
  monthsToDebtFree: number;
  totalInterestPaid: number;
  totalPaid: number;
  cardKilledAt: Record<string, number>;
  monthlySnapshots: MonthlySnapshot[];
  effectiveApr: number;
  errors: CalculatorError[];
};
```

## See it live

Try the full UI at [ccpayoffcalc.com](https://ccpayoffcalc.com) — built on this engine, free, no signup, data stays on your device.

## Methodology

Math walkthroughs and edge-case documentation:
- [Debt Avalanche Calculator](https://ccpayoffcalc.com/debt-avalanche-calculator/) — highest-APR-first methodology
- [Debt Snowball Calculator](https://ccpayoffcalc.com/debt-snowball-calculator/) — smallest-balance-first methodology
- [Snowball vs Avalanche Comparison](https://ccpayoffcalc.com/snowball-vs-avalanche-calculator/) — side-by-side dollar difference
- [Stacking 0% APR Cards](https://ccpayoffcalc.com/stacking-0-apr-cards-calculator/) — multi-card BT chain math
- [Biweekly Payment Math](https://ccpayoffcalc.com/biweekly-payment-calculator-credit-card/) — 13th-payment effect + daily-balance interest

## Sources

The calculator follows methodology consistent with:
- [CFPB: Strategies for paying off credit card debt](https://www.consumerfinance.gov/about-us/blog/strategies-tackling-credit-card-debt/)
- [Federal Reserve G.19 Consumer Credit](https://www.federalreserve.gov/releases/g19/current/)
- [Gal & McShane (2012) "Can Small Victories Help Win the War?"](https://journals.sagepub.com/doi/10.1509/jmr.11.0596) — behavioral basis for snowball

## Not financial advice

This is a math engine. Calculator outputs are estimates based on the inputs you provide. Consult a non-profit credit counselor (NFCC member) or licensed financial advisor before making major debt-management decisions. See the [full disclaimer](https://ccpayoffcalc.com/disclaimer/).

## License

MIT. Operated by [Ordertoai LLC](https://ordertoai.com) (Texas LLC).
