# Agent Notes

## No Silent Fallbacks

For rendering, cache, building, save/load, and other correctness-critical paths, do not add silent fallback behavior for states that are supposed to be impossible.

If an invariant is required for correctness, fail loudly with a specific error or hard diagnostic. Prefer a clear exception such as "missing building composite render texture" over returning `null`, reusing stale cached data, trying an alternate path, or quietly drawing something approximate. Silent fallback paths have caused frustrating rendering mysteries in this project.
