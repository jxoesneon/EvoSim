/**
 * Performance monitoring utilities for soak testing and performance regression detection
 */

export interface PerformanceMetrics {
  timestamp: number
  memoryUsed: number
  memoryTotal: number
  fps?: number
  renderTime?: number
  simulationTime?: number
}

export interface PerformanceThresholds {
  maxMemoryGrowth: number // bytes per second
  minFPS: number
  maxRenderTime: number // milliseconds
  maxSimulationTime: number // milliseconds
}

export class PerformanceMonitor {
  private metrics: PerformanceMetrics[] = []
  private isMonitoring = false
  private intervalId?: NodeJS.Timeout
  private startTime = 0

  constructor(
    private thresholds: PerformanceThresholds = {
      maxMemoryGrowth: 10 * 1024 * 1024, // 10MB/s
      minFPS: 30,
      maxRenderTime: 16.67, // 60fps target
      maxSimulationTime: 10,
    },
  ) {}

  startMonitoring(intervalMs = 1000): void {
    if (this.isMonitoring) return

    this.isMonitoring = true
    this.startTime = performance.now()
    this.metrics = []

    this.intervalId = setInterval(() => {
      this.collectMetrics()
    }, intervalMs)
  }

  stopMonitoring(): PerformanceMetrics[] {
    if (!this.isMonitoring) return this.metrics

    this.isMonitoring = false
    if (this.intervalId) {
      clearInterval(this.intervalId)
      this.intervalId = undefined
    }

    return this.metrics
  }

  private collectMetrics(): void {
    const metrics: PerformanceMetrics = {
      timestamp: performance.now(),
      memoryUsed: 0,
      memoryTotal: 0,
    }

    // Collect memory metrics if available
    if ('memory' in performance) {
      const memory = (
        performance as Performance & {
          memory: {
            usedJSHeapSize: number
            totalJSHeapSize: number
            jsHeapSizeLimit: number
          }
        }
      ).memory
      metrics.memoryUsed = memory.usedJSHeapSize
      metrics.memoryTotal = memory.totalJSHeapSize
    }

    // Collect FPS if we can measure it
    metrics.fps = this.measureFPS()
    metrics.renderTime = this.measureRenderTime()
    metrics.simulationTime = this.measureSimulationTime()

    this.metrics.push(metrics)
  }

  private measureFPS(): number {
    // Simple FPS measurement based on recent frames
    const recentMetrics = this.metrics.slice(-10)
    if (recentMetrics.length < 2) return 60

    const timeSpan = recentMetrics[recentMetrics.length - 1].timestamp - recentMetrics[0].timestamp
    return Math.round(((recentMetrics.length - 1) * 1000) / timeSpan)
  }

  private measureRenderTime(): number {
    // This would need to be integrated with the rendering loop
    return Math.random() * 10 // Placeholder
  }

  private measureSimulationTime(): number {
    // This would need to be integrated with the simulation loop
    return Math.random() * 5 // Placeholder
  }

