# EvoSim 🧬

An evolutionary simulation combining neural networks, physics, metabolism, and genetics. Creatures evolve through natural selection, learning to survive in a dynamic procedurally-generated environment.

## ✨ Features

- **Neural Network Brains**: Feed-forward networks with configurable activation functions
- **Physics Simulation**: Movement, collision detection, terrain effects
- **Metabolic Cost System**: Energy, stamina, health, thirst mechanics
- **Mendelian Genetics**: Vision trait inheritance (V/v, E/e alleles)
- **WebGL Rendering**: 2D/3D hybrid visualization with Three.js
- **Web Workers**: Off-main-thread simulation for 60 FPS
- **WASM Backend**: Optional Rust-powered high-performance simulation
- **Procedural Generation**: Dynamic weather, terrain, and ecosystems

## 🚀 Quick Start

### Prerequisites

- Node.js 18+
- npm 9+

### Installation

```sh
npm install
```

### Development

```sh
npm run dev
```

Open [http://localhost:5173](http://localhost:5173)

### Production Build

```sh
npm run build
npm run preview
```

## 🧪 Testing

### Unit Tests (Vitest)

```sh
npm run test:unit              # Run all unit tests
npm run test:unit -- --watch   # Watch mode
npm run test:unit -- --coverage # Coverage report
```

**Current Coverage**: 80 passing tests covering brain logic, physics, and metabolism

### End-to-End Tests (Playwright)

```sh
# Install browsers (first time only)
npx playwright install

# Run E2E tests
npm run test:e2e

# Specific browser
npm run test:e2e -- --project=chromium
npm run test:e2e -- --project=firefox
npm run test:e2e -- --project=webkit

# Debug mode
npm run test:e2e -- --debug
```

**Current Coverage**: 10 smoke tests across 3 browsers (30 total test runs)

## 📁 Project Structure

```
EvoSim/
├── src/
│   ├── components/        # Vue components
│   │   ├── summary/       # Dashboard & analytics
│   │   └── *.vue          # UI components
│   ├── composables/       # Vue composables (state, prefs)
│   │   └── useSimulationStore.ts  # Main simulation state
│   ├── webgl/             # Three.js renderer
│   │   └── renderer.ts    # WebGL rendering logic
│   ├── workers/           # Web Workers
│   │   ├── sim.worker.ts  # Simulation loop (JS)
│   │   ├── weather2d.worker.ts
│   │   ├── terrain.worker.ts
│   │   └── noise3d.worker.ts
│   ├── wasm/              # WASM bindings (optional)
│   │   └── ecosim/        # Rust simulation backend
│   ├── zegion/            # Modular brain system
│   │   ├── activations/   # Activation functions
│   │   └── plasticity/    # Neuroplasticity (experimental)
│   └── __tests__/         # Unit tests
├── e2e/                   # E2E tests
├── docs/                  # Documentation
└── public/                # Static assets
```

## 🧠 Architecture

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for detailed technical documentation.

### Key Components

1. **State Management**: `useSimulationStore.ts` - Single source of truth
2. **Simulation Loop**: `sim.worker.ts` - Physics, brains, metabolism (60 FPS)
3. **Rendering**: `renderer.ts` - WebGL visualization
4. **WASM Backend**: Optional Rust simulation for 10-100x speedup

## 🛠️ Tech Stack

- **Frontend**: Vue 3, TypeScript, TailwindCSS, DaisyUI
- **Rendering**: Three.js (WebGL)
- **Build**: Vite
- **Testing**: Vitest (unit), Playwright (E2E)
- **Backend**: Web Workers, Optional WASM (Rust)

## 📊 Performance

- **Target**: 60 FPS with 1000+ entities
- **Optimization**: InstancedMesh, SharedArrayBuffer, worker threads
- **Profiling**: Built-in FPS meter, telemetry panels

## 🎮 Usage

### Controls

- **Start/Stop**: Control simulation state
- **Reset**: New generation
- **+Creature/+Plant**: Add entities
- **Speed Slider**: Adjust simulation speed
- **Vision Toggle**: Show/hide vision cones

### UI Panels

- **Stats**: Population, movement, genetics
- **Telemetry**: Cost system, action events
- **Hall of Fame**: Top creatures by lifespan

## 🔧 Development

### Code Quality

```sh
npm run lint              # ESLint
npm run type-check        # TypeScript type checking
```

### IDE Setup

**Recommended**: [VSCode](https://code.visualstudio.com/) + [Volar](https://marketplace.visualstudio.com/items?itemName=Vue.volar)

## 🐛 Debugging

### Browser DevTools

- **Console**: Simulation events, WASM status, cost telemetry
- **Performance**: FPS profiling, worker thread activity
- **Network**: Asset loading, worker script fetching

### Error Boundaries

App includes Vue error boundaries with:

- Error message display
- Stack trace viewer
- Graceful recovery or reload options

## 📖 Documentation

- **Architecture**: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- **Cost System**: [`Cost.md`](Cost.md)
- **Neural Inputs**: [`inputs.md`](inputs.md)
- **API Docs**: Generated from JSDoc comments

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Write tests for your changes
4. Ensure all tests pass (`npm run test:unit && npm run test:e2e`)
5. Commit your changes (`git commit -m 'Add amazing feature'`)
6. Push to the branch (`git push origin feature/amazing-feature`)
7. Open a Pull Request

## 📝 License

This project is licensed under the MIT License.

## 🙏 Acknowledgments

- Three.js for WebGL rendering
- Vue 3 for reactive UI
- Vite for blazing-fast development
- Playwright & Vitest for comprehensive testing

## Telemetry and Parity Validators

This project includes runtime telemetry from the WASM backend and lightweight validators in the Vue store to help tune and verify parity between the Rust and JS models.

- Enable in `src/composables/useSimulationStore.ts` by setting:
  - `simulationParams.enableCostTelemetry = true`
  - `simulationParams.debugLogging = true`
- Environmental cost parity (per creature):
  - Logs: `[WASM EnvCost JS-Recompute]`, `[WASM Locomotion JS-Recompute]`
  - Compares WASM-reported components (wind, cold, heat, humidity, oxygen, noise, disease, locomotion) with a JS recomputation.
- Corpse decay parity (per corpse, sampled up to 5):
  - Logs: `[WASM CorpseDecay Validator]` ensures `total ≈ base + temp + humid + rain + wet`.
  - Logs: `[WASM CorpseDecay JS-Recompute]` and `... Total` compare WASM telemetry vs JS recomputation using the same formula.

Corpse decay formula (Rust and JS mirror):

```
base = max(0, corpseBaseDecayPerSec)
tempTerm = clamp((temperatureC - 20) / 15, 0, 2)
temp  = base * corpseTempDecayCoeff     * tempTerm
humid = base * corpseHumidityDecayCoeff * humidity01
rain  = base * corpseRainDecayCoeff     * precipitation01
wet   = base * corpseWetnessDecayCoeff  * wetness01
total = max(0, base + temp + humid + rain + wet)
```

Use the console logs to tune the coefficients in `simulationParams` (mirrored into the WASM config via `buildWasmConfig()`) until drift is within tolerances.
