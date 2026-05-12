/**
 * calculatePayoff() — month-by-month amortization simulation across N credit
 * cards under a chosen payoff strategy. See spec.json calculator.formula
 * for the canonical algorithm.
 *
 * Strategies (per spec.json calculator.inputs.strategy.options):
 *   - avalanche:        sort priority desc by effectiveApr (promoApr if active else apr)
 *   - snowball:         sort priority asc by balance
 *   - hybrid:           cards <= $1000 sorted asc by balance first, then > $1000 desc by apr
 *   - balanceTransfer:  consolidate all balances onto target card, fee charged once,
 *                       then pay off target card
 *
 * Implementation discipline:
 *   - Pure function, no I/O, no React dependency, no globals.
 *   - Errors are returned as structured CalculatorError, never thrown (UI surfaces inline).
 *   - 600-month termination cap (50 years) per spec edge case.
 *   - Min payment floor honored per issuer convention; capped at remaining balance.
 *   - Balance-transfer math: target card absorbs sum of all other balances + fee at month 0.
 *   - Promo APR active for promoMonthsRemaining months; APR transitions to postPromoApr after.
 *   - Hybrid degenerates correctly to avalanche (when no balance <= $1000) or
 *     snowball (when all balances <= $1000) without erroring.
 */
import { DEFAULTS } from './types';
import type {
  CalculatorInput,
  CalculatorOutput,
  CardInput,
  MonthlySnapshot,
  Strategy,
  StrategyResult,
} from './types';

/** Internal mutable per-card state during simulation. */
interface CardState {
  nickname: string;
  balance: number;
  apr: number;
  promoApr: number;
  promoMonthsLeft: number;
  postPromoApr: number;
  minPct: number;
  minFloor: number;
}

/**
 * Top-level entry point. Validates input, runs simulation under chosen
 * strategy, and runs comparisonTable across all 4 strategies.
 */
export function calculatePayoff(input: CalculatorInput): CalculatorOutput {
  // 1. Input validation
  const validation = validateInput(input);
  if (validation) return { ok: false, error: validation };

  // 2. Run primary simulation
  const primary = simulate(input, input.strategy);
  if (!primary.ok) return primary;

  // 3. Run comparison across all 4 strategies (best-effort; failures fall through)
  const comparisonTable: StrategyResult[] = [];
  const strategies: Strategy[] = ['avalanche', 'snowball', 'balanceTransfer', 'hybrid'];
  for (const s of strategies) {
    // For BT comparison, default the target to the largest card if not specified
    const compInput: CalculatorInput = { ...input, strategy: s };
    if (s === 'balanceTransfer' && !compInput.balanceTransferTargetCard) {
      compInput.balanceTransferTargetCard = pickDefaultBTTarget(input.cards);
    }
    const sim = simulate(compInput, s);
    if (sim.ok) {
      comparisonTable.push({
        strategy: s,
        monthsToDebtFree: sim.result.monthsToDebtFree,
        totalInterestPaid: sim.result.totalInterestPaid,
        totalFeesPaid: sim.result.totalFeesPaid,
        totalCost: sim.result.totalCost,
        debtFreeDate: sim.result.debtFreeDate,
      });
    }
  }

  return {
    ok: true,
    result: {
      ...primary.result,
      comparisonTable,
    },
  };
}

function pickDefaultBTTarget(cards: CardInput[]): string {
  // Default to the card with the largest balance (highest absolute interest stake)
  let best = cards[0];
  for (const c of cards) if (c.balance > best.balance) best = c;
  return best.nickname;
}

/** Step 1: validate input values + cardinality + strategy preconditions. */
function validateInput(input: CalculatorInput): import('./types').CalculatorError | null {
  if (!input.cards || input.cards.length === 0) {
    return { errorCode: 'INVALID_INPUT_NO_CARDS', message: 'Add at least 1 card to calculate.' };
  }
  if (input.cards.length > DEFAULTS.MAX_CARDS) {
    return {
      errorCode: 'TOO_MANY_CARDS',
      message: `Maximum ${DEFAULTS.MAX_CARDS} cards. Above that, consider debt consolidation.`,
      recommendedAction: 'consolidation-suggested',
    };
  }
  for (const c of input.cards) {
    if (c.balance < 0) {
      return {
        errorCode: 'INVALID_INPUT_BALANCE_NEGATIVE',
        message: `Card "${c.nickname}" has a negative balance. Balance must be 0 or greater.`,
      };
    }
    if (c.apr > DEFAULTS.USURY_CAP) {
      return {
        errorCode: 'INVALID_INPUT_APR_ABOVE_USURY_CAP',
        message: `Card "${c.nickname}" APR ${c.apr}% exceeds the 36% usury reference cap.`,
      };
    }
  }
  if (input.strategy === 'balanceTransfer') {
    const target = input.balanceTransferTargetCard;
    if (!target || !input.cards.find((c) => c.nickname === target)) {
      return {
        errorCode: 'BT_TARGET_CARD_MISSING',
        message: 'Balance transfer strategy requires a target card.',
      };
    }
  }
  return null;
}

