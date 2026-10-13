import { useEffect, useId, useRef } from 'react';

import mermaid from 'mermaid';

mermaid.initialize({
  startOnLoad: false,
  securityLevel: 'strict',
  theme: 'dark',
  flowchart: { htmlLabels: false, useMaxWidth: true },
});

interface MermaidDiagramProps {
  diagram: string;
}

export const MermaidDiagram = ({ diagram }: MermaidDiagramProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const instanceId = useId().replaceAll(':', '');
  const statusRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    if (statusRef.current) statusRef.current.hidden = true;

    void mermaid
      .render(`voice-diagram-${instanceId}`, diagram)
      .then(({ svg, bindFunctions }) => {
        if (!active || !containerRef.current) return;
        containerRef.current.innerHTML = svg;
        bindFunctions?.(containerRef.current);
      })
      .catch(() => {
        if (!active || !containerRef.current) return;
        containerRef.current.replaceChildren();
        if (statusRef.current) statusRef.current.hidden = false;
      });

    return () => {
      active = false;
    };
  }, [diagram, instanceId]);

  return (
    <div className="mermaid-stage" aria-live="polite">
      <div ref={containerRef} className="mermaid-canvas" />
      <div ref={statusRef} hidden role="status" className="diagram-error">
        The response arrived, but its diagram could not be rendered.
      </div>
    </div>
  );
};
