export type FinanceDocumentClass =
  | 'salary_slip'
  | 'contract_note'
  | 'fd_certificate'
  | 'bank_statement'
  | 'employment_contract'
  | 'receipt'
  | 'bill'
  | 'transaction_notice'
  | 'unknown'

export type FinanceDocumentClassification = {
  documentClass: FinanceDocumentClass
  confidence: 'high' | 'medium' | 'low'
  evidence: string
}

/** AI-503: explainable pre-extraction classification; never commits records. */
export function classifyFinanceDocument(input: {
  filename?: string
  text?: string
  requestedDocumentType?: 'transaction' | 'statement' | 'contract'
}): FinanceDocumentClassification {
  const filename = input.filename?.toLowerCase() ?? ''
  const text = input.text?.toLowerCase() ?? ''
  const haystack = `${filename} ${text}`
  if (input.requestedDocumentType === 'statement') {
    return { documentClass: 'bank_statement', confidence: 'high', evidence: 'Selected as a statement' }
  }
  if (input.requestedDocumentType === 'contract') {
    return { documentClass: 'employment_contract', confidence: 'high', evidence: 'Selected as a contract' }
  }
  const rules: Array<{ documentClass: FinanceDocumentClass; terms: Array<string>; evidence: string }> = [
    { documentClass: 'salary_slip', terms: ['salary slip', 'payslip', 'pay slip', 'net pay', 'gross pay'], evidence: 'Payroll wording detected' },
    { documentClass: 'contract_note', terms: ['contract note', 'trade confirmation', 'settlement date', 'brokerage'], evidence: 'Trade-settlement wording detected' },
    { documentClass: 'fd_certificate', terms: ['fixed deposit', 'term deposit', 'maturity value', 'deposit certificate'], evidence: 'Deposit-certificate wording detected' },
    { documentClass: 'bank_statement', terms: ['bank statement', 'account statement', 'opening balance', 'closing balance'], evidence: 'Statement wording detected' },
    { documentClass: 'receipt', terms: ['receipt', 'paid', 'thank you for your purchase'], evidence: 'Receipt wording detected' },
    { documentClass: 'bill', terms: ['invoice', 'bill', 'amount due', 'due date'], evidence: 'Bill wording detected' },
    { documentClass: 'transaction_notice', terms: ['payment received', 'transaction alert', 'credited', 'debited'], evidence: 'Transaction-notice wording detected' },
  ]
  const match = rules.find((rule) => rule.terms.some((term) => haystack.includes(term)))
  return match
    ? { documentClass: match.documentClass, confidence: 'medium', evidence: match.evidence }
    : { documentClass: 'unknown', confidence: 'low', evidence: 'No supported document markers detected' }
}