/**
 * Initialize per-card state, applying balance-transfer consolidation if
 * strategy='balanceTransfer'. Returns initial state + initial total fees paid.
 */
function initializeState(input: CalculatorInput, strategy: Strategy): {
  state: CardState[];
  totalFeesPaid: number;
} {
  const state: CardState[] = input.cards.map((c) => ({
    nickname: c.nickname,
    balance: c.balance,
    apr: c.apr,
    promoApr: c.promoApr ?? c.apr,
    promoMonthsLeft: c.promoMonthsRemaining ?? 0,
    postPromoApr: c.postPromoApr ?? c.apr,
    minPct: (c.minPaymentPct ?? DEFAULTS.MIN_PAYMENT_PCT) / 100,
    minFloor: c.minPaymentFloor ?? DEFAULTS.MIN_PAYMENT_FLOOR,
  }));

  let totalFeesPaid = 0;
  if (strategy === 'balanceTransfer') {
    const targetName = input.balanceTransferTargetCard!;
    const target = state.find((s) => s.nickname === targetName)!;
    const feePct = (input.balanceTransferFeePct ?? DEFAULTS.BT_FEE_PCT) / 100;
    const promoMonths = input.balanceTransferPromoMonths ?? DEFAULTS.BT_PROMO_MONTHS;
    const postPromoApr = input.balanceTransferPostPromoApr ?? DEFAULTS.BT_POST_PROMO_APR;

    let nonTargetSum = 0;
    for (const s of state) if (s !== target) nonTargetSum += s.balance;
    const fee = nonTargetSum * feePct;
    target.balance += nonTargetSum + fee;
    target.promoApr = 0;
    target.promoMonthsLeft = promoMonths;
    target.postPromoApr = postPromoApr;
    target.apr = postPromoApr;
    for (const s of state) if (s !== target) s.balance = 0;
    totalFeesPaid = fee;
  }

  return { state, totalFeesPaid };
}

/** Determine effective APR for a card at the current month's start. */
function effectiveApr(c: CardState): number {
  return c.promoMonthsLeft > 0 ? c.promoApr : c.apr;
}

/** Sort active (non-zero) cards into priority order based on strategy. */
function sortByPriority(cards: CardState[], strategy: Strategy): CardState[] {
  const active = cards.filter((c) => c.balance > DEFAULTS.ZERO_THRESHOLD);
  switch (strategy) {
    case 'avalanche':
      return active.slice().sort((a, b) => effectiveApr(b) - effectiveApr(a));
    case 'snowball':
      return active.slice().sort((a, b) => a.balance - b.balance);
    case 'hybrid': {
      const small = active.filter((c) => c.balance <= 1000).sort((a, b) => a.balance - b.balance);
      const big = active.filter((c) => c.balance > 1000).sort((a, b) => effectiveApr(b) - effectiveApr(a));
      return [...small, ...big];
    }
    case 'balanceTransfer':
      // Only target card has balance after BT consolidation; treat as priority order
      return active;
  }
}

