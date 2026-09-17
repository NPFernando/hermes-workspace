# Accessibility checks

The repository has two complementary automated checks:

```sh
pnpm run check:accessibility          # theme contrast tokens
pnpm run check:accessibility:browser  # live DOM and keyboard smoke
```

The browser check verifies accessible names for visible interactive controls,
image alt text, duplicate IDs, dialog labels, and keyboard Tab movement. It is
a focused regression gate, not a certification or replacement for manual
screen-reader testing. Set `ACCESSIBILITY_BASE_URL` to test a deployed URL.
