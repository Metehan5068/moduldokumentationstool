/** The last short row cannot reach the viewport's top when scrolling stops. */
export function isAtScrollEnd(container: Pick<HTMLElement, 'scrollTop' | 'scrollHeight' | 'clientHeight'>): boolean {
  return container.scrollTop > 0 && container.scrollHeight > container.clientHeight
    && container.scrollHeight - container.clientHeight - container.scrollTop <= 1;
}
