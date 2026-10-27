import { describe, expect, it, vi } from 'vitest';

import { closeOnBackdrop } from '#lib/dialog.js';

function fixture() {
  const element = Object.assign(new EventTarget(), {
    close: vi.fn(),
    getBoundingClientRect: () => ({ left: 100, top: 100, right: 400, bottom: 400 }),
  });
  const action = closeOnBackdrop(element as unknown as HTMLDialogElement);
  const send = (type: string, x = 20, y = 20) =>
    element.dispatchEvent(Object.assign(new Event(type), { clientX: x, clientY: y }));
  return { element, action, send };
}

describe('dialog backdrop dismissal', () => {
  it('closes on a click starting and ending outside the dialog', () => {
    const { element, send } = fixture();
    send('pointerdown');
    send('click');
    expect(element.close).toHaveBeenCalledOnce();
  });
  it('keeps the dialog open for inside clicks, including its padding', () => {
    const { element, send } = fixture();
    send('pointerdown', 110, 110);
    send('click', 110, 110);
    expect(element.close).not.toHaveBeenCalled();
  });
  it('keeps the dialog open for drags crossing the backdrop boundary', () => {
    const { element, send } = fixture();
    send('pointerdown', 200, 200);
    send('click');
    send('pointerdown');
    send('click', 200, 200);
    expect(element.close).not.toHaveBeenCalled();
  });
  it('ignores canceled gestures and cleans up listeners on destruction', () => {
    const { element, action, send } = fixture();
    send('pointerdown');
    send('pointercancel');
    send('click');
    action.destroy();
    send('pointerdown');
    send('click');
    expect(element.close).not.toHaveBeenCalled();
  });
});
