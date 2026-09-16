// Convert unknown thrown values into a safe string for the existing error displays.

export function message(error: unknown) {
  return error && typeof error === 'object' && 'message' in error
    ? String(error.message)
    : 'Unable to connect. Please try again.'
}
