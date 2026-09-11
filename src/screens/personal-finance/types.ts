export type PersonalFinancePayload = {
  ok: boolean
  baseCurrency?: string
  proactiveInsightsEnabled?: boolean
  alertsEnabled?: boolean
  quietModeEnabled?: boolean
  salaryHistory?: Array<{
    id: string
    incomeSourceId?: string
    employerName: string
    effectiveDate: string
    amount: number
    currency: string
    reason?: string
    source: string
    createdAt: string
    updatedAt: string
  }>
  netWorthSnapshots: Array<{
    id: string
    snapshotDate: string
    netWorthLkr: number
    cashLkr: number
    debtLkr: number
    investmentsLkr: number
    liquidNetWorthLkr: number
    lockedWealthLkr: number
    portfolioPositions?: Array<{
      holdingId: string
      symbol: string
      currency: string
      quantity: number
      price: number
      marketValue: number
      costBasis: number
      priceSource: string
    }>
    source: string
    createdAt: string
  }>
  /** Base-currency projection used by the net-worth trend card. */
  netWorthHistory?: Array<{
    date: string
    netWorthBase: number
    cashBase: number
    investmentsBase: number
    debtBase: number
  }>
  financialRules: {
    monthlyInvestmentTargetLkr?: number
    largeTransactionThresholdLkr?: number
    discretionarySpendingThresholdLkr?: number
    investmentAllocationTargetPct?: number
  }
  summary: {
    baseCurrency?: string
    baseSummary?: {
      totalIncome: number
      totalExpenses: number
      netSavings: number
      savingsRate: number
      cashBalance: number
      taxReserve: number
      stockHoldingsValue: number
      fixedDepositsValue: number
      debt: number
      liquidNetWorth: number
      lockedWealth: number
      propertyValue: number
      netWorth: number
      unrealizedStockPnl: number
      unrealizedStockPnlPct: number
      accountCount: number
    }
    netWorthLkr: number
    cashBalanceLkr: number
    netSavingsLkr: number
    savingsRate: number
    totalIncomeLkr: number
    totalExpensesLkr: number
    taxReserveLkr: number
    stockHoldingsValueLkr: number
    fixedDepositsValueLkr: number
    debtLkr: number
    liquidNetWorthLkr: number
    lockedWealthLkr: number
    unrealizedStockPnlLkr: number
    unrealizedStockPnlPct: number
    accountCount: number
    fxUnconverted?: Array<string>
  }
  cseProviderHealth?: {
    status: 'healthy' | 'degraded' | 'stale' | 'manual' | 'unknown'
    holdingsCount: number
    cseQuoteCount: number
    manualFallbackCount: number
    staleQuoteCount: number
    latestQuoteAt: string | null
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
    approachingBudget: boolean
    actualConversionAvailable?: boolean
  }>
  budgetAlertThresholdPct: number
  budgetTemplates?: Array<{
    id: string
    name: string
    lines: Array<{ category: string; currency: string; budgetAmount: number }>
    source: string
    createdAt: string
    updatedAt: string
  }>
  goalCompletionEvents?: Array<{
    id: string
    goalId: string
    goalName: string
    targetAmount: number
    currency: string
    completedAt: string
  }>
  annualBudgetVsActual: Array<{
    category: string
    year: number
    currency: string
    budget: number
    actual: number
    variance: number
    percentUsed: number
    overBudget: boolean
    approachingBudget: boolean
    monthsTracked: number
    actualConversionAvailable?: boolean
  }>
  exchangeRates: Array<{
    base: string
    target: string
    rate: number
    date: string
    updatedAt?: string
    source?: string
    observedAt?: string
  }>
  fxProviderHealth: {
    status: 'healthy' | 'stale' | 'unknown'
    source?: string
    latestRateDate?: string
    lastObservedAt?: string
    detail: string
  }
  safeToSpend: {
    cashLkr: number
    reserveLkr: number
    committedLkr: number
    amountLkr: number
    configured: boolean
    basis: string
  }
  transactions: Array<Record<string, unknown>>
  deletedTransactions: Array<Record<string, unknown>>
  transactionAudit?: Array<{
    id: string
    action: string
    details: Record<string, unknown>
    source: string
    createdAt: string
  }>
  backupHealth: {
    status: 'healthy' | 'stale' | 'unconfigured' | 'missing'
    configured: boolean
    backupCount: number
    latestCreatedAt: string | null
    latestAgeMs: number | null
    staleAfterMs: number
    retention: number
  }
  financialHealth: {
    score: number
    band: 'excellent' | 'stable' | 'needs_attention' | 'at_risk'
    components: Array<{
      key: 'savings' | 'emergency' | 'budget' | 'debt' | 'data'
      label: string
      score: number
      maxScore: number
      detail: string
    }>
  }
  alerts: Array<{
    level: 'info' | 'warning' | 'critical'
    title: string
    detail: string
  }>
  emergencyFund: {
    targetMonths: number
    avgMonthlyExpensesLkr: number
    currentLkr: number
    targetLkr: number
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
    targetLkr: number
    targetDate: string | null
    currentLkr: number
    progressPct: number
  }
  financeQaHistory: Array<{ at: number; question: string; answer: string }>
  storage: {
    active: 'postgres' | 'json'
    fallback: 'json'
    postgres: {
      enabled: boolean
      available: boolean
      snapshotAvailable: boolean
      database?: string
      reason?: string
      lastWriteError?: string
    }
    health: {
      status:
        | 'healthy'
        | 'json_primary'
        | 'postgres_unavailable'
        | 'postgres_behind'
        | 'mirror_mismatch'
      warnings: Array<string>
      jsonUpdatedAt: string | null
      postgresUpdatedAt: string | null
      postgresLagMs: number
      isPostgresBehindJson: boolean
      selfHeal: {
        attempted: boolean
        attempts: number
        succeeded: boolean
        lastAttemptAt: string | null
      }
      rowCounts: {
        json: Record<string, number>
        postgres: Record<string, number>
        lagging: Record<string, { json: number; postgres: number }>
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
    investment_journal: Array<Record<string, unknown>>
    /** Optional for payloads cached before AI-106 shipped. */
    ai_tasks?: Array<Record<string, unknown>>
    loans: Array<Record<string, unknown>>
    properties: Array<Record<string, unknown>>
    beneficiaries: Array<Record<string, unknown>>
    insurance_policies: Array<Record<string, unknown>>
    exchange_rates?: Array<{ base: string; target: string; rate: number; date: string }>
    scheduled_transactions?: Array<Record<string, unknown>>
  }
}

export type AssistantMemoryKind = 'category_rule' | 'financial_rule' | 'other'

export type AssistantMemory = {
  id: string
  content: string
  kind: AssistantMemoryKind
}

export type PendingAssistantMemory = AssistantMemory & { createdAt: string | null }

export type AssistantMemoriesResponse = {
  harpEnabled: boolean
  memories: Array<AssistantMemory>
  pending: Array<PendingAssistantMemory>
}

export type ExtractedSalarySlip = {
  employerName: string
  employeeName?: string
  payPeriod?: string
  paymentDate?: string
  grossAmount?: number
  deductions?: number
  netAmount: number
  currency: string
  confidence: 'high' | 'medium' | 'low'
}

export type ExtractedContractNote = {
  symbol: string
  companyName?: string
  side: 'buy' | 'sell'
  quantity: number
  price: number
  grossAmount?: number
  fees?: number
  currency: string
  broker?: string
  tradeDate?: string
  settlementDate?: string
  confidence: 'high' | 'medium' | 'low'
}

export type ExtractedFdCertificate = {
  bankName: string
  certificateNumber?: string
  principal: number
  currency: string
  interestRatePct: number
  interestPayout: 'monthly' | 'quarterly' | 'annually' | 'at_maturity'
  startDate?: string
  maturityDate?: string
  autoRenew?: boolean
  confidence: 'high' | 'medium' | 'low'
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

export type ContractChange = {
  field: string
  previous: string
  current: string
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
  documentType: 'transaction' | 'statement' | 'contract'
  documentClass?: 'salary_slip' | 'contract_note' | 'fd_certificate' | 'bank_statement' | 'employment_contract' | 'receipt' | 'bill' | 'transaction_notice' | 'unknown'
  passwordHint?: string
  extracted?: ExtractedTransaction
  extractedSalarySlip?: ExtractedSalarySlip
  extractedContractNote?: ExtractedContractNote
  extractedFdCertificate?: ExtractedFdCertificate
  extractedContract?: ExtractedContract
  contractChanges?: Array<ContractChange>
  rawPreviewImagePath?: string
  error?: string
  createdAt?: string
  updatedAt?: string
}
