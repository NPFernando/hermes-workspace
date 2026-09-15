import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { describe, expect, it } from 'vitest'
import { Route as AuthRoute } from './auth'
import { Route as DispatchRoute } from './swarm-dispatch'

type HandlerSet = {
  GET: (ctx: { request: Request }) => Promise<Response>
  POST?: (ctx: { request: Request }) => Promise<Response>
  DELETE?: (ctx: { request: Request }) => Promise<Response>
}

const authHandlers = (
  AuthRoute as unknown as { options: { server: { handlers: HandlerSet } } }
).options.server.handlers
const dispatchHandlers = (
  DispatchRoute as unknown as { options: { server: { handlers: HandlerSet } } }
).options.server.handlers

describe.skipIf(process.env.RUN_SWARM_QUEUE_PG_INTEGRATION !== '1')(
  'authenticated swarm queue API against isolated PostgreSQL',
  () => {
    it('rejects anonymous reads and lets an authenticated disposable user cancel an isolated job', async () => {
      const anonymous = await dispatchHandlers.GET({
        request: new Request('http://localhost/api/swarm-dispatch'),
      })
      expect(anonymous.status).toBe(401)

      const login = await authHandlers.POST!({
        request: new Request('http://localhost/api/auth', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ password: process.env.HERMES_PASSWORD }),
        }),
      })
      expect(login.status).toBe(200)
      const cookie = login.headers.get('set-cookie')?.split(';', 1)[0]
      expect(cookie).toMatch(/^claude-auth=.+/)

      const pool = new Pool({
        host: process.env.HERMES_PG_HOST,
        port: Number(process.env.HERMES_PG_PORT),
        user: process.env.HERMES_PG_USER,
        password: process.env.HERMES_PG_PASSWORD,
        database: process.env.SWARM_QUEUE_PG_DATABASE,
      })
      const id = randomUUID()
      try {
        await pool.query(
          `INSERT INTO public.swarm_dispatch_queue_jobs
           (id, status, assignment_count, payload)
         VALUES ($1::uuid, 'pending', 1, '{}'::jsonb)`,
          [id],
        )

        const read = await dispatchHandlers.GET({
          request: new Request('http://localhost/api/swarm-dispatch', {
            headers: { cookie: cookie! },
          }),
        })
        expect(read.status).toBe(200)
        expect((await read.json()).waiting).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ id, status: 'pending' }),
          ]),
        )

        const cancel = await dispatchHandlers.DELETE!({
          request: new Request(`http://localhost/api/swarm-dispatch?id=${id}`, {
            method: 'DELETE',
            headers: { cookie: cookie! },
          }),
        })
        expect(cancel.status).toBe(200)
        expect(await cancel.json()).toMatchObject({
          found: true,
          status: 'cancelled',
        })
      } finally {
        await pool.end()
      }
    })
  },
)
