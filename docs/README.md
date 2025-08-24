# EvoSim Documentation

Last updated: 2025-08-23

- Architecture
  - See `ARCHITECTURE.md` for WASM + Zegion integration, store responsibilities, renderer, UI composition, and data flow diagram.
- Telemetry
  - See `TELEMETRY.md` for telemetry fields, sampling cadence, retention, and consumer components.
- Components
  - See `COMPONENTS.md` for props/emits and store usage of key components and summary panels.
- Contributing
  - See `CONTRIBUTING.md` for a checklist to add new simulation parameters across Store → WASM → UI → Telemetry → Renderer.

- Design Decisions
  - See `DESIGN_DECISIONS.md` for rationale behind instanced rendering, telemetry ring buffers, cumulative event diffing, and store/WASM config propagation.
