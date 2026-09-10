export type PersonalFinancePayload = {
  ok: boolean
  /** PF-201: reporting currency every `*Lkr` figure in this payload is expressed
   * in (default 'LKR'). Storage stays LKR-denominated. */
  baseCurrency: string
  /** PF-201: LKR->baseCurrency multiplier for components that sum raw
   * LKR-denominated records client-side. 1 when base is 'LKR' or no rate exists. */
  fxToBase: number
  summary: {
    /** PF-201: reporting currency of the `*Lkr` figures below (default 'LKR'). */
    baseCurrency: string
    netWorthBase: number
    cashBalanceBase: number
    netSavingsBase: number
    savingsRate: number
    totalIncomeBase: number
    totalExpensesBase: number
    taxReserveBase: number
    stockHoldingsValueBase: number
    fixedDepositsValueBase: number
    debtBase: number
    unrealizedStockPnlBase: number
    unrealizedStockPnlPct: number
    accountCount: number
    /** PF-206: asset currencies with no exchange rate on file — counted raw. */
    fxUnconverted?: Array<string>
  }
  budgetVsActual: Array<{
    category: string
    month: string
    currency: string
    budget: number
    actual: number
    variance: number
    percentUsed: number
    overBudget: boolean
  }>
  alerts: Array<{
    level: 'info' | 'warning' | 'critical'
    title: string
    detail: string
  }>
  /** PF review item 7: server-computed dashboard derivations. Amounts are raw
   * LKR — scale by `fxToBase` for display. */
  trends: {
    series: Array<{
      month: string
      income: number
      expense: number
      net: number
    }>
    categoriesThisMonth: Array<{ category: string; amount: number }>
  }
  recurringBills: Array<{
    vendor: string
    category: string
    monthsSeen: number
    averageAmount: number
  }>
  upcomingMoney: {
    paydays: Array<{ name: string; state: 'due_soon' | 'overdue'; days: number }>
    contracts: Array<{ name: string; days: number }>
    fdMaturities: Array<{ name: string; days: number }>
  }
  currencyExposure: Array<{ currency: string; amount: number }>
  /** PF review item 1: `data.income_records` / `data.expense_records` carry
   * only the trailing N months. Older rows: `list_transactions` + JSON export. */
  transactionsWindowMonths: number
  emergencyFund: {
    targetMonths: number
    avgMonthlyExpensesBase: number
    currentBase: number
    targetBase: number
    coverageMonths: number
    progressPct: number
  }
  savingsRateTarget: {
    targetPct: number
    actualPct: number
    progressPct: number
    hasData: boolean
  }
  wealthGoal: {
    targetBase: number
    targetDate: string | null
    currentBase: number
    progressPct: number
  }
  financeQaHistory: Array<{ at: number; question: string; answer: string }>
  storage: {
    active: 'postgres' | 'unavailable'
    postgres: {
      enabled: boolean
      available: boolean
      snapshotAvailable: boolean
      database?: string
      reason?: string
      lastWriteError?: string
    }
    health: {
      status: 'healthy' | 'postgres_unavailable' | 'json_primary'
      warnings: Array<string>
      postgresUpdatedAt: string | null
      rowCounts: {
        postgres: Record<string, number>
      }
    }
  }
  data: {
    finance_accounts: Array<Record<string, unknown>>
    income_records: Array<Record<string, unknown>>
    expense_records: Array<Record<string, unknown>>
    budget_categories: Array<Record<string, unknown>>
    categories: Array<Record<string, unknown>>
    subcategories: Array<Record<string, unknown>>
    merchants: Array<Record<string, unknown>>
    tags: Array<Record<string, unknown>>
    savings_goals: Array<Record<string, unknown>>
    tax_records: Array<Record<string, unknown>>
    income_sources: Array<Record<string, unknown>>
    stock_holdings: Array<Record<string, unknown>>
    fixed_deposits: Array<Record<string, unknown>>
    loans: Array<Record<string, unknown>>
    properties: Array<Record<string, unknown>>
    beneficiaries: Array<Record<string, unknown>>
  }
}

export type ExtractedTransaction = {
  kind: 'income' | 'expense'
  amount: number
  currency: string
  vendorOrSource: string
  date: string
  category?: string
  confidence: 'high' | 'medium' | 'low'
}

export type ContractRisk = {
  severity: 'high' | 'medium' | 'low'
  clause: string
  concern: string
}

export type ExtractedContract = {
  employerName: string
  employmentType: 'full_time' | 'contract' | 'freelance' | 'other'
  monthlyIncomeAmount?: number
  currency: string
  contractStartDate?: string
  contractEndDate?: string
  jobTitle?: string
  paydayDayOfMonth?: number
  paySchedule?: string
  confidence: 'high' | 'medium' | 'low'
  riskSummary: string
  risks: Array<ContractRisk>
}

export type PendingIngestion = {
  id: string
  status: 'awaiting_password' | 'awaiting_review' | 'confirmed' | 'rejected'
  source: 'gmail' | 'upload'
  documentType: 'transaction' | 'contract'
  passwordHint?: string
  extracted?: ExtractedTransaction
  extractedContract?: ExtractedContract
  rawPreviewImagePath?: string
  error?: string
}
