/**
 * Joysticks only send when the stick moves, and a message sent while the socket is reconnecting
 * is dropped. A lost "let go" would leave the player running in one direction, so every pad
 * resends its stick now and then: constantly while it's held, and a few times after release.
 */
export function keepStickInSync(current: () => { x: number; y: number }, send: (x: number, y: number) => void, every = 300) {
  let zeroes = 0;
  const id = window.setInterval(() => {
    const s = current();
    if (s.x || s.y) {
      zeroes = 0;
      send(s.x, s.y);
    } else if (zeroes < 3) {
      zeroes++;
      send(0, 0);
    }
  }, every);
  return () => clearInterval(id);
}
