/* Standard Gamepad mapping -> existing engine keyboard/mouse input.
 * This is an input bridge, not native analog vehicle/character support. */
(() => {
  'use strict';
  const axis = (value, deadzone = .18) => {
    value = Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0;
    return Math.abs(value) <= deadzone ? 0 : Math.sign(value) * (Math.abs(value) - deadzone) / (1 - deadzone);
  };
  function map(pad, driving = false) {
    const keys = new Set(), pressed = i => !!pad.buttons[i]?.pressed || pad.buttons[i]?.value > .5;
    const x = axis(pad.axes[0]), y = axis(pad.axes[1]);
    if (x < -.2) keys.add('KeyA'); if (x > .2) keys.add('KeyD');
    if (!driving) { if (y < -.2) keys.add('KeyW'); if (y > .2) keys.add('KeyS'); }
    const binding = driving ? {0:'Space',1:'KeyR',2:'KeyQ',3:'KeyF',4:'Tab',5:'KeyH',8:'KeyV',9:'Escape',10:'KeyH',11:'KeyC',12:'ArrowUp',13:'ArrowDown',14:'ArrowLeft',15:'ArrowRight'}
      : {0:'ShiftLeft',1:'KeyR',2:'Space',3:'KeyF',4:'Tab',5:'KeyQ',8:'KeyV',9:'Escape',10:'ControlLeft',11:'KeyC',12:'ArrowUp',13:'ArrowDown',14:'ArrowLeft',15:'ArrowRight'};
    for (const [button, code] of Object.entries(binding)) if (pressed(+button)) keys.add(code);
    let mouse = 0;
    if (driving) { if (pressed(7)) keys.add('KeyW'); if (pressed(6)) keys.add('KeyS'); }
    else { if (pressed(7)) mouse |= 1; if (pressed(6)) mouse |= 2; }
    return {keys, mouse, lookX:axis(pad.axes[2]), lookY:axis(pad.axes[3])};
  }
  function attach({keys, w, VK, canvas, getPads = () => navigator.getGamepads(), status = () => {}, active = () => true}) {
    const physical = new Set(); let owned = new Set(), ownedMouse = 0, physicalMouse = 0, last = 0, driving = false, toggleHeld = false;
    let remainderX = 0, remainderY = 0;
    function apply(next) {
      for (const code of new Set([...owned, ...next.keys])) if (VK[code]) Atomics.store(keys, VK[code], physical.has(code) || next.keys.has(code) ? 128 : 0);
      owned = next.keys;
      const current = Atomics.load(w, 5);
      Atomics.store(w, 5, (current & ~ownedMouse) | physicalMouse | next.mouse);
      ownedMouse = next.mouse;
    }
    const empty = () => ({keys:new Set(), mouse:0});
    addEventListener('keydown', e => { if (e.isTrusted) physical.add(e.code); }, true);
    addEventListener('keyup', e => { if (e.isTrusted) physical.delete(e.code); }, true);
    canvas.addEventListener('mousedown', e => { if (e.isTrusted) physicalMouse |= 1 << [0,2,1,3,4][e.button]; }, true);
    addEventListener('mouseup', e => { if (e.isTrusted) physicalMouse &= ~(1 << [0,2,1,3,4][e.button]); }, true);
    const release = () => { physical.clear(); physicalMouse = 0; apply(empty()); remainderX = remainderY = 0; };
    addEventListener('blur', release); document.addEventListener('visibilitychange', () => { if (document.hidden) release(); });
    function tick(now) {
      const dt = Math.min(.05, Math.max(0, (now - (last || now)) / 1000)); last = now;
      let pad; try { pad = [...getPads()].find(p => p?.connected && p.mapping === 'standard'); } catch {}
      if (!pad || document.hidden || !document.hasFocus() || !active()) {
        apply(touchInput(empty())); toggleHeld = false; status(pad ? 'Controller paused · ' + (driving ? 'Driving' : 'On foot') : 'Press a controller button to connect');
      } else {
        const toggle = !!pad.buttons[8]?.pressed && !!pad.buttons[9]?.pressed;
        if (toggle && !toggleHeld) driving = !driving;
        if (toggle) toggleHeld = true;
        const next = map(pad, driving);
        if (toggleHeld) { next.keys.delete('Escape'); next.keys.delete('KeyV'); }
        if (!pad.buttons[8]?.pressed && !pad.buttons[9]?.pressed) toggleHeld = false;
        apply(touchInput(next));
        if (document.pointerLockElement === canvas) {
          remainderX += next.lookX * 900 * dt; remainderY += next.lookY * 900 * dt;
          const dx = Math.trunc(remainderX), dy = Math.trunc(remainderY);
          remainderX -= dx; remainderY -= dy;
          Atomics.add(w, 2, dx); Atomics.add(w, 3, dy);
        }
        status((driving ? 'Driving' : 'On foot') + ' · View + Menu switches mode');
      }
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
    function touchInput(next) {
      if (document.hidden || !document.hasFocus() || !active()) { globalThis.PlayGTA5Touch?.release(); return next; }
      const touch = globalThis.PlayGTA5Touch?.sample();
      if (touch) {
        for (const key of touch.keys) next.keys.add(key);
        next.mouse |= touch.mouse;
        Atomics.add(w, 2, touch.dx); Atomics.add(w, 3, touch.dy);
      }
      return next;
    }
    return {release, toggleMode:() => { driving = !driving; return driving; }};
  }
  globalThis.PlayGTA5Controller = {axis, map, attach};
  if (typeof module !== 'undefined') module.exports = {axis, map, attach};
})();
