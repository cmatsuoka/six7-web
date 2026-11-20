/**
 * The panel is laid out for the width of the machine's face. When the
 * viewport is narrower than that, the compact layout stacks the display
 * cluster and the controls instead of letting them run off the page.
 */
export function fitMachine(machine: HTMLElement, compactWidth = 720): () => void {
  const update = (): void => {
    machine.classList.toggle('compact', window.innerWidth < compactWidth);
  };

  update();
  window.addEventListener('resize', update);

  return () => {
    window.removeEventListener('resize', update);
  };
}
