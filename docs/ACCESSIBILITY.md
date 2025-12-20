# Accessibility Guidelines

## Overview

EvoSim aims to be accessible to users with diverse abilities. This document outlines accessibility considerations and testing procedures.

## WCAG 2.1 Compliance

Target: **WCAG 2.1 Level AA**

### Current Implementation

#### Perceivable

- **Text Alternatives**: Buttons have accessible names via ARIA labels
- **Color Contrast**: DaisyUI theme provides sufficient contrast for most UI elements
- **Adaptable Layout**: Responsive design adapts to different viewports
- **Distinguishable**: Error boundaries provide clear error messages

#### Operable

- **Keyboard Accessible**: All controls accessible via keyboard navigation
- **Focus Visible**: DaisyUI provides focus indicators
- **Navigation**: Logical tab order through interactive elements

#### Understandable

- **Readable**: Clear labels and tooltips
- **Predictable**: Consistent UI patterns
- **Input Assistance**: Error boundaries with recovery options

#### Robust

- **Compatible**: Semantic HTML, ARIA roles where appropriate
- **Error Handling**: Graceful degradation with error boundaries

## Testing

### Automated Testing

```sh
# Run accessibility E2E tests
npm run test:e2e -- e2e/accessibility.spec.ts

# Run all tests including accessibility
npm run test:e2e
```

### Manual Testing Checklist

- [ ] Keyboard navigation works for all interactive elements
- [ ] Screen reader announces all important content
- [ ] Color contrast meets WCAG AA standards
- [ ] Focus indicators are visible
- [ ] Error messages are clear and actionable
- [ ] No flashing content that could trigger seizures

### Browser Extensions for Testing

- **axe DevTools**: Automated accessibility scanning
- **WAVE**: Visual feedback about accessibility
- **NVDA/JAWS**: Screen reader testing (Windows)
- **VoiceOver**: Screen reader testing (macOS/iOS)

## Known Limitations

### Data Visualization

- **Canvas/WebGL content**: Vision cones and creatures are rendered in WebGL, which is inherently visual
- **Color-coded information**: Genetics and telemetry use colors; consider adding text alternatives

### Recommended Improvements

1. **Alternative Text for Canvas**: Add ARIA live regions describing simulation state
2. **High Contrast Mode**: Implement theme toggle for high contrast
3. **Screen Reader Announcements**: Add live regions for critical events (births, deaths, generation changes)
4. **Keyboard Shortcuts**: Document and implement keyboard shortcuts for common actions
5. **Reduce Motion**: Respect `prefers-reduced-motion` for animations

## Implementation Notes

### Adding ARIA Labels

```vue
<!-- Good: Button with accessible name -->
<button aria-label="Start simulation">
  <PlayIcon />
</button>

<!-- Better: Button with visible text -->
<button>
  <PlayIcon />
  Start Simulation
</button>
```

### Keyboard Navigation

- **Tab**: Move forward through interactive elements
- **Shift+Tab**: Move backward
- **Enter/Space**: Activate buttons
- **Escape**: Close modals/dialogs
- **Arrow Keys**: Navigate within component (sliders, tabs)

### Focus Management

```typescript
// Trap focus within modals
const trapFocus = (element: HTMLElement) => {
  const focusableElements = element.querySelectorAll(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
  )
  const firstElement = focusableElements[0] as HTMLElement
  const lastElement = focusableElements[focusableElements.length - 1] as HTMLElement

  element.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      if (e.shiftKey && document.activeElement === firstElement) {
        lastElement.focus()
        e.preventDefault()
      } else if (!e.shiftKey && document.activeElement === lastElement) {
        firstElement.focus()
        e.preventDefault()
      }
    }
  })
}
```

## Resources

- [WCAG 2.1 Guidelines](https://www.w3.org/WAI/WCAG21/quickref/)
- [MDN Accessibility](https://developer.mozilla.org/en-US/docs/Web/Accessibility)
- [Vue.js Accessibility](https://vuejs.org/guide/best-practices/accessibility.html)
- [axe-core Documentation](https://github.com/dequelabs/axe-core)
