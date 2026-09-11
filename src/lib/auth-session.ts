/** End the current workspace session and return the browser to the login gate. */
export async function logoutWorkspace(): Promise<void> {
  const response = await fetch('/api/auth', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'logout' }),
  })

  if (!response.ok) {
    throw new Error('Unable to sign out of this workspace')
  }

  window.location.assign('/login')
}
