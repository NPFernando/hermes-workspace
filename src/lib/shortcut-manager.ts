export class ShortcutManager {
  private shortcuts: Map<string, () => void> = new Map()

  registerShortcut(keyCombo: string, callback: () => void): void {
    this.shortcuts.set(keyCombo.toLowerCase(), callback)
  }

  unregisterShortcut(keyCombo: string): void {
    this.shortcuts.delete(keyCombo.toLowerCase())
  }

  handleKeyDown(event: KeyboardEvent): void {
    const keyCombo = this.getKeyCombo(event)
    const callback = this.shortcuts.get(keyCombo)
    if (callback) {
      event.preventDefault()
      callback()
    }
  }

  private getKeyCombo(event: KeyboardEvent): string {
    const keys: Array<string> = []

    if (event.ctrlKey) keys.push('ctrl')
    if (event.shiftKey) keys.push('shift')
    if (event.altKey) keys.push('alt')
    if (event.metaKey) keys.push('meta')

    if (['Control', 'Shift', 'Alt', 'Meta'].includes(event.key)) return ''

    keys.push(event.key.toLowerCase())
    return keys.join('+')
  }
}

export const shortcutManager = new ShortcutManager()
