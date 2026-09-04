/** Nested-dialog body scroll lock (CONTEXT.md · Dialog scroll lock).
 *  A counter — not a boolean — keeps overflow hidden until the last layer
 *  closes. `scrollbar-gutter: stable` on html (tokens.css) stops sideways jump. */
let openCount = 0;
let savedOverflow = '';

export function acquireDialogScrollLock() {
  if (openCount === 0) {
    savedOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  openCount += 1;
}

export function releaseDialogScrollLock() {
  openCount = Math.max(0, openCount - 1);
  if (openCount === 0) document.body.style.overflow = savedOverflow;
}
