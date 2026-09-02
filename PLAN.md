# Implementation Plan: Add API route for workspace performance metrics

## Summary of the change
Add a new API endpoint `/api/metrics` that returns workspace performance metrics, including bundle sizes of the client and server builds. This endpoint will be accessible only to authenticated users and will help in monitoring the size of the deployed application over time.

## Exact files to modify
- `src/routes/api/metrics.ts` (new file)

## Step-by-step implementation instructions
1. Create a new file at `src/routes/api/metrics.ts` with the following content:
   ```typescript
   import { createFileRoute } from '@tanstack/react-router'
   import { json } from '@tanstack/react-start'
   import { isAuthenticated } from '../../server/auth-middleware'
   import { readdirSync, statSync } from 'node:fs'
   import { join } from 'node:path'

   export const Route = createFileRoute('/api/metrics')({
     server: {
       handlers: {
         GET: async ({ request }) => {
           if (!isAuthenticated(request)) {
             return json({ error: 'Unauthorized' }, { status: 401 })
           }

           const distDir = join(process.cwd(), 'dist')
           const bundleSizes: Record<string, number> = {}

           try {
             const clientDir = join(distDir, 'client')
             const serverDir = join(distDir, 'server')

             // Read client directory
             if (await fs.promises.access(clientDir).then(() => true).catch(() => false)) {
               const clientFiles = readdirSync(clientDir)
               for (const file of clientFiles) {
                 const filePath = join(clientDir, file)
                 const stats = statSync(filePath)
                 bundleSizes[`client/${file}`] = stats.size
               }
             }

             // Read server directory
             if (await fs.promises.access(serverDir).then(() => true).catch(() => false)) {
               const serverFiles = readdirSync(serverDir)
               for (const file of serverFiles) {
                 const filePath = join(serverDir, file)
                 const stats = statSync(filePath)
                 bundleSizes[`server/${file}`] = stats.size
               }
             }
           } catch (error) {
             // If dist directory doesn't exist or any other error, return empty bundle sizes
             console.warn('Failed to read bundle sizes:', error)
           }

           return json({
             bundleSizes,
             timestamp: Date.now(),
           })
         },
       },
     },
   })
   ```
   Note: The above code uses `fs.promises.access` which requires importing `fs/promises`. Adjust the imports accordingly.

   Alternatively, use synchronous versions for simplicity in a server route:
   ```typescript
   import { createFileRoute } from '@tanstack/react-router'
   import { json } from '@tanstack/react-start'
   import { isAuthenticated } from '../../server/auth-middleware'
   import { readdirSync, statSync } from 'node:fs'
   import { join } from 'node:path'

   export const Route = createFileRoute('/api/metrics')({
     server: {
       handlers: {
         GET: async ({ request }) => {
           if (!isAuthenticated(request)) {
             return json({ error: 'Unauthorized' }, { status: 401 })
           }

           const distDir = join(process.cwd(), 'dist')
           const bundleSizes: Record<string, number> = {}

           try {
             const clientDir = join(distDir, 'client')
             const serverDir = join(distDir, 'server')

             // Read client directory
             if (fs.existsSync(clientDir)) {
               const clientFiles = readdirSync(clientDir)
               for (const file of clientFiles) {
                 const filePath = join(clientDir, file)
                 const stats = statSync(filePath)
                 bundleSizes[`client/${file}`] = stats.size
               }
             }

             // Read server directory
             if (fs.existsSync(serverDir)) {
               const serverFiles = readdirSync(serverDir)
               for (const file of serverFiles) {
                 const filePath = join(serverDir, file)
                 const stats = statSync(filePath)
                 bundleSizes[`server/${file}`] = stats.size
               }
             }
           } catch (error) {
             // If dist directory doesn't exist or any other error, return empty bundle sizes
             console.warn('Failed to read bundle sizes:', error)
           }

           return json({
             bundleSizes,
             timestamp: Date.now(),
           })
         },
       },
     },
   })
   ```

2. Ensure the new route is automatically picked up by the TanStack router (no additional registration needed).

## How to verify the change works
1. Start the Hermes workspace in development mode (if not already running):
   ```bash
   cd ~/hermes-workspace && pnpm dev
   ```
2. Once the dev server is running, authenticate and access the endpoint:
   ```bash
   curl -H "Cookie: <your-auth-cookie>" http://localhost:3000/api/metrics
   ```
   Replace `<your-auth-cookie>` with a valid session cookie from logging into the workspace.
3. Verify the response is a JSON object with `bundleSizes` (containing client and server file sizes) and a `timestamp`.
4. Check that the bundle sizes are non-zero numbers for existing files in the `dist/client` and `dist/server` directories.
5. Ensure that unauthenticated requests return a 401 Unauthorized error.

## Rollback procedure
To rollback, simply delete the newly created file:
```bash
rm ~/hermes-workspace/src/routes/api/metrics.ts
```
Then restart the Hermes workspace server if it was running in production mode.