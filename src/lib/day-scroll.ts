/** Only offer scrolling when episode content, rather than trailing padding, is clipped. */
export function trackDayScroll(node: HTMLElement, _episodeCount: number) {
  const list = node.querySelector<HTMLElement>('.day-episodes')!;
  let frame = 0;
  function measure() {
    frame = 0;
    const lastEpisode = list.querySelector<HTMLElement>('.day-entry:last-child a');
    const bottom = lastEpisode
      ? lastEpisode.getBoundingClientRect().bottom - list.getBoundingClientRect().top
      : 0;
    node.toggleAttribute('data-scrollable', bottom + list.scrollTop > list.clientHeight + 2);
    node.toggleAttribute('data-at-end', bottom <= list.clientHeight + 2);
  }
  function scheduleMeasure() {
    if (!frame) frame = requestAnimationFrame(measure);
  }
  const observer = new ResizeObserver(scheduleMeasure);
  function observeSizes() {
    observer.disconnect();
    observer.observe(node);
    observer.observe(list);
    list.querySelectorAll('.day-entry').forEach((entry) => observer.observe(entry));
    scheduleMeasure();
  }
  observeSizes();
  list.addEventListener('scroll', scheduleMeasure, { passive: true });
  return {
    update: observeSizes,
    destroy() {
      cancelAnimationFrame(frame);
      observer.disconnect();
      list.removeEventListener('scroll', scheduleMeasure);
    },
  };
}
