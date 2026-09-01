export type PersonalFinancePayload = {
  ok: boolean
  summary: {
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
    unrealizedStockPnlLkr: number
    unrealizedStockPnlPct: number
    accountCount: number
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
  transactions: Array<Record<string, unknown>>
  alerts: Array<{ level: 'info' | 'warning' | 'critical'; title: string; detail: string }>
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
      status: 'healthy' | 'json_primary' | 'postgres_unavailable' | 'postgres_behind' | 'mirror_mismatch'
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
    loans: Array<Record<string, unknown>>
    properties: Array<Record<string, unknown>>
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
