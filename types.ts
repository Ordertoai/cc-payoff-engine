/**
 * Calculator engine types for ccpayoffcalc.com.
 *
 * The shape mirrors spec.json calculator.inputs verbatim. The engine consumes
 * a CalculatorInput and returns a CalculatorResult. All errors are returned as
 * a structured CalculatorError object (NEVER thrown) so the React UI can show
 * inline messages without try/catch wrappers.
 *
 * NOTE: this is the cc-payoff-calc-specific engine. It is NOT a fork of
 * llcCalcEngine.ts or commercialLeaseCalcEngine.ts. The mechanic is a
 * month-by-month amortization simulation across multiple cards under a chosen
 * payoff strategy (avalanche / snowball / balanceTransfer / hybrid).
 */
export type Strategy = 'avalanche' | 'snowball' | 'balanceTransfer' | 'hybrid';

export interface CardInput {
  nickname: string;
  balance: number;
  apr: number;
  /** Min payment percent of balance (default 2.0). */
  minPaymentPct?: number;
  /** Min payment dollar floor (default 35). */
  minPaymentFloor?: number;
  /** Promo APR (typically 0 for 0% promo). */
  promoApr?: number;
  /** Months remaining at promoApr. */
  promoMonthsRemaining?: number;
  /** APR after promo expires. Defaults to apr if undefined. */
  postPromoApr?: number;
}

export interface CalculatorInput {
  cards: CardInput[];
  monthlyBudget: number;
  strategy: Strategy;
  /** Required if strategy='balanceTransfer'. Must match a card.nickname. */
  balanceTransferTargetCard?: string;
  /** Default 3. */
  balanceTransferFeePct?: number;
  /** Default 18. */
  balanceTransferPromoMonths?: number;
  /** Default = US average 22.30% per Federal Reserve G.19 Q1 2026. */
  balanceTransferPostPromoApr?: number;
  /** ISO date — default = today. Used to compute debtFreeDate. */
  startDate?: string;
}

export interface MonthlySnapshot {
  month: number;
  perCardBalances: number[];
  totalBalance: number;
  interestThisMonth: number;
  totalPayment: number;
  /** Per-card interest accrued this month, keyed by nickname. */
  interestPerCard: Record<string, number>;
}

export interface StrategyResult {
  strategy: Strategy;
  monthsToDebtFree: number;
  totalInterestPaid: number;
  totalFeesPaid: number;
  totalCost: number;
  debtFreeDate: string;
}

export interface CalculatorResult {
  monthsToDebtFree: number;
  totalInterestPaid: number;
  totalFeesPaid: number;
  totalCost: number;
  debtFreeDate: string;
  monthByMonthTimeline: MonthlySnapshot[];
  comparisonTable: StrategyResult[];
}

export type CalculatorErrorCode =
  | 'BUDGET_BELOW_MINIMUMS'
  | 'CANNOT_PAY_OFF_IN_600_MONTHS'
  | 'INVALID_INPUT_BALANCE_NEGATIVE'
  | 'INVALID_INPUT_APR_ABOVE_USURY_CAP'
  | 'INVALID_INPUT_NO_CARDS'
  | 'TOO_MANY_CARDS'
  | 'BT_TARGET_CARD_MISSING';

export interface CalculatorError {
  errorCode: CalculatorErrorCode;
  message: string;
  /** When BUDGET_BELOW_MINIMUMS, the engine returns the minimum budget needed. */
  recommendedBudget?: number;
  recommendedAction?: string;
}

export type CalculatorOutput =
  | { ok: true; result: CalculatorResult }
  | { ok: false; error: CalculatorError };

/** Constants pulled from spec.json + Federal Reserve G.19 Q1 2026. */
export const DEFAULTS = {
  MIN_PAYMENT_PCT: 2.0,
  MIN_PAYMENT_FLOOR: 35,
  BT_FEE_PCT: 3,
  BT_PROMO_MONTHS: 18,
  BT_POST_PROMO_APR: 22.3,
  US_AVG_APR: 22.3,
  USURY_CAP: 36,
  MAX_MONTHS: 600,
  MAX_CARDS: 10,
  ZERO_THRESHOLD: 0.01,
} as const;