function calcMinPayment(c: CardState): number {
  const pctPay = c.balance * c.minPct;
  const floorPay = c.minFloor;
  const target = Math.max(pctPay, floorPay);
  return Math.min(target, c.balance);
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function addMonths(iso: string, months: number): string {
  const d = new Date(iso);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

/**
 * Run the month-by-month simulation. Returns either a CalculatorResult or a
 * structured error (e.g. budget below minimums, cannot pay off in 50 years).
 */
function simulate(input: CalculatorInput, strategy: Strategy): CalculatorOutput {
  const startDate = input.startDate ?? todayIso();

  // Edge case: all cards at $0 — already debt-free
  const totalStartBalance = input.cards.reduce((sum, c) => sum + c.balance, 0);
  if (totalStartBalance <= DEFAULTS.ZERO_THRESHOLD) {
    return {
      ok: true,
      result: {
        monthsToDebtFree: 0,
        totalInterestPaid: 0,
        totalFeesPaid: 0,
        totalCost: 0,
        debtFreeDate: startDate,
        monthByMonthTimeline: [],
        comparisonTable: [],
      },
    };
  }

  const init = initializeState(input, strategy);
  const state = init.state;
  let totalFeesPaid = init.totalFeesPaid;
  let totalInterestPaid = 0;
  const timeline: MonthlySnapshot[] = [];

  // Pre-flight: month-1 minimum-payment check (return clear error if budget
  // can't cover even minimums on month 1).
  const month1Mins = state.reduce((sum, c) => sum + calcMinPayment(c), 0);
  if (input.monthlyBudget + DEFAULTS.ZERO_THRESHOLD < month1Mins) {
    return {
      ok: false,
      error: {
        errorCode: 'BUDGET_BELOW_MINIMUMS',
        message: `Monthly budget $${input.monthlyBudget.toFixed(2)} is below the sum of minimum payments ($${month1Mins.toFixed(2)}).`,
        recommendedBudget: Math.ceil(month1Mins / 10) * 10,
      },
    };
  }

  let monthsToDebtFree = 0;

  for (let m = 1; m <= DEFAULTS.MAX_MONTHS; m++) {
    let monthInterest = 0;
    const interestPerCard: Record<string, number> = {};

    // Step 4: charge interest on each card based on current effective APR
    for (const c of state) {
      if (c.balance <= DEFAULTS.ZERO_THRESHOLD) {
        c.balance = 0;
        interestPerCard[c.nickname] = 0;
        continue;
      }
      const apr = effectiveApr(c);
      const monthlyRate = apr / 100 / 12;
      const interest = c.balance * monthlyRate;
      c.balance += interest;
      monthInterest += interest;
      interestPerCard[c.nickname] = interest;
    }
    totalInterestPaid += monthInterest;

    // Step 5: apply minimum payments to all cards
    let totalMins = 0;
    const minPaid: Record<string, number> = {};
    for (const c of state) {
      if (c.balance <= DEFAULTS.ZERO_THRESHOLD) { minPaid[c.nickname] = 0; continue; }
      const minPay = calcMinPayment(c);
      c.balance -= minPay;
      totalMins += minPay;
      minPaid[c.nickname] = minPay;
    }

    let monthPayment = totalMins;
    let remainingBudget = input.monthlyBudget - totalMins;

    // Cannot pay off — budget can no longer cover minimums (interest grew them
    // past budget). Surface as structured error rather than infinite loop.
    if (remainingBudget < -DEFAULTS.ZERO_THRESHOLD) {
      return {
        ok: false,
        error: {
          errorCode: 'BUDGET_BELOW_MINIMUMS',
          message: `Interest accrual pushed minimum payments above your monthly budget at month ${m}. Increase budget or use a balance transfer.`,
          recommendedBudget: Math.ceil(totalMins / 10) * 10,
        },
      };
    }

    // Step 6: apply remaining budget to priority cards in cascade
    const priority = sortByPriority(state, strategy);
    for (const c of priority) {
      if (remainingBudget <= DEFAULTS.ZERO_THRESHOLD) break;
      const apply = Math.min(remainingBudget, c.balance);
      c.balance -= apply;
      remainingBudget -= apply;
      monthPayment += apply;
    }

    // Snapshot (timeline truncated at month 60 for memory; full simulation runs)
    if (m <= 60) {
      timeline.push({
        month: m,
        perCardBalances: state.map((c) => Math.max(0, c.balance)),
        totalBalance: state.reduce((sum, c) => sum + Math.max(0, c.balance), 0),
        interestThisMonth: monthInterest,
        totalPayment: monthPayment,
        interestPerCard,
      });
    }

    // Step 7: decrement promo months
    for (const c of state) {
      if (c.promoMonthsLeft > 0) {
        c.promoMonthsLeft -= 1;
        if (c.promoMonthsLeft === 0) {
          c.apr = c.postPromoApr;
        }
      }
    }

    // Step 8: termination check
    const remaining = state.reduce((sum, c) => sum + Math.max(0, c.balance), 0);
    if (remaining <= DEFAULTS.ZERO_THRESHOLD) {
      monthsToDebtFree = m;
      break;
    }
  }

  if (monthsToDebtFree === 0) {
    return {
      ok: false,
      error: {
        errorCode: 'CANNOT_PAY_OFF_IN_600_MONTHS',
        message: 'At your current monthly budget you cannot pay off this balance within 50 years. Increase budget, try a balance transfer, or speak with a non-profit credit counselor (NFCC member at nfcc.org).',
        recommendedAction: 'increase-budget-or-balance-transfer-or-counsel-with-NFCC',
      },
    };
  }

  const debtFreeDate = addMonths(startDate, monthsToDebtFree);
  const principalPaid = input.cards.reduce((sum, c) => sum + c.balance, 0);
  const totalCost = principalPaid + totalInterestPaid + totalFeesPaid;

  return {
    ok: true,
    result: {
      monthsToDebtFree,
      totalInterestPaid: round2(totalInterestPaid),
      totalFeesPaid: round2(totalFeesPaid),
      totalCost: round2(totalCost),
      debtFreeDate,
      monthByMonthTimeline: timeline,
      comparisonTable: [],
    },
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
