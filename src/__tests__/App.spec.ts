import { describe, it, expect } from 'vitest'

import { mount } from '@vue/test-utils'
import App from '../App.vue'

describe('App', () => {
  it('mounts renders properly', () => {
    const wrapper = mount(App)
    // Check for a stable piece of UI text from the ControlPanel
    expect(wrapper.text()).toContain('Start')
  })
})
