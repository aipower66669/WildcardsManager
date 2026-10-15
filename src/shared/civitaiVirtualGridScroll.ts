/** Keep the same fractional row under the viewport when row pitch changes. */
export function preserveScrollForRowHeightChange(
  relativeScrollTop: number,
  oldPitch: number,
  newPitch: number,
): number {
  if (oldPitch <= 0 || newPitch <= 0) return relativeScrollTop;
  return (relativeScrollTop / oldPitch) * newPitch;
}
