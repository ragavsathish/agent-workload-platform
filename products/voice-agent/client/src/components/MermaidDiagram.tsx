import { useEffect, useId, useRef, useState } from 'react';

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
  const [failedDiagram, setFailedDiagram] = useState<string>();

  useEffect(() => {
    let active = true;

    void mermaid
      .render(`voice-diagram-${instanceId}`, diagram)
      .then(({ svg, bindFunctions }) => {
        if (!active || !containerRef.current) return;
        containerRef.current.innerHTML = svg;
        bindFunctions?.(containerRef.current);
        setFailedDiagram((failed) =>
          failed === diagram ? undefined : failed
        );
      })
      .catch(() => {
        if (!active || !containerRef.current) return;
        containerRef.current.replaceChildren();
        setFailedDiagram(diagram);
      });

    return () => {
      active = false;
    };
  }, [diagram, instanceId]);

  return (
    <div className="mermaid-stage" aria-live="polite">
      <div ref={containerRef} className="mermaid-canvas" />
      {failedDiagram === diagram && (
        <div role="status" className="diagram-error">
          The response arrived, but its diagram could not be rendered.
        </div>
      )}
    </div>
  );
};
