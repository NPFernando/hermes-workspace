/** Keys that can mutate an object's prototype when copied from user input. */
export function isSafeObjectKey(key: string): boolean {
  return key !== '__proto__' && key !== 'prototype' && key !== 'constructor'
}
