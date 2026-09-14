

export function message(error: unknown) {
  return error && typeof error === 'object' && 'message' in error ? String(error.message) : 'Unable to connect. Please try again.'
}
