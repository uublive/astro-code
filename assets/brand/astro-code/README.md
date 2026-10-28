# astro-code brand

Logo (wordmark + mark) and the mark alone, each for dark and light backgrounds, static and animated (pure CSS, honours `prefers-reduced-motion`; no scripts). Tagline: `AI CODING CREW · HUMAN AT THE HELM`.

Not shipped with the npm package (`assets/` is outside `files` in package.json).

The snippet used at the top of the repo README:

```html
<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/brand/astro-code/svg/astro-code-logo-dark-animated.svg">
    <img src="assets/brand/astro-code/svg/astro-code-logo-light-animated.svg" alt="astro-code" width="460">
  </picture>
</p>
<p align="center"><code>AI CODING CREW · HUMAN AT THE HELM</code></p>

```
