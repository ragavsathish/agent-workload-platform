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
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    setError(false);

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
        setError(true);
      });

    return () => {
      active = false;
    };
  }, [diagram, instanceId]);

  return (
    <div className="mermaid-stage" aria-live="polite">
      <div ref={containerRef} className="mermaid-canvas" />
      {error && (
        <div role="status" className="diagram-error">
          The response arrived, but its diagram could not be rendered.
        </div>
      )}
    </div>
  );
};
