/**
 * Keyboard + touch input manager.
 * Sends deltas to the server via the callback.
 */
class InputManager {
  constructor() {
    this.keys = {};
    this.cyclePending = false;
    this.flarePending = false;

    window.addEventListener('keydown', (e) => {
      this.keys[e.code] = true;
      if (e.code === 'KeyQ') this.cyclePending = true;
      if (e.code === 'Space') { this.flarePending = true; e.preventDefault(); }
    });
    window.addEventListener('keyup', (e) => {
      this.keys[e.code] = false;
    });
  }

  /** Returns { dx, dy, cycle, flare } and resets edge-triggered flags. */
  poll() {
    let dx = 0, dy = 0;
    if (this.keys['KeyA'] || this.keys['ArrowLeft'])  dx -= 1;
    if (this.keys['KeyD'] || this.keys['ArrowRight']) dx += 1;
    if (this.keys['KeyW'] || this.keys['ArrowUp'])    dy -= 1;
    if (this.keys['KeyS'] || this.keys['ArrowDown'])  dy += 1;

    const cycle = this.cyclePending;
    const flare = this.flarePending;
    this.cyclePending = false;
    this.flarePending = false;

    return { dx, dy, cycle, flare };
  }
}

window.InputManager = InputManager;
