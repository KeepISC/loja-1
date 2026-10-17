export function observeStickyHeader(header: HTMLElement) {
  const document = header.ownerDocument;
  const view = document.defaultView;
  if (!view) return () => {};
  const style = document.documentElement.style;
  const previousHeight = style.getPropertyValue('--market-header-height');
  const measure = () => style.setProperty('--market-header-height', `${Math.ceil(header.getBoundingClientRect().height)}px`);
  const onScroll = () => {
    const scrolled = String(view.scrollY > 4);
    if (header.dataset.scrolled !== scrolled) header.dataset.scrolled = scrolled;
  };
  measure();
  onScroll();
  // Measure wrapping, menu expansion and theme/font changes as well as viewport resizing.
  const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
  observer?.observe(header);
  view.addEventListener('resize', measure);
  view.addEventListener('scroll', onScroll, { passive: true });
  return () => {
    observer?.disconnect();
    view.removeEventListener('resize', measure);
    view.removeEventListener('scroll', onScroll);
    if (previousHeight) style.setProperty('--market-header-height', previousHeight);
    else style.removeProperty('--market-header-height');
  };
}
