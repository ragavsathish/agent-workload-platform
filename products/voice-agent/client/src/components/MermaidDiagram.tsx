import { useEffect, useId, useRef, useState } from 'react';

import mermaid from 'mermaid';

import { renderMermaidInto } from '../render-mermaid';

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

    const container = containerRef.current;
    if (!container) return;

    void renderMermaidInto({
      container,
      diagram,
      renderIdPrefix: `voice-diagram-${instanceId}`,
      render: mermaid.render,
      isCurrent: () => active,
    }).then((rendered) => {
      if (!active) return;
      setFailedDiagram((failed) => {
        if (!rendered) return diagram;
        return failed === diagram ? undefined : failed;
      });
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
