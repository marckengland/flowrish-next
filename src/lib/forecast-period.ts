/** Forecast periods use UTC on the server and in every browser timezone. */
export function forecastPeriod(date = new Date()): string {
  return date.toISOString().slice(0, 7)
}
