// Documentation fixture: compile this in a React MCP App; it adds no runtime here.
import '../elements.css';
export function PiButton({ children, ...props }) {
  return <button className="pi-button" {...props}>{children}</button>;
}

export function PiAppHeader({ identity, navigation = [], actions }) {
  return (
    <header className="pi-app-header">
      <div className="pi-app-header__identity">{identity}</div>
      <div className="pi-app-header__actions">
        <nav className="pi-app-header__nav" aria-label="Primary navigation">
          {navigation.map(({ href, label, icon, current }) => (
            <a key={href} href={href} aria-current={current ? 'page' : undefined}>
              {icon && <span className="pi-icon" data-pi-icon={icon} aria-hidden="true" />}
              {label}
            </a>
          ))}
        </nav>
        {actions}
      </div>
    </header>
  );
}
