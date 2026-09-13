import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const home = process.env.HERMES_HOME ?? process.env.CLAUDE_HOME ?? join(homedir(), '.hermes')
const values = {}
for (const line of readFileSync(join(home, '.env'), 'utf8').split(/\r?\n/)) {
  const match = line.match(/^(HERMES_PG_(?:PASSWORD|HOST|PORT|USER)|SWARM_QUEUE_PG_DATABASE)=(.*)$/)
  if (match) values[match[1]] = match[2].trim().replace(/^"|"$/g, '')
}

const database = process.env.SWARM_QUEUE_PG_DATABASE ?? values.SWARM_QUEUE_PG_DATABASE
const user = process.env.HERMES_PG_USER ?? values.HERMES_PG_USER ?? 'hermes_app'
const forbidden = new Set(['finance', 'personal_finance', 'research', 'agents', 'harp'])
if (!database || !/^[a-z][a-z0-9_]{1,62}$/i.test(database) || forbidden.has(database.toLowerCase())) {
  throw new Error('Set SWARM_QUEUE_PG_DATABASE to a dedicated database; finance/research databases are forbidden.')
}
if (!/^[a-z][a-z0-9_]{0,62}$/i.test(user)) throw new Error('Unsafe Postgres role name.')

const connection = [
  '-X', '-v', 'ON_ERROR_STOP=1',
  '-h', process.env.HERMES_PG_HOST ?? values.HERMES_PG_HOST ?? '127.0.0.1',
  '-p', process.env.HERMES_PG_PORT ?? values.HERMES_PG_PORT ?? '5432',
  '-U', user,
]
const env = {
  ...process.env,
  PGPASSWORD: process.env.HERMES_PG_PASSWORD ?? values.HERMES_PG_PASSWORD,
  PGCONNECT_TIMEOUT: '5',
}
const quote = String.fromCharCode(39)
const existingDatabaseQuery =
  'SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname = ' +
  quote + database + quote
const existing = spawnSync('psql', [
  ...connection,
  '-d', 'postgres', '-At',
  '-c', existingDatabaseQuery,
], { encoding: 'utf8', env })
if (existing.status !== 0) {
  if (existing.stderr) process.stderr.write(existing.stderr)
  process.exit(existing.status ?? 1)
}

if (existing.stdout.trim()) {
  if (existing.stdout.trim() !== user) {
    throw new Error('Dedicated queue database exists but is owned by a different role; refusing to change it.')
  }
  console.log('Dedicated queue database exists and has the expected owner.')
} else {
  const created = spawnSync('psql', [
    ...connection,
    '-d', 'postgres',
    '-c', `CREATE DATABASE "${database}" OWNER "${user}" ENCODING 'UTF8' TEMPLATE template0`,
  ], { encoding: 'utf8', env })
  if (created.stdout) process.stdout.write(created.stdout)
  if (created.stderr) process.stderr.write(created.stderr)
  process.exitCode = created.status ?? 1
}
