# Generation Summary Popup — Concepts

This document lists the information architecture and visualization concepts for a best-in-class generation-end summary. Items are grouped into Must-haves (core) and Nice-to-haves (enhancements), aligned with current and planned data sources in `src/composables/useSimulationStore.ts`.

## Must-haves (Core)

- **Overview KPIs**
  - Generation number, end reason, timestamp.
  - Population counts: creatures alive/dead/newborns; plants/corpses at end.
  - Performance: average movement speed for the generation.
  - Generation duration (ticks/seconds) and stagnation ticks at end.
  - UI/UX: Compact KPI cards in a responsive 2–4 column grid; color-coded deltas; tooltips with definitions; copy-to-clipboard on click.

- **Top Performers (Hall of Fame)**
  - Top N creatures by lifespan with IDs and names.
  - UI/UX: Scrollable list with avatar/color dot, truncated names, lifespan badge; hover to reveal quick actions (Focus, Stats), click opens details.

- **Population Dynamics Chart**
  - Time series (per tick/interval) of total population, births, deaths.
  - If time series unavailable, show start vs end counts as a delta bar.
  - UI/UX: Stacked area chart with toggle for smoothing; legend with clickable series; brush/zoom; empty-state delta bars when no series.

- **Movement & Activity**
  - Speed distribution (histogram) and average speed trend (line).
  - Stagnation metric vs configured threshold.
  - UI/UX: Side-by-side histogram and mini-line; threshold shown as dashed reference line; tooltip showing percentile; toggle linear/log bins.

- **Environment Summary**
  - End-of-gen snapshot of key environment settings: plant spawn rate, water level, weather opacity.
  - Deltas vs previous generation values.
  - UI/UX: Card list with labeled values and delta arrows; inline edit affordance to jump to Controls section.

- **Next-Generation Controls**
  - Sliders for: mutation rate, mutation amount, movement threshold, stagnant ticks limit, plant spawn rate, water level.
  - Presets: “Exploration bias”, “Conservative”, “Resource-rich”.
  - Primary actions: Start next generation; Start with preset.
  - UI/UX: Collapsible panel with grouped sliders, value badges, reset-to-default; preset pills with preview chips; primary CTA docked at bottom.

## Nice-to-haves (Bells & Whistles)

- **Comparisons & Trends**
  - Sparklines comparing the last 3–5 generations for: avg speed, population size, births/deaths.
  - Delta callouts (e.g., “+12% avg speed vs last gen”).
  - UI/UX: Row of sparkline cards with small legends; hover reveals exact values; delta chips next to titles.

- **Survival/Fitness Analytics**
  - Survival curve (Kaplan–Meier style) over the generation.
  - Scatter: lifespan vs average speed (outlier labeling).
  - Box plots: lifespan stratified by diet or phenotype cluster.
  - UI/UX: Tabbed sub-section with 3 charts; consistent color palette per grouping; lasso/hover to highlight individuals; export per-chart.

- **Genetics/Brains**
  - Gene distribution summaries (e.g., histogram for eyes count; allele frequency for V/v, E/e if recorded).
  - Brain architecture: most common layer sizes; activation usage breakdown (Zegion mode).
  - “Bad brain” library growth: count and list of new hashes added this gen.
  - UI/UX: Grid of small multiples; click to expand details; badges for significant shifts; copy-to-clipboard for brain hashes.

- **Spatial Ecology**
  - Heatmap of activity or deaths across the map.
  - Resource map overlay (plants/water) contrasted with creature paths (sampled).
  - UI/UX: Toggleable layers on a mini-map; opacity sliders; legend; click to inspect cell stats.

- **Behavior & Events**
  - Event counters: fights, feeding events, mating attempts, rest events (requires telemetry).
  - Timeline of notable events (peaks in deaths, births, starvation episodes).
  - UI/UX: KPI chips with icons and tooltips; event timeline with markers; click marker to filter related creatures.

- **Environment & Weather**
  - Weather timeline (temperature, precipitation, wind) vs activity/health (if tracked during the gen).
  - Terrain influence: survival by elevation/wetness buckets.
  - UI/UX: Dual-axis line with selectable overlays; small multiples for bucketed survival; annotation pins for extremes.

