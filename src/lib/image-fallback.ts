import type { Attachment } from 'svelte/attachments';

/** Handle image failures without Svelte's inline SSR event-replay attributes. */
export function imageFallback(onerror: () => void): Attachment<HTMLImageElement> {
  return (image) => {
    image.addEventListener('error', onerror);
    // The request may have failed before hydration attached the listener.
    if (image.complete && image.naturalWidth === 0) onerror();
    return () => image.removeEventListener('error', onerror);
  };
}
