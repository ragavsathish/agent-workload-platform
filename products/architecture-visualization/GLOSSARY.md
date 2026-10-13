# Architecture Visualization

This context turns architecture knowledge into visual views that remain
reviewable as both source and rendered artifacts.

## Language

**Architecture Model**:
The source of truth for software elements, relationships, and boundaries.
_Avoid_: Diagram, drawing

**View**:
A deliberate projection of an Architecture Model for a specific audience or
question.
_Avoid_: Full model, picture

**C4 View**:
A View scoped to one C4 abstraction level or an explicit dynamic or deployment
perspective.
_Avoid_: C4 diagram

**Scene**:
An editable visual representation of a View with shapes, text, and routing.
_Avoid_: Model, source

**Render Artifact**:
A portable output derived from a Scene for review or distribution.
_Avoid_: Source of truth

**Layout Fallback**:
An optional rendering path used when the primary deterministic layout cannot
represent a View adequately.
_Avoid_: Main renderer