  analyzePerformance(): {
    passed: boolean
    violations: string[]
    summary: {
      avgMemoryGrowth: number
      minFPS: number
      avgRenderTime: number
      avgSimulationTime: number
    }
  } {
    if (this.metrics.length < 2) {
      return {
        passed: false,
        violations: ['Insufficient data for analysis'],
        summary: {
          avgMemoryGrowth: 0,
          minFPS: 0,
          avgRenderTime: 0,
          avgSimulationTime: 0,
        },
      }
    }

    const violations: string[] = []

    // Analyze memory growth
    const memoryGrowthRate = this.calculateMemoryGrowthRate()
    if (memoryGrowthRate > this.thresholds.maxMemoryGrowth) {
      violations.push(
        `Memory growth rate ${(memoryGrowthRate / 1024 / 1024).toFixed(2)}MB/s exceeds threshold ${(this.thresholds.maxMemoryGrowth / 1024 / 1024).toFixed(2)}MB/s`,
      )
    }

    // Analyze FPS
    const fpsValues = this.metrics.map((m) => m.fps || 60).filter((fps) => fps !== undefined)
    const minFPS = Math.min(...fpsValues)
    if (minFPS < this.thresholds.minFPS) {
      violations.push(`Minimum FPS ${minFPS} below threshold ${this.thresholds.minFPS}`)
    }

    // Analyze render times
    const renderTimes = this.metrics.map((m) => m.renderTime || 0).filter((rt) => rt !== undefined)
    const avgRenderTime = renderTimes.reduce((a, b) => a + b, 0) / renderTimes.length
    if (avgRenderTime > this.thresholds.maxRenderTime) {
      violations.push(
        `Average render time ${avgRenderTime.toFixed(2)}ms exceeds threshold ${this.thresholds.maxRenderTime}ms`,
      )
    }

    // Analyze simulation times
    const simTimes = this.metrics.map((m) => m.simulationTime || 0).filter((st) => st !== undefined)
    const avgSimulationTime = simTimes.reduce((a, b) => a + b, 0) / simTimes.length
    if (avgSimulationTime > this.thresholds.maxSimulationTime) {
      violations.push(
        `Average simulation time ${avgSimulationTime.toFixed(2)}ms exceeds threshold ${this.thresholds.maxSimulationTime}ms`,
      )
    }

    return {
      passed: violations.length === 0,
      violations,
      summary: {
        avgMemoryGrowth: memoryGrowthRate,
        minFPS,
        avgRenderTime,
        avgSimulationTime,
      },
    }
  }

  private calculateMemoryGrowthRate(): number {
    if (this.metrics.length < 2) return 0

    const first = this.metrics[0]
    const last = this.metrics[this.metrics.length - 1]
    const timeSpan = (last.timestamp - first.timestamp) / 1000 // Convert to seconds
    const memoryGrowth = last.memoryUsed - first.memoryUsed

    return timeSpan > 0 ? memoryGrowth / timeSpan : 0
  }

  getMetrics(): PerformanceMetrics[] {
    return [...this.metrics]
  }

  reset(): void {
    this.stopMonitoring()
    this.metrics = []
    this.startTime = 0
  }
}

// Global performance monitor instance for easy access
export const performanceMonitor = new PerformanceMonitor()

// Utility functions for common performance checks
export function checkMemoryLeaks(thresholdMB = 50): boolean {
  const analysis = performanceMonitor.analyzePerformance()
  const memoryGrowthMB = analysis.summary.avgMemoryGrowth / 1024 / 1024
  return memoryGrowthMB < thresholdMB
}

export function checkFPSStability(minFPS = 30): boolean {
  const analysis = performanceMonitor.analyzePerformance()
  return analysis.summary.minFPS >= minFPS
}

export function generatePerformanceReport(): string {
  const analysis = performanceMonitor.analyzePerformance()
  const metrics = performanceMonitor.getMetrics()

  return `
Performance Report
==================
Duration: ${metrics.length > 0 ? ((metrics[metrics.length - 1].timestamp - metrics[0].timestamp) / 1000).toFixed(1) : 0}s
Samples: ${metrics.length}

Memory:
- Growth Rate: ${(analysis.summary.avgMemoryGrowth / 1024 / 1024).toFixed(2)} MB/s
- Current Usage: ${metrics.length > 0 ? (metrics[metrics.length - 1].memoryUsed / 1024 / 1024).toFixed(2) : 0} MB

Performance:
- Min FPS: ${analysis.summary.minFPS}
- Avg Render Time: ${analysis.summary.avgRenderTime.toFixed(2)} ms
- Avg Simulation Time: ${analysis.summary.avgSimulationTime.toFixed(2)} ms

Status: ${analysis.passed ? 'PASS' : 'FAIL'}
${analysis.violations.length > 0 ? 'Violations:\n' + analysis.violations.map((v) => `- ${v}`).join('\n') : ''}
  `.trim()
}
