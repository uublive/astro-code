# astro-code brand

Logo (wordmark + mark) and the mark alone, each for dark and light backgrounds, static and animated (pure CSS, honours `prefers-reduced-motion`; no scripts). Tagline: `AI CODING CREW · HUMAN AT THE HELM`.

Not shipped with the npm package (`assets/` is outside `files` in package.json).

The snippet used at the top of the repo README:

```html
<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/brand/astro-code/svg/astro-code-logo-dark-animated.svg">
    <source media="(prefers-color-scheme: light)" srcset="assets/brand/astro-code/svg/astro-code-logo-light-animated.svg">
    <img alt="astro-code" src="assets/brand/astro-code/svg/astro-code-logo-dark-animated.svg" height="120">
  </picture>
</p>

<p align="center">
  <strong>The AI coding crew of the Astro family, with a human at the helm.</strong><br>
  Plans, builds and verifies code with agents, and closes nothing until a human signs off.
</p>

<p align="center">
  <a href="https://github.com/uublive/astro-code/releases/latest"><img alt="release" src="https://img.shields.io/github/v/release/uublive/astro-code?label=astro-code&color=5228CC&style=flat-square"></a>
  <img alt="node" src="https://img.shields.io/badge/node-%E2%89%A5%2022-17151C?style=flat-square">
  <img alt="tests" src="https://img.shields.io/badge/tests-2818%20passing-2EA043?style=flat-square">
  <a href="LICENSE"><img alt="license" src="https://img.shields.io/badge/license-Apache--2.0-A07CFF?style=flat-square"></a>
</p>
```
