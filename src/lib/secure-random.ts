/** Return a uniformly distributed integer without exposing a predictable PRNG. */
export function secureRandomInt(maxExclusive: number): number {
  if (maxExclusive <= 1 || typeof crypto === 'undefined') return 0

  const range = 0x1_0000_0000
  const limit = range - (range % maxExclusive)
  const sample = new Uint32Array(1)
  do {
    crypto.getRandomValues(sample)
  } while (sample[0] >= limit)
  return sample[0] % maxExclusive
}
