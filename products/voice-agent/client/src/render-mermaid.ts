type MermaidRenderResult = {
  svg: string;
  bindFunctions?: (container: HTMLElement) => void;
};

type RenderMermaidOptions = {
  container: HTMLElement;
  diagram: string;
  renderIdPrefix: string;
  render: (renderId: string, diagram: string) => Promise<MermaidRenderResult>;
  isCurrent: () => boolean;
};

let renderSequence = 0;

export const renderMermaidInto = async ({
  container,
  diagram,
  renderIdPrefix,
  render,
  isCurrent,
}: RenderMermaidOptions): Promise<boolean> => {
  const renderId = `${renderIdPrefix}-${renderSequence++}`;
  try {
    const { svg, bindFunctions } = await render(renderId, diagram);
    if (!isCurrent()) return true;
    container.innerHTML = svg;
    bindFunctions?.(container);
    return true;
  } catch {
    return false;
  }
};
