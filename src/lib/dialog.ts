/** Only a click that starts and ends on the backdrop dismisses a native dialog. */
export function closeOnBackdrop(dialog: HTMLDialogElement) {
  let startedOutside = false;
  const outside = (event: MouseEvent) => {
    if (event.target !== dialog) return false;
    const rect = dialog.getBoundingClientRect();
    return (
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom
    );
  };
  const down = (event: PointerEvent) => {
    startedOutside = outside(event);
  };
  const cancel = () => {
    startedOutside = false;
  };
  const click = (event: MouseEvent) => {
    if (startedOutside && outside(event)) dialog.close();
    startedOutside = false;
  };
  dialog.addEventListener('pointerdown', down);
  dialog.addEventListener('pointercancel', cancel);
  dialog.addEventListener('click', click);
  return {
    destroy() {
      dialog.removeEventListener('pointerdown', down);
      dialog.removeEventListener('pointercancel', cancel);
      dialog.removeEventListener('click', click);
    },
  };
}
