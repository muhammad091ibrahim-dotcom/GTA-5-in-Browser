/* Optional multi-touch controls; one shared keyboard/mouse writer in controller.js. */
(() => {
  'use strict';
  function createState() {
    const pointers = new Map(); let dx = 0, dy = 0;
    return {
      press(id, action, x = 0, y = 0) { pointers.set(id, {action, x, y}); },
      move(id, x, y) {
        const p = pointers.get(id); if (!p) return;
        if (p.action === 'look') { dx += x - p.x; dy += y - p.y; }
        p.x = x; p.y = y;
      },
      up(id) { pointers.delete(id); },
      release() { pointers.clear(); dx = dy = 0; },
      sample() {
        const keys = new Set(); let mouse = 0;
        for (const {action} of pointers.values()) {
          if (action === 'fire') mouse |= 1;
          else if (action === 'aim') mouse |= 2;
          else if (action !== 'look') keys.add(action);
        }
        const result = {keys, mouse, dx:Math.trunc(dx), dy:Math.trunc(dy)};
        dx -= result.dx; dy -= result.dy; return result;
      }
    };
  }
  if (typeof module !== 'undefined') module.exports = {createState};
  if (typeof document === 'undefined') return;
  const state = createState(); globalThis.PlayGTA5Touch = state;
  const query = new URLSearchParams(location.search);
  if (query.get('touch') === '0' || (query.get('touch') !== '1' && !matchMedia('(pointer:coarse)').matches)) return;
  const style = document.createElement('style');
  style.textContent = '#touch-controls{position:fixed;inset:0;z-index:10002;pointer-events:none;font:14px system-ui}#touch-controls .touch-group{position:absolute;display:flex;gap:6px;flex-wrap:wrap;max-width:42vw;pointer-events:auto}#touch-controls button{min-width:48px;min-height:48px;padding:8px;border-radius:14px;border:1px solid #c5d7d199;background:#102b27aa;color:#fff;font:inherit;touch-action:none;user-select:none}#touch-controls button:active{background:#426b58}.touch-move{left:max(10px,env(safe-area-inset-left));bottom:74px}.touch-actions{right:max(10px,env(safe-area-inset-right));bottom:74px}.touch-menu{top:max(10px,env(safe-area-inset-top));left:10px}#touch-look{position:absolute;right:12px;top:25%;width:35vw;height:30%;border:1px dashed #ffffff66;border-radius:24px;color:#fffc;display:grid;place-items:center;touch-action:none;pointer-events:auto;user-select:none}@media(max-height:450px){#touch-controls button{min-height:44px;min-width:44px}.touch-actions,.touch-move{bottom:58px}}';
  document.head.append(style);
  const root = document.createElement('section'); root.id = 'touch-controls'; root.setAttribute('data-game-overlay', ''); root.setAttribute('aria-label','Touch game controls');
  function bind(element, action) {
    element.addEventListener('pointerdown', e => {
      e.preventDefault(); e.stopPropagation();
      element.setPointerCapture(e.pointerId); state.press(e.pointerId,action,e.clientX,e.clientY);
    });
    element.addEventListener('pointermove', e => { e.preventDefault(); state.move(e.pointerId,e.clientX,e.clientY); });
    for (const type of ['pointerup','pointercancel','lostpointercapture']) element.addEventListener(type,e => { e.preventDefault(); state.up(e.pointerId); });
    // Suppress compatibility mouse events so a touch never latches engine fire.
    for (const type of ['mousedown','mouseup','click','contextmenu']) element.addEventListener(type,e=>{e.preventDefault();e.stopPropagation();});
  }
  function group(name, items) {
    const box = document.createElement('div'); box.className = 'touch-group ' + name;
    for (const [label,action] of items) { const b=document.createElement('button'); b.type='button';b.textContent=label;bind(b,action);box.append(b); }
    root.append(box);
  }
  group('touch-move',[['↑ / Gas','KeyW'],['←','KeyA'],['↓ / Brake','KeyS'],['→','KeyD']]);
  group('touch-actions',[['Enter car','KeyF'],['Run','ShiftLeft'],['Jump / Handbrake','Space'],['Aim','aim'],['Fire','fire'],['Reload','KeyR']]);
  group('touch-menu',[['Pause','Escape'],['Select','Enter'],['Menu ↑','ArrowUp'],['Menu ↓','ArrowDown'],['View','KeyV']]);
  const look=document.createElement('div');look.id='touch-look';look.textContent='Drag to look';bind(look,'look');root.append(look);
  document.body.append(root);
  // Leave loading and mode selection unobstructed. The original loading screen
  // removes itself when the world is ready; controls then become available.
  const loading = document.getElementById('loading');
  if (loading && !loading.classList.contains('done')) {
    root.hidden = true;
    const observer = new MutationObserver(() => {
      if (!loading.isConnected || loading.classList.contains('done')) {
        root.hidden = false; observer.disconnect();
      }
    });
    observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['class']});
  }
  addEventListener('blur',()=>state.release());
  document.addEventListener('visibilitychange',()=>{if(document.hidden)state.release();});
  addEventListener('game-tools-visibility',e=>{if(e.detail.hidden)state.release();});
})();
