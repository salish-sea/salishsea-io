export async function withTimeout<T>(timeout: number, f: (signal: AbortSignal) => T): Promise<T> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  try {
    return await f(controller.signal);
  } finally {
    clearTimeout(timeoutId);
  }
}
