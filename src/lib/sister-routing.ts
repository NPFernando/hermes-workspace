// Keyword-based sister routing — shared by /api/orchestrate and any other consumer.
// No external deps, no LLM calls, runs instantly.

export const ROUTING_TABLE: Array<{
  id: string
  primary: Array<string>   // 2 pts each
  secondary: Array<string> // 1 pt each
}> = [
  {
    id: 'ada',
    primary: ['bug', 'debug', 'error', 'code review', 'refactor', 'function', 'class', 'syntax', 'compile', 'lint', 'type error', 'stacktrace', 'traceback', 'exception'],
    secondary: ['code', 'python', 'javascript', 'typescript', 'script', 'algorithm', 'snippet', 'test', 'unit test', 'api', 'endpoint', 'module', 'package', 'import'],
  },
  {
    id: 'maya',
    primary: ['build', 'implement', 'ship', 'deploy', 'create feature', 'add feature', 'write code', 'develop', 'scaffold'],
    secondary: ['setup', 'create', 'make', 'generate', 'install', 'configure', 'integration', 'pipeline', 'workflow'],
  },
  {
    id: 'luna',
    primary: ['research', 'deep dive', 'synthesize', 'summarize', 'explain in detail', 'comprehensive', 'background on', 'history of', 'overview of'],
    secondary: ['explain', 'what is', 'how does', 'analysis', 'analyse', 'analyze', 'compare', 'contrast', 'literature', 'report on'],
  },
  {
    id: 'helena',
    primary: ['legal', 'gdpr', 'compliance', 'regulation', 'law', 'contract', 'terms of service', 'privacy policy', 'liability'],
    secondary: ['policy', 'clause', 'agreement', 'rights', 'jurisdiction', 'copyright', 'trademark', 'patent', 'consent', 'audit'],
  },
  {
    id: 'bia',
    primary: ['security', 'vulnerability', 'threat', 'breach', 'incident', 'attack', 'malware', 'ransomware', 'intrusion'],
    secondary: ['risk', 'monitor', 'alert', 'suspicious', 'exploit', 'cve', 'penetration', 'firewall', 'anomaly', 'signal'],
  },
  {
    id: 'nova',
    primary: ['screenshot', 'browser automation', 'scrape', 'web scraping', 'navigate to', 'click on', 'puppeteer', 'playwright'],
    secondary: ['browser', 'web page', 'website', 'vision', 'image analysis', 'visual', 'ui test', 'selenium', 'headless'],
  },
  {
    id: 'daine',
    primary: ['sql query', 'analytics', 'dashboard', 'metrics', 'kpi', 'data report', 'chart', 'graph data', 'statistics'],
    secondary: ['data', 'dataset', 'spreadsheet', 'csv', 'aggregation', 'query', 'trend', 'measure', 'insight', 'forecast'],
  },
  {
    id: 'vitoria',
    primary: ['creative writing', 'marketing copy', 'design brief', 'brand', 'content strategy', 'copywriting', 'slogan'],
    secondary: ['write', 'draft', 'story', 'creative', 'design', 'visual', 'aesthetic', 'campaign', 'social media post', 'blog post'],
  },
  {
    id: 'larissa',
    primary: ['customer service', 'support ticket', 'follow up email', 'reply to customer', 'complaint', 'refund request'],
    secondary: ['email draft', 'follow up', 'customer', 'client response', 'support', 'respond to', 'message to'],
  },
  {
    id: 'clara',
    primary: ['sales pitch', 'lead qualification', 'cold outreach', 'prospect', 'business proposal', 'sales email'],
    secondary: ['sales', 'lead', 'outreach', 'revenue', 'pipeline', 'close deal', 'demo request', 'pricing'],
  },
  {
    id: 'novus',
    primary: ['ollama', 'local model', 'private', 'offline', 'zero cost', 'on-premise'],
    secondary: ['local', 'self-hosted', 'no api', 'free model', 'lightweight'],
  },
]

const REASON_MAP: Record<string, string> = {
  ada: 'code task detected — routing to Ada',
  maya: 'implementation task — routing to Maya',
  luna: 'research or analysis task — routing to Luna',
  helena: 'legal or compliance question — routing to Helena',
  bia: 'security or risk topic — routing to Bia',
  nova: 'browser or visual task — routing to Nova',
  daine: 'data or analytics request — routing to Daine',
  vitoria: 'creative or content task — routing to Vitoria',
  larissa: 'customer communication — routing to Larissa',
  clara: 'sales or lead task — routing to Clara',
  novus: 'local/private operation — routing to Novus',
}

function scoreMessage(message: string): Array<{ id: string; score: number }> {
  const lower = message.toLowerCase()
  return ROUTING_TABLE
    .map((entry) => ({
      id: entry.id,
      score:
        entry.primary.filter((kw) => lower.includes(kw)).length * 2 +
        entry.secondary.filter((kw) => lower.includes(kw)).length,
    }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
}

/** Returns the single best sister (or 'astra' for general tasks). */
export function classifyOne(message: string): { sister_id: string; reason: string } {
  const scores = scoreMessage(message)
  const best = scores.at(0)
  if (!best || best.score < 2) {
    return { sister_id: 'astra', reason: 'general task — handled by Astra' }
  }
  return {
    sister_id: best.id,
    reason: REASON_MAP[best.id] ?? `routing to ${best.id}`,
  }
}

/** Returns all sisters scoring ≥ 2 (for orchestration). */
export function classifyMultiple(message: string): Array<{ id: string; score: number }> {
  return scoreMessage(message).filter((r) => r.score >= 2)
}
