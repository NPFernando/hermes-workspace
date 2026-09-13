import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const home = process.env.HERMES_HOME ?? process.env.CLAUDE_HOME ?? join(homedir(), '.hermes')
const envPath = join(home, '.env')
const values = {}
for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const match = line.match(/^(HERMES_PG_(?:PASSWORD|HOST|PORT|USER)|SWARM_QUEUE_PG_DATABASE)=(.*)$/)
  if (match) values[match[1]] = match[2].trim().replace(/^"|"$/g, '')
}

const database = process.env.SWARM_QUEUE_PG_DATABASE ?? values.SWARM_QUEUE_PG_DATABASE
const forbidden = new Set(['finance', 'personal_finance', 'research', 'agents', 'harp'])
if (!database || forbidden.has(database.toLowerCase())) {
  throw new Error('Set SWARM_QUEUE_PG_DATABASE to a dedicated database; finance/research databases are forbidden.')
}
const sql = readFileSync(new URL('./swarm-dispatch-queue.sql', import.meta.url), 'utf8')
const psql = spawnSync('psql', [
  '-X', '-v', 'ON_ERROR_STOP=1',
  '-h', process.env.HERMES_PG_HOST ?? values.HERMES_PG_HOST ?? '127.0.0.1',
  '-p', process.env.HERMES_PG_PORT ?? values.HERMES_PG_PORT ?? '5432',
  '-U', process.env.HERMES_PG_USER ?? values.HERMES_PG_USER ?? 'hermes_app',
  '-d', database,
], {
  input: sql,
  encoding: 'utf8',
  env: {
    ...process.env,
    PGPASSWORD: process.env.HERMES_PG_PASSWORD ?? values.HERMES_PG_PASSWORD,
  },
})
if (psql.stdout) process.stdout.write(psql.stdout)
if (psql.stderr) process.stderr.write(psql.stderr)
process.exitCode = psql.status ?? 1
