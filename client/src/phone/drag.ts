/**
 * One-finger drag tracking for the joysticks and drag pads.
 *
 * Fingers are tracked with touch events, not pointer events. When a finger slides off the edge of
 * the screen, phones (iOS above all) may cancel it, never say it ended, or keep a "ghost" of it;
 * with pointer events every later touch could then be cancelled straight away and the stick went
 * dead until the page was reloaded. Touch events, with `preventDefault` on touchstart, keep the
 * browser from claiming the touch for a gesture, and every touch event lists the fingers really on
 * the screen, so a finger that vanished without an "end" is dropped at the next touch anywhere.
 * Mice and pens (the /dev bench) still use pointer events.
 */
export type DragPoint = { clientX: number; clientY: number };

export type DragHandlers = {
  /** A finger (or mouse button) went down. Return `false` to ignore it. */
  start: (p: DragPoint) => boolean | void;
  move: (p: DragPoint) => void;
  /** It's gone: `released` is true when it was lifted normally, false when it was cancelled or lost. */
  end: (released: boolean) => void;
};

export type Drag = {
  /** Whether a finger or mouse is dragging right now. */
  active: () => boolean;
  /** Forget the current drag without calling `end` (the caller resets its own state). */
  forget: () => void;
  /** Remove every listener. */
  stop: () => void;
};

const hasTouchEvents = () => typeof window !== 'undefined' && 'ontouchstart' in window;

function find(list: TouchList, id: number): Touch | null {
  for (let i = 0; i < list.length; i++) if (list[i].identifier === id) return list[i];
  return null;
}

export function trackDrag(el: HTMLElement | SVGElement, h: DragHandlers): Drag {
  // (Typed as HTML only so the listener overloads line up; SVG elements get the same events.)
  const node = el as HTMLElement;
  const touchEvents = hasTouchEvents();
  let touchId: number | null = null;
  let pointerId: number | null = null;

  const releaseCapture = () => {
    if (pointerId !== null && el.hasPointerCapture?.(pointerId)) el.releasePointerCapture(pointerId);
  };
  const forget = () => {
    const pid = pointerId;
    touchId = null;
    pointerId = null;
    if (pid !== null && el.hasPointerCapture?.(pid)) el.releasePointerCapture(pid);
  };
  const finish = (released: boolean) => {
    forget();
    h.end(released);
  };
  /** Our finger isn't on the screen any more, but nobody told us. */
  const lostTouch = (e: TouchEvent) => touchId !== null && !find(e.touches, touchId) && !find(e.changedTouches, touchId);

  // ---- Touch ----
  const tstart = (e: TouchEvent) => {
    // Keeps the browser from turning the touch into a scroll, zoom or edge gesture (which would cancel it).
    if (e.cancelable) e.preventDefault();
    const t = e.changedTouches[e.changedTouches.length - 1];
    if (!t) return;
    // A new touch always takes over: if the last finger's "end" never arrived, refusing it would leave the stick dead.
    releaseCapture();
    pointerId = null;
    touchId = t.identifier;
    if (h.start(t) === false) touchId = null;
  };
  const tmove = (e: TouchEvent) => {
    if (touchId === null) return;
    const t = find(e.changedTouches, touchId);
    if (t) {
      if (e.cancelable) e.preventDefault();
      h.move(t);
    } else if (!find(e.touches, touchId)) finish(false);
  };
  const tend = (e: TouchEvent) => {
    if (touchId === null) return;
    if (find(e.changedTouches, touchId)) finish(e.type === 'touchend');
    else if (!find(e.touches, touchId)) finish(false);
  };
  /** Any touch anywhere on the page: drop a finger that left without an "end". */
  const anyTouch = (e: TouchEvent) => {
    if (lostTouch(e)) finish(false);
  };

  // ---- Mouse and pen ----
  const pdown = (e: PointerEvent) => {
    if (touchEvents && e.pointerType === 'touch') return;
    e.preventDefault();
    releaseCapture();
    touchId = null;
    pointerId = e.pointerId;
    el.setPointerCapture?.(e.pointerId);
    if (h.start(e) === false) forget();
  };
  const pmove = (e: PointerEvent) => {
    if (e.pointerId !== pointerId) return;
    e.preventDefault();
    h.move(e);
  };
  const pup = (e: PointerEvent) => {
    if (e.pointerId !== pointerId) return;
    finish(e.type === 'pointerup');
  };

  const opts = { passive: false } as const;
  const docOpts = { passive: true, capture: true } as const;
  if (touchEvents) {
    node.addEventListener('touchstart', tstart, opts);
    node.addEventListener('touchmove', tmove, opts);
    node.addEventListener('touchend', tend, opts);
    node.addEventListener('touchcancel', tend, opts);
    document.addEventListener('touchstart', anyTouch, docOpts);
    document.addEventListener('touchend', anyTouch, docOpts);
    document.addEventListener('touchcancel', anyTouch, docOpts);
  }
  node.addEventListener('pointerdown', pdown);
  node.addEventListener('pointermove', pmove);
  node.addEventListener('pointerup', pup);
  node.addEventListener('pointercancel', pup);
  node.addEventListener('lostpointercapture', pup);

  return {
    active: () => touchId !== null || pointerId !== null,
    forget,
    stop: () => {
      if (touchEvents) {
        node.removeEventListener('touchstart', tstart);
        node.removeEventListener('touchmove', tmove);
        node.removeEventListener('touchend', tend);
        node.removeEventListener('touchcancel', tend);
        document.removeEventListener('touchstart', anyTouch, true);
        document.removeEventListener('touchend', anyTouch, true);
        document.removeEventListener('touchcancel', anyTouch, true);
      }
      node.removeEventListener('pointerdown', pdown);
      node.removeEventListener('pointermove', pmove);
      node.removeEventListener('pointerup', pup);
      node.removeEventListener('pointercancel', pup);
      node.removeEventListener('lostpointercapture', pup);
      forget();
    },
  };
}
