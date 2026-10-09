import type { Settings } from '../engine/settings';

/** Unified keyboard / mouse / touch input. */
export class Input {
  keys = new Set<string>();
  pressed = new Set<string>(); // edge-triggered this frame
  mouseDX = 0; mouseDY = 0; wheel = 0;
  dragging = false;
  pointerLocked = false;
  // touch
  touchMove = { x: 0, y: 0 };
  touchActive = false;
  touchButtons = new Set<string>();
  touchPressed = new Set<string>();
  enabled = true;
  isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
  private lastX = 0; private lastY = 0;
  constructor(public settings: Settings, private el: HTMLElement) {
    addEventListener('keydown', (e) => {
      if (this.isTyping(e)) return;
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
      if (['Space', 'ArrowUp', 'ArrowDown', 'Tab'].includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    el.addEventListener('mousedown', (e) => {
      if (e.button === 0 || e.button === 2) { this.dragging = true; this.lastX = e.clientX; this.lastY = e.clientY; }
    });
    addEventListener('mouseup', () => (this.dragging = false));
    addEventListener('mousemove', (e) => {
      if (this.pointerLocked) { this.mouseDX += e.movementX; this.mouseDY += e.movementY; }
      else if (this.dragging) { this.mouseDX += e.clientX - this.lastX; this.mouseDY += e.clientY - this.lastY; this.lastX = e.clientX; this.lastY = e.clientY; }
    });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('wheel', (e) => { this.wheel += Math.sign(e.deltaY); e.preventDefault(); }, { passive: false });
    document.addEventListener('pointerlockchange', () => (this.pointerLocked = document.pointerLockElement === el));
    // touch camera drag on the canvas (joystick handled by the HUD)
    let tid: number | null = null;
    el.addEventListener('touchstart', (e) => {
      for (const t of Array.from(e.changedTouches)) if (tid === null) { tid = t.identifier; this.lastX = t.clientX; this.lastY = t.clientY; }
    }, { passive: true });
    el.addEventListener('touchmove', (e) => {
      for (const t of Array.from(e.changedTouches)) if (t.identifier === tid) { this.mouseDX += (t.clientX - this.lastX) * 1.4; this.mouseDY += (t.clientY - this.lastY) * 1.4; this.lastX = t.clientX; this.lastY = t.clientY; }
    }, { passive: true });
    el.addEventListener('touchend', (e) => { for (const t of Array.from(e.changedTouches)) if (t.identifier === tid) tid = null; });
  }
  private isTyping(e: KeyboardEvent) {
    const t = e.target as HTMLElement;
    return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
  }
  down(action: string) {
    if (!this.enabled) return false;
    const code = this.settings.keybinds[action];
    return (code && this.keys.has(code)) || this.touchButtons.has(action);
  }
  hit(action: string) {
    if (!this.enabled) return false;
    const code = this.settings.keybinds[action];
    return (code && this.pressed.has(code)) || this.touchPressed.has(action);
  }
  /** Movement axes in camera space: x right, y forward. */
  axes() {
    if (!this.enabled) return { x: 0, y: 0 };
    let x = 0, y = 0;
    if (this.down('forward') || this.keys.has('ArrowUp')) y += 1;
    if (this.down('back') || this.keys.has('ArrowDown')) y -= 1;
    if (this.down('left') || this.keys.has('ArrowLeft')) x -= 1;
    if (this.down('right') || this.keys.has('ArrowRight')) x += 1;
    if (this.touchActive) { x = this.touchMove.x; y = this.touchMove.y; }
    const l = Math.hypot(x, y);
    if (l > 1) { x /= l; y /= l; }
    return { x, y };
  }
  endFrame() { this.pressed.clear(); this.touchPressed.clear(); this.mouseDX = 0; this.mouseDY = 0; this.wheel = 0; }
}