- **Anomalies & Insights**
  - Automated highlights: “Mortality spike mid-generation.”
  - Recommendations: parameter suggestions (e.g., “Increase plant spawn rate by 0.3”, “Lower movement threshold by 0.01”).
  - UI/UX: Dismissible alert cards with severity colors; one-click “apply suggestion” buttons; link to rationale.

- **Exploration Tools**
  - Drill-down tabs: per species/diet, per-phenotype controls.
  - Click-to-focus on a top performer for details.
  - Snapshot browser: open and compare saved `saveGenerationSnapshot()` payloads.
  - UI/UX: Tabs with breadcrumb; side panel for selection; split-view compare with diff highlights.

- **Export & Sharing**
  - Export charts as PNG/SVG.
  - Export summary as JSON/CSV.
  - Copy settings to clipboard for next-gen presets.
  - UI/UX: Overflow menu per chart and global export in footer; progress toast; file naming with gen number.

- **UX Polish**
  - Collapsible sections with remembered expand/collapse state.
  - Tag badges for this gen (e.g., “Fastest avg so far”).
  - Light/Dark theme parity and accessible color choices.
  - UI/UX: Persisted expand state in local storage; auto-created badges with contrast-checked colors; keyboard navigation and ARIA labels.

## Biology & Population

- Diversity index (Shannon/Simpson) across key traits. [nice]
- UI/UX: Single KPI with info tooltip and sparkline over last gens; hover shows formula.
- Population composition by diet/phenotype cluster (stacked bars). [nice]
- UI/UX: Stacked bar with percentage labels; toggle absolute/percent; legend with selectable segments.
- Reproduction stats: mating attempts, successful births, avg gestation, fertility rate. [must, needs instrumentation]
- UI/UX: KPI grid with mini-bars; tooltip definitions; link to event log filter.
- Causes of death: starvation, combat, age, environment (distribution). [must, needs instrumentation]
- UI/UX: Donut chart with inline legend and percentages; click segment to highlight deaths on timeline/map.
- Lineage snapshots: ancestry of top performers, family counts. [nice, needs instrumentation]
- UI/UX: Tree mini-graph with zoom-on-hover; click to open full lineage view.

## Behavior & Actions

- Action usage profile: time spent moving/resting/feeding/fighting/mating. [must, needs instrumentation]
- UI/UX: Horizontal stacked bars per action; hover shows exact durations and percentages.
- Sprint/rest ratios; average rest bout length. [nice, needs instrumentation]
- UI/UX: Ratio chip with trend arrow; distribution whisker plot for bout lengths.
- Signaling/communication frequency and dominant color/intensity. [nice, needs instrumentation]
- UI/UX: Color strip histogram; tooltip shows RGB and frequency; click copies color.
- Interaction matrix density (creature–creature interactions). [nice, needs instrumentation]
- UI/UX: Heatmap with clustering; hover shows pair stats; zoom to submatrix.

## Health, Energy, Resources

- Energy economy: avg energy in/out (consumption vs gains), net balance. [must, needs instrumentation]
- UI/UX: Waterfall chart for in/out components; net badge; hover to see contributors.
- Health trajectory summary (median trend, recovery events). [nice, needs instrumentation]
- UI/UX: Median line with shaded IQR; markers for recoveries; toggle highlight for critical dips.
- Threshold time: thirst/stamina/health under critical levels. [nice, needs instrumentation]
- UI/UX: Bar trio with percentage-of-time under thresholds; click to see time windows.
- Resource balance: plants spawned vs consumed; average time-to-food. [must, partial now; needs sampling]
- UI/UX: Dual bars with delta; mini-distribution for time-to-food.

## Genetics & Brains

- Phenotype distributions (e.g., eyes count, FOV, sight range) as histograms. [must if tracked]
- UI/UX: Small multiple histograms with shared axes; hover shows percentile; toggle bin size.
- Allele frequency changes per generation (V/v, E/e). [nice, needs allele tracking]
- UI/UX: Diverging bar chart; sparkline for last gens; significance badge when crossing thresholds.
- Mutation heatmap (genes and magnitude per gen). [nice, needs instrumentation]
- UI/UX: Heatmap with tooltip for (gene, magnitude) counts; filter by gene.
- Brain architecture distribution (layer sizes) and activation usage (Zegion). [nice, partial now]
- UI/UX: Sankey or stacked bars; hover reveals architecture frequencies; click to inspect example brains.
- Bad-brain updates: new hashes this gen; total blocked so far. [must, available]
- UI/UX: KPI with copy buttons; expandable list of hashes; search/filter.

