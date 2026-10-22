// Documentation fixture: compile this in a React MCP App; it adds no runtime here.
import '../elements.css';
export function PiButton({ children, ...props }) {
  return <button className="pi-button" {...props}>{children}</button>;
}
