/** What happened when the viewer shared a link: `cancelled` when they closed the share sheet */
export type ShareOutcome = 'shared' | 'copied' | 'cancelled' | 'failed';

export type ShareDevice = {
  share?: (data: ShareData) => Promise<void>;
  clipboard?: Pick<Clipboard, 'writeText'>;
  /** A touch screen, where people expect the system share sheet rather than a copied link */
  touch: boolean;
};

/**
 * Shares a link the way the device expects: the system share sheet on touch screens, to send it
 * with any app, and the clipboard elsewhere, for the viewer to paste it where they like. Each is
 * the other's fallback, so a blocked clipboard or share sheet still leaves a way to share
 */
export async function shareLink(
  link: { title: string; url: string },
  device: ShareDevice
): Promise<ShareOutcome> {
  const share = async () => {
    if (!device.share) return null;
    try {
      await device.share(link);
      return 'shared';
    } catch (error) {
      // Closing the share sheet is a choice, not a failure to fall back from
      return error instanceof DOMException && error.name === 'AbortError' ? 'cancelled' : null;
    }
  };
  const copy = async () => {
    if (!device.clipboard) return null;
    try {
      await device.clipboard.writeText(link.url);
      return 'copied';
    } catch {
      return null;
    }
  };

  for (const attempt of device.touch ? [share, copy] : [copy, share]) {
    const outcome = await attempt();
    if (outcome) return outcome;
  }
  return 'failed';
}
