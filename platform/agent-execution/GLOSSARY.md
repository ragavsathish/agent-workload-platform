# Agent Execution

This context provides isolated execution sessions through which products expose
explicit workspaces and capabilities to an agent.

## Language

**Agent Session**:
A bounded lifetime in which an agent can invoke an explicitly configured set of
capabilities.
_Avoid_: Runtime, VM

**Workspace Mount**:
The product-selected directory tree visible to an Agent Session.
_Avoid_: Host filesystem, repository access

**Capability Surface**:
The complete set of operations exposed to an Agent Session.
_Avoid_: All tools, permissions

**Capability Provider**:
A service that contributes operations to a Capability Surface through a stable
contract.
_Avoid_: Plugin, helper
