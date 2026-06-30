/**
 * Shared task execution utilities.
 *
 * IMPORTANT: The `parseWorkSummary` logic here is the canonical TypeScript version.
 * An identical copy lives inside the embedded .mjs subprocess template in astra-tasks.ts
 * (search for "function parseWorkSummary" in the scriptContent template literals).
 * When changing parsing logic, update BOTH copies and run `pnpm build` to verify.
 *
 * The isTransientFailure guard is the most common source of drift — ensure it is
 * present in all copies.
 */

export type WorkSummaryResult = {
  status: string
  note: string
  actionLabel: 'completed' | 'blocked' | 'attempted'
  newColumn: 'review' | 'blocked' | null
}

/**
 * Parse a WORK_SUMMARY block from hermes -z output.
 * Returns a normalised result object for updating task state.
 *
 * Status semantics:
 *   done        → task complete, move to review
 *   blocked     → agent explicitly blocked (genuine failure)
 *   needs_input → agent needs a user answer
 *   partial     → in-progress or transient failure (stay in current column)
 */
export function parseWorkSummary(
  output: string,
  stderr: string,
  exitCode: number,
): WorkSummaryResult {
  let status = 'partial'
  let summary = ''
  let next = ''
  let question = ''

  const block = output.match(/<WORK_SUMMARY>([\s\S]*?)<\/WORK_SUMMARY>/)?.[1] ?? ''
  const src = block || (output.match(/^STATUS:/im) ? output : '')
  if (src) {
    const sm = src.match(/STATUS:\s*(\w+)/i)
    const su = src.match(/SUMMARY:\s*(.+)/i)
    const nx = src.match(/NEXT:\s*(.+)/i)
    const q  = src.match(/QUESTION:\s*(.+)/i)
    if (sm) status   = sm[1].toLowerCase()
    if (su) summary  = su[1].trim().replace(/^\[|\]$/g, '')
    if (nx) next     = nx[1].trim().replace(/^\[|\]$/g, '')
    if (q)  question = q[1].trim().replace(/^\[|\]$/g, '')
  }

  // Non-zero exit → blocked only for genuine agent failures.
  // Transient model/network errors stay 'partial' so the task can be retried.
  const isTransientFailure =
    stderr.includes('no final response') ||
    stderr.includes('timed out') ||
    stderr.includes('connection refused') ||
    stderr.includes('rate limit')

  if (exitCode !== 0 && status === 'partial' && !isTransientFailure) {
    status  = 'blocked'
    summary = summary || `hermes exited with code ${exitCode}${stderr ? ': ' + stderr.slice(0, 200) : ''}`
  } else if (exitCode !== 0 && status === 'partial' && isTransientFailure) {
    summary = summary || `Transient execution failure (model unavailable) — will retry automatically. ${stderr.slice(0, 150)}`
  }

  const freeText = output.replace(/<WORK_SUMMARY>[\s\S]*?<\/WORK_SUMMARY>/g, '').trim()
  const note = summary || freeText.slice(0, 800) ||
    (exitCode !== 0
      ? `Execution failed (exit ${exitCode}): ${stderr.slice(0, 200)}`
      : 'Task executed — no summary returned.')

  const parts = [note]
  if (next && next !== '...') parts.push('→ ' + next)
  if (question) parts.push('Needs input: ' + question)

  return {
    status,
    note: parts.join('\n\n'),
    actionLabel: status === 'done' ? 'completed'
      : (status === 'blocked' || status === 'needs_input') ? 'blocked'
      : 'attempted',
    newColumn: status === 'done' ? 'review'
      : (status === 'blocked' || status === 'needs_input') ? 'blocked'
      : null,
  }
}

/**
 * JS source string for the parseWorkSummary function — interpolated verbatim into
 * embedded .mjs subprocess scripts in astra-tasks.ts. Keep the logic identical to
 * the TypeScript version above.
 *
 * Usage in astra-tasks.ts template literals:
 *   ${PARSE_WORK_SUMMARY_SRC}
 */
export const PARSE_WORK_SUMMARY_SRC = `
function parseWorkSummary(output, stderr, exitCode) {
  let status = 'partial', summary = '', next = '', question = '';
  const block = output.match(/<WORK_SUMMARY>([\\s\\S]*?)<\\/WORK_SUMMARY>/)?.[1] ?? '';
  const src   = block || (output.match(/^STATUS:/im) ? output : '');
  if (src) {
    const sm = src.match(/STATUS:\\s*(\\w+)/i);
    const su = src.match(/SUMMARY:\\s*(.+)/i);
    const nx = src.match(/NEXT:\\s*(.+)/i);
    const q  = src.match(/QUESTION:\\s*(.+)/i);
    if (sm) status   = sm[1].toLowerCase();
    if (su) summary  = su[1].trim().replace(/^\\[|\\]$/g, '');
    if (nx) next     = nx[1].trim().replace(/^\\[|\\]$/g, '');
    if (q)  question = q[1].trim().replace(/^\\[|\\]$/g, '');
  }
  const isTransientFailure = stderr.includes('no final response') || stderr.includes('timed out') || stderr.includes('connection refused') || stderr.includes('rate limit');
  if (exitCode !== 0 && status === 'partial' && !isTransientFailure) {
    status  = 'blocked';
    summary = summary || ('hermes exited with code ' + exitCode + (stderr ? ': ' + stderr.slice(0, 200) : ''));
  } else if (exitCode !== 0 && status === 'partial' && isTransientFailure) {
    summary = summary || ('Transient execution failure (model unavailable) — will retry automatically. ' + stderr.slice(0, 150));
  }
  const freeText = output.replace(/<WORK_SUMMARY>[\\s\\S]*?<\\/WORK_SUMMARY>/g, '').trim();
  const note = summary || freeText.slice(0, 800) ||
    (exitCode !== 0 ? 'Execution failed (exit ' + exitCode + '): ' + stderr.slice(0, 200) : 'Task executed — no summary returned.');
  const parts = [note];
  if (next && next !== '...') parts.push('\\u2192 ' + next);
  if (question) parts.push('Needs input: ' + question);
  return {
    status,
    note: parts.join('\\n\\n'),
    actionLabel: status === 'done' ? 'completed' : (status === 'blocked' || status === 'needs_input') ? 'blocked' : 'attempted',
    newColumn:   status === 'done' ? 'review'    : (status === 'blocked' || status === 'needs_input') ? 'blocked' : null,
  };
}
`.trim()