## Spatial & Environment

- Heatmaps: activity, deaths, feeding hotspots. [nice, needs sampled positions]
- UI/UX: Toggle chips for layer visibility; opacity sliders; mini-map thumbnails switch.
- Territory/cluster detection (e.g., DBSCAN) to show subpopulations. [nice, needs clustering]
- UI/UX: Colored cluster overlays with convex hulls; legend shows counts; click isolates cluster.
- Weather timeline overlays vs activity/deaths. [nice, needs time series]
- UI/UX: Multi-select overlay controls; synchronized cursors across charts.
- Terrain influence: survival by elevation/wetness buckets. [nice, needs sampling]
- UI/UX: Grouped bars with confidence shading; tooltip shows N per bucket.

## Temporal & Events

- Timeline of notable events (birth/death spikes, starvation waves). [nice, needs event logs]
- UI/UX: Annotated timeline with collapsible event categories; hover shows window stats.
- Survival curve (Kaplan–Meier). [nice, needs per-tick status or event times]
- UI/UX: Step function with confidence bands; toggle groups (diet/phenotype).
- Distribution of time-to-stagnation; count of stagnation episodes vs threshold. [must, partial now]
- UI/UX: Histogram with vertical threshold markers; chip badge for episodes count.

## Insights & Recommendations

- Auto-insights: anomaly detection (mortality spikes, collapses). [nice]
- UI/UX: Insight cards with highlight color; click to navigate to affected charts with applied filters.
- Parameter suggestions (e.g., increase plant spawn rate by 0.3; lower movement threshold by 0.01). [nice]
- UI/UX: Inline suggestion chips with “Apply” and “Discard”; snackbar confirmation on apply.
- Records/milestones: fastest avg speed, highest births, lowest mortality, etc. [nice]
- UI/UX: Badge wall with sortable list; trophies for all-time records.

## Controls & Workflow

- Presets with previews of expected impact (based on past data). [nice]
- UI/UX: Preset cards with sparkline previews; hover shows parameter diffs.
- Counterfactuals: queue two parameter sets and compare next gen. [nice]
- UI/UX: Two-column compare layout; diff badges on KPIs and charts.
- A/B quick-run button for the next generation (small sample). [nice]
- UI/UX: Split-CTA button with dropdown; progress badges for each run.
- Scenario queue: schedule multiple gens with parameter changes. [nice]
- UI/UX: Reorderable list with timeline view; status pills per step.

## Performance & System

- FPS and update step stats (avg/min/max) during the gen. [nice]
- UI/UX: Inline mini-metrics in header; expand for detailed distribution.
- WASM vs JS path proportions; cache trims/hits (e.g., brainCache). [nice]
- UI/UX: Donut chart with legends; hover shows counts and ratios.
- Data integrity warnings: dropped frames, overflowed buffers. [nice]
- UI/UX: Alert banners with context link to troubleshooting.

## Visualizations to Add

- Stacked area for births/deaths vs total population. [must]
- UI/UX: Smooth curves with stacking; toggle normalized view; legend interactions.
- Distributions: histograms/violin for speed, lifespan, eyes count. [must if data available]
- UI/UX: Switchable histogram/violin; shared scales; density overlay toggle.
- Scatter: lifespan vs avg speed (color by diet/cluster). [nice]
- UI/UX: Scatter with trend line; brush to select outliers; tooltip shows creature link.
- Heatmaps: spatial density; interaction matrix. [nice]
- UI/UX: Adjustable color scales; tooltips; export as PNG.
- Sparklines across the last 5 gens for avg speed, population, births/deaths. [nice]
- UI/UX: Minimal axes; hover crosshair; small captions with last value and delta.

## Data & Instrumentation Notes

