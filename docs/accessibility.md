# Accessibility checks

The repository has two complementary automated checks:

```sh
pnpm run check:accessibility          # theme contrast tokens
pnpm run check:accessibility:browser  # live DOM and keyboard smoke
```

The browser check verifies accessible names for visible interactive controls,
form-control labels, image alt text, duplicate IDs, dialog labels, focusable
content hidden from assistive technology, positive `tabindex` values, and
keyboard Tab movement. Accessible-name and ARIA checks are useful screen-reader
regression proxies, but this remains a focused gate rather than a WCAG
certification or replacement for manual screen-reader testing. Set
`ACCESSIBILITY_BASE_URL` to test a deployed URL.
