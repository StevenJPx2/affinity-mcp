export function readPositiveInteger(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const value = env[name]
  if (value === undefined) return fallback

  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`)
  }

  return parsed
}