- Current snapshot fields: creatures/plants/corpses arrays, `movementStats.avgSpeed`, `simulationParams`, `badBrainHashes`.
- Time series/heatmaps require lightweight accumulation during the generation (tick sampling). If WASM provides hooks, prefer that path for efficiency.
- Spatial visualizations need positional sampling (e.g., per N ticks) to keep memory bounded.

- Additional instrumentation recommended:
  - Event logs for births, deaths (with cause), fights, feeds, rests, mating (timestamps + IDs). 
  - Periodic sampling (per N ticks) for positions, health, energy, current action/state.
  - Gene mutation records per creature per generation (what mutated, magnitude).
  - Weather/terrain samples over time windows, aligned with tick indices.
  - Performance metrics accumulation (FPS, step durations, GC spikes if observable).

## ASCII Wireframe — Proposed Layout

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ Header                                                                      │
│ ┌─────────────┬─────────────┬─────────────┬─────────────┐  [Actions]        │
│ │ Gen # / End │ Avg Speed   │ Pop (Live)  │ Duration    │  Export ▾         │
│ │ Reason/Time │ Δ vs last   │ Births/Deaths│ Stagnation │                   │
│ └─────────────┴─────────────┴─────────────┴─────────────┘                   │
└──────────────────────────────────────────────────────────────────────────────┘

┌───────────────────────────────┬──────────────────────────────────────────────┐
│ Population Dynamics           │ Movement & Activity                          │
│ ┌───────────────────────────┐ │ ┌───────────────────────┬──────────────────┐ │
│ │ Stacked area: total/b/d   │ │ │ Histogram: speeds     │ Avg speed trend  │ │
│ │ + brush/legend toggles    │ │ │ (bins toggle)         │ (line, threshold)│ │
│ └───────────────────────────┘ │ └───────────────────────┴──────────────────┘ │
└───────────────────────────────┴──────────────────────────────────────────────┘

┌───────────────────────────────┬──────────────────────────────────────────────┐
│ Hall of Fame (Top N)          │ Environment Summary                          │
│ ┌───────────────────────────┐ │ ┌──────────────────────────────────────────┐ │
│ │ List w/ avatars, actions  │ │ │ Cards: plant spawn, water, weather, Δ   │ │
│ │ (Focus, Stats)            │ │ │ (inline edit -> scroll to Controls)     │ │
│ └───────────────────────────┘ │ └──────────────────────────────────────────┘ │
└───────────────────────────────┴──────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────────┐
│ Comparisons & Trends                                                          │
│ ┌──────────────────────────────────────────────────────────────────────────┐ │
│ │ Row of sparkline KPI cards (last 3–5 gens, with delta chips)            │ │
│ └──────────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────────┘

┌───────────────────────────────┬──────────────────────────────────────────────┐
│ Genetics & Brains             │ Behavior & Events                            │
│ ┌───────────────────────────┐ │ ┌──────────────────────────────────────────┐ │
│ │ Small multiples: traits   │ │ │ Event counters + timeline (markers)      │ │
│ │ + bad-brain updates       │ │ │                                           │ │
│ └───────────────────────────┘ │ └──────────────────────────────────────────┘ │
└───────────────────────────────┴──────────────────────────────────────────────┘

┌───────────────────────────────┬──────────────────────────────────────────────┐
│ Spatial & Environment         │ Insights & Recommendations                    │
│ ┌───────────────────────────┐ │ ┌──────────────────────────────────────────┐ │
│ │ Mini-map: togglable layers│ │ │ Dismissible insight cards + Apply btns   │ │
│ │ (activity/deaths/resources)││ │                                           │ │
│ └───────────────────────────┘ │ └──────────────────────────────────────────┘ │
└───────────────────────────────┴──────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────────┐
│ Controls (Collapsible)                                                        │
│ ┌──────────────────────────────────────────────────────────────────────────┐ │
│ │ Grouped sliders: mutation, movement threshold, plants, water, etc.       │ │
│ │ Preset pills (preview chips). Reset-to-default.                          │ │
│ │ Footer CTA: [Start Next Generation]  [Start with Preset ▾]               │ │
│ └──────────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────────┐
│ Footer                                                                        │
│ Export summary ▾   Copy settings   Help/Docs                                  │
└──────────────────────────────────────────────────────────────────────────────┘
