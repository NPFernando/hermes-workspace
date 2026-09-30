/**
 * Paperclip agents renamed from job titles to personas on 2026-09-30. HARP history
 * keeps the name an agent had when it planned, so fold the old names into the
 * persona for display. HARP agent ids only come from Paperclip, so ADA here is
 * the Paperclip QA agent, not the Hermes sister. Safe to trim once the old names age out of the 90-day window.
 */
const PERSONA_ALIASES: Record<string, string> = {
  CFO: 'FORTUNA',
  'QA / Code Review Engineer': 'CASSIA',
  // Briefly named ADA; renamed to avoid clashing with the Hermes sister Ada.
  ADA: 'CASSIA',
  'Software Engineer': 'LIVIA',
  'Automation Engineer': 'ARIA',
  'AI Integration Engineer': 'IRIS',
  'Cloud & Infrastructure Engineer': 'GAIA',
  'Engineering Manager': 'MINERVA',
  'DevOps / SRE Engineer': 'VESTA',
}

export function personaName(agent: string): string {
  return PERSONA_ALIASES[agent] ?? agent
}
