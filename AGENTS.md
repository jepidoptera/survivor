# Agent Notes

## No Silent Fallbacks

For rendering, cache, building, save/load, and other correctness-critical paths, do not add silent fallback behavior for states that are supposed to be impossible.

If an invariant is required for correctness, fail loudly with a specific error or hard diagnostic. Prefer a clear exception such as "missing building composite render texture" over returning `null`, reusing stale cached data, trying an alternate path, or quietly drawing something approximate. Silent fallback paths have caused frustrating rendering mysteries in this project.

## Movement Model

Treat movement as polygon-first. The world is essentially a polygon-based game with a hex grid layered over it as an optimization and pathfinding structure.

The wizard should stay in hitbox/geometry movement all the time for maximum movement fidelity and should not depend on hex-node occupancy for walking validity. NPCs should mostly stay on the hex grid for cheaper pathing and simulation, switching into hitbox/geometry movement only when they need close-range fidelity, such as melee engagement.
