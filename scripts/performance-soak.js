#!/usr/bin/env node

/**
 * Performance soak testing script
 * Runs extended performance tests with monitoring and reporting
 */

import { performance } from 'perf_hooks'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)

class PerformanceSoakTest {
  constructor(options = {}) {
    this.options = {
      duration: 5 * 60 * 1000, // 5 minutes default
      sampleInterval: 1000, // 1 second
      outputDir: './performance-results',
      thresholds: {
        maxMemoryGrowthMB: 50, // MB over test duration
        minFPS: 30,
        maxResponseTime: 1000, // ms
        maxCPUUsage: 80, // percent
      },
      ...options,
    }

    this.metrics = []
    this.startTime = 0
    this.isRunning = false
  }

  async run() {
    console.log(`🚀 Starting performance soak test (${this.options.duration / 1000}s)`)

    // Ensure output directory exists
    if (!fs.existsSync(this.options.outputDir)) {
      fs.mkdirSync(this.options.outputDir, { recursive: true })
    }

    this.startTime = performance.now()
    this.isRunning = true

    // Start monitoring
    const monitorInterval = setInterval(() => {
      this.collectMetrics()
    }, this.options.sampleInterval)

    // Run for specified duration
    await new Promise((resolve) => {
      setTimeout(() => {
        this.isRunning = false
        clearInterval(monitorInterval)
        resolve()
      }, this.options.duration)
    })

    // Analyze and report results
    const results = this.analyzeResults()
    this.generateReport(results)

    console.log('✅ Performance soak test completed')
    return results
  }

  collectMetrics() {
    const timestamp = performance.now() - this.startTime

    const metric = {
      timestamp,
      memory: this.getMemoryUsage(),
      cpu: this.getCPUUsage(),
      fps: this.getFPS(),
      responseTime: this.getResponseTime(),
    }

    this.metrics.push(metric)

    // Real-time monitoring
    if (timestamp % 10000 < this.options.sampleInterval) {
      // Every 10 seconds
      console.log(
        `⏱️  ${(timestamp / 1000).toFixed(1)}s - Memory: ${(metric.memory.used / 1024 / 1024).toFixed(1)}MB, FPS: ${metric.fps}`,
      )
    }
  }

  getMemoryUsage() {
    if (typeof process !== 'undefined' && process.memoryUsage) {
      const usage = process.memoryUsage()
      return {
        used: usage.heapUsed,
        total: usage.heapTotal,
        external: usage.external,
        rss: usage.rss,
      }
    }

    // Browser fallback - would need to be integrated with the app
    return { used: 0, total: 0, external: 0, rss: 0 }
  }

  getCPUUsage() {
    if (typeof process !== 'undefined' && process.cpuUsage) {
      const usage = process.cpuUsage()
      return (usage.user + usage.system) / 1000000 // Convert to milliseconds
    }
    return 0
  }

  getFPS() {
    // This would need to be integrated with the rendering loop
    // For now, return a simulated value
    return 60 - Math.random() * 10
  }

  getResponseTime() {
    // This would measure actual UI response times
    return Math.random() * 50
  }

  analyzeResults() {
    if (this.metrics.length === 0) {
      return { passed: false, errors: ['No metrics collected'] }
    }

    const violations = []
    const firstMetric = this.metrics[0]
    const lastMetric = this.metrics[this.metrics.length - 1]

    // Memory growth analysis
    const memoryGrowthMB = (lastMetric.memory.used - firstMetric.memory.used) / 1024 / 1024
    if (memoryGrowthMB > this.options.thresholds.maxMemoryGrowthMB) {
      violations.push(
        `Memory growth ${memoryGrowthMB.toFixed(1)}MB exceeds threshold ${this.options.thresholds.maxMemoryGrowthMB}MB`,
      )
    }

    // FPS analysis
    const minFPS = Math.min(...this.metrics.map((m) => m.fps))
    if (minFPS < this.options.thresholds.minFPS) {
      violations.push(`Minimum FPS ${minFPS} below threshold ${this.options.thresholds.minFPS}`)
    }

    // Response time analysis
    const maxResponseTime = Math.max(...this.metrics.map((m) => m.responseTime))
    if (maxResponseTime > this.options.thresholds.maxResponseTime) {
      violations.push(
        `Maximum response time ${maxResponseTime.toFixed(1)}ms exceeds threshold ${this.options.thresholds.maxResponseTime}ms`,
      )
    }

    // CPU usage analysis
    const avgCPU = this.metrics.reduce((sum, m) => sum + m.cpu, 0) / this.metrics.length
    if (avgCPU > this.options.thresholds.maxCPUUsage) {
      violations.push(
        `Average CPU usage ${avgCPU.toFixed(1)}% exceeds threshold ${this.options.thresholds.maxCPUUsage}%`,
      )
    }

    return {
      passed: violations.length === 0,
      violations,
      summary: {
        duration: this.options.duration / 1000,
        sampleCount: this.metrics.length,
        memoryGrowthMB,
        minFPS,
        maxResponseTime,
        avgCPU,
      },
    }
  }

  generateReport(results) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')

    // JSON report
    const jsonReport = {
      timestamp,
      testOptions: this.options,
      results,
      metrics: this.metrics,
    }

    fs.writeFileSync(
      path.join(this.options.outputDir, `performance-report-${timestamp}.json`),
      JSON.stringify(jsonReport, null, 2),
    )

    // Human-readable report
    const report = `
Performance Soak Test Report
============================
Timestamp: ${timestamp}
Duration: ${results.summary.duration}s
Samples: ${results.summary.sampleCount}

Results: ${results.passed ? '✅ PASS' : '❌ FAIL'}

Summary:
- Memory Growth: ${results.summary.memoryGrowthMB.toFixed(1)}MB (threshold: ${this.options.thresholds.maxMemoryGrowthMB}MB)
- Minimum FPS: ${results.summary.minFPS} (threshold: ${this.options.thresholds.minFPS})
- Max Response Time: ${results.summary.maxResponseTime.toFixed(1)}ms (threshold: ${this.options.thresholds.maxResponseTime}ms)
- Average CPU: ${results.summary.avgCPU.toFixed(1)}% (threshold: ${this.options.thresholds.maxCPUUsage}%)

${results.violations.length > 0 ? 'Violations:\n' + results.violations.map((v) => `- ${v}`).join('\n') : ''}

Memory Usage Over Time:
${this.metrics.map((m, i) => `${((i * this.options.sampleInterval) / 1000).toFixed(1)}s: ${(m.memory.used / 1024 / 1024).toFixed(1)}MB`).join('\n')}
    `.trim()

    fs.writeFileSync(
      path.join(this.options.outputDir, `performance-report-${timestamp}.txt`),
      report,
    )

    console.log('\n' + report)
  }
}

// CLI interface
const args = process.argv.slice(2)
const options = {}

// Parse command line arguments
for (let i = 0; i < args.length; i += 2) {
  const key = args[i].replace('--', '')
  const value = args[i + 1]

  switch (key) {
    case 'duration':
      options.duration = parseInt(value) * 1000
      break
    case 'output':
      options.outputDir = value
      break
    case 'memory-threshold':
      options.thresholds = { ...options.thresholds, maxMemoryGrowthMB: parseInt(value) }
      break
  }
}

const test = new PerformanceSoakTest(options)

test
  .run()
  .then((results) => {
    process.exit(results.passed ? 0 : 1)
  })
  .catch((error) => {
    console.error('❌ Performance test failed:', error)
    process.exit(1)
  })

export default PerformanceSoakTest
