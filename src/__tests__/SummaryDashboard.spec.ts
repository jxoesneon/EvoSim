import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import SummaryDashboard from '../components/summary/SummaryDashboard.vue'

// Smoke test: ensure the Summary Dashboard mounts and container exists.
// Async child components may not resolve immediately in unit env, so avoid
// asserting on their inner text here.
describe('SummaryDashboard', () => {
  it('mounts and shows container', async () => {
    const wrapper = mount(SummaryDashboard, {
      global: {
        stubs: {
          SpatialEnvironment: true,
        },
      },
    })
    const container = wrapper.find('#gen-summary-container')
    expect(container.exists()).toBe(true)
  })
})
