"use strict";

// Browser integration test: wall blocking must persist after floor rematerialisation.
//
// The test opens the game in a headless browser, synthesises a floor fragment
// with wall blocking via the game's production APIs, then triggers
// rematerialisation (FloorStairs._test.rematerializeSections) and verifies the
// wall still blocks.
//
// NOTE: this test uses /sectionworld, not /hunt.  The section-world prototype
// modules (sectionWorldBlocking.js, sectionWorldApiInstallers.js, etc.) are
// only loaded on the /sectionworld page; /hunt does not include them.  These
// modules are required for getFloorNodeAtLayer, registerFloorFragment,
// applyPrototypeBlockedEdgesForSection, and so on.
//
// Requires the game server running on localhost:8080.  Automatically skipped
// when the server is unreachable so it does not break the offline test suite.
//
// Run standalone:
//   node --test tests/wallBlockingAfterFloorEdit.browser.test.js

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { chromium } = require("playwright");

const SERVER_URL = "http://localhost:8080";
const GAME_READY_TIMEOUT_MS = 45_000;
const TEST_TIMEOUT_MS = 120_000;

function checkServerRunning() {
    return new Promise((resolve) => {
        const req = http.get(`${SERVER_URL}/`, (res) => {
            resolve(true);
            res.destroy();
        });
        req.on("error", () => resolve(false));
        req.setTimeout(3000, () => { req.destroy(); resolve(false); });
    });
}

test("wall blocking persists after floor rematerialisation (browser integration)", { timeout: TEST_TIMEOUT_MS }, async (t) => {
    const serverUp = await checkServerRunning();
    if (!serverUp) {
        t.skip("Server not running on port 8080 — skipping browser integration test");
        return;
    }

    const browser = await chromium.launch({
        headless: true,
        args: [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--enable-webgl",
            "--ignore-gpu-blocklist",
            "--use-gl=angle",
            "--use-angle=swiftshader",
            "--enable-unsafe-swiftshader"
        ]
    });
    try {
        const context = await browser.newContext();
        const page = await context.newPage();

        page.on("console", (msg) => {
            if (msg.type() === "error") process.stderr.write(`[browser error] ${msg.text()}\n`);
        });

        await page.goto(`${SERVER_URL}/sectionworld`);

        // Wait until the game engine is fully initialised: map, wizard,
        // SpellSystem, and the prototype section state all present.
        await page.waitForFunction(
            () => globalThis.SpellSystem != null &&
                  globalThis.wizard != null &&
                  globalThis.map != null &&
                  globalThis.map._prototypeSectionState != null,
            null,
            { timeout: GAME_READY_TIMEOUT_MS }
        );

        // ── Step 1: find or create a wall-blocked floor node pair ─────────────
        //
        // First check whether the loaded world already has a suitable scenario
        // (floor nodes at layer > 0 with wall blocking).  If not, synthesise
        // one using the game's own production APIs.
        //
        // In the synthetic case we also override map.registerSectionFloorNodes
        // so that when rematerializeSections destroys and rebuilds the section
        // nodes the synthetic floor nodes (not in nodesBySectionKey) are also
        // recreated.  The override persists on the map object and is therefore
        // still in place when rematerializeSections is called in Step 3.
        const scenario = await page.evaluate(() => {
            const m = globalThis.map;

            // ── Try to find an existing wall-blocked node pair ─────────────
            if (m.floorNodesById instanceof Map && m.floorNodesById.size > 0) {
                for (const [, nodes] of m.floorNodesById.entries()) {
                    if (!Array.isArray(nodes)) continue;
                    for (const nodeA of nodes) {
                        if (!nodeA || nodeA.traversalLayer === 0) continue;
                        if (!nodeA.blockedNeighbors || nodeA.blockedNeighbors.size === 0) continue;
                        for (const [dir] of nodeA.blockedNeighbors.entries()) {
                            const nodeB = nodeA.neighbors && nodeA.neighbors[dir];
                            if (!nodeB) continue;
                            return {
                                synthetic: false,
                                sectionKey: nodeA.ownerSectionKey || "",
                                nodeAXi: nodeA.xindex, nodeAYi: nodeA.yindex, nodeALayer: nodeA.traversalLayer,
                                nodeBXi: nodeB.xindex, nodeBYi: nodeB.yindex, nodeBLayer: nodeB.traversalLayer,
                                level: nodeA.traversalLayer
                            };
                        }
                    }
                }
            }

            // ── Synthesise the scenario using the real game APIs ───────────
            //
            // Pick the first section from the loaded world and attach a small
            // 2-node upper floor with a wall record between the two nodes.
            const state = m._prototypeSectionState;
            if (!state || !(state.sectionAssetsByKey instanceof Map) || state.sectionAssetsByKey.size === 0) {
                return { error: "NO_SECTION_STATE" };
            }

            const blockingModule = globalThis.__sectionWorldBlocking;
            if (!blockingModule) return { error: "NO_BLOCKING_MODULE" };

            const sectionKey = state.sectionAssetsByKey.keys().next().value;
            const asset = state.sectionAssetsByKey.get(sectionKey);
            if (!asset) return { error: "NO_ASSET" };

            // Synthetic xindex/yindex far from the real map so they never
            // collide with existing ground nodes.
            const XI_A = 30000, YI_A = 30000;
            const XI_B = 30001, YI_B = 30000;
            const X_A = 40.0, Y_A = 40.0;
            const X_B = 40.866, Y_B = 40.0;
            const Y_HOLE = 41.0;

            const FRAGMENT_ID = "__test_wall_blocking_fragment__";
            const SURFACE_ID  = "__test_wall_blocking_surface__";
            const RECORD_ID   = 7919;
            const LEVEL       = 1;
            const BASE_Z      = 3;

            const outerPolygon = [
                { x: X_A - 0.5, y: Y_A - 0.5 },
                { x: X_B + 0.5, y: Y_A - 0.5 },
                { x: X_B + 0.5, y: Y_HOLE + 0.5 },
                { x: X_A - 0.5, y: Y_HOLE + 0.5 }
            ];

            // Register the floor fragment.
            const fragment = m.registerFloorFragment({
                fragmentId: FRAGMENT_ID,
                surfaceId: SURFACE_ID,
                ownerSectionKey: sectionKey,
                level: LEVEL,
                nodeBaseZ: BASE_Z,
                outerPolygon
            });

            // Create the two wall-adjacent nodes.
            const srcA = {
                xindex: XI_A, yindex: YI_A, x: X_A, y: Y_A, baseZ: BASE_Z, portalEdges: [],
                neighborOffsets: Object.assign(new Array(12).fill(null), { 3: { x: 1, y: 0 } })
            };
            const srcB = {
                xindex: XI_B, yindex: YI_B, x: X_B, y: Y_B, baseZ: BASE_Z, portalEdges: [],
                neighborOffsets: Object.assign(new Array(12).fill(null), { 9: { x: -1, y: 0 } })
            };
            let nodeA = m.createFloorNodeFromSource(srcA, fragment, { baseZ: BASE_Z, traversalLayer: LEVEL });
            let nodeB = m.createFloorNodeFromSource(srcB, fragment, { baseZ: BASE_Z, traversalLayer: LEVEL });
            nodeA.neighbors[3] = nodeB;
            nodeB.neighbors[9] = nodeA;

            // Add blocked-edge record to the section asset.
            if (!Array.isArray(asset.blockedEdges)) asset.blockedEdges = [];
            asset.blockedEdges = asset.blockedEdges.filter((e) => e && e.recordId !== RECORD_ID);
            asset.blockedEdges.push({
                recordId: RECORD_ID,
                traversalLayer: LEVEL,
                a: { xindex: XI_A, yindex: YI_A, traversalLayer: LEVEL, surfaceId: SURFACE_ID, fragmentId: FRAGMENT_ID },
                b: { xindex: XI_B, yindex: YI_B, traversalLayer: LEVEL, surfaceId: SURFACE_ID, fragmentId: FRAGMENT_ID }
            });

            // Add the floor polygon to asset.floors so prepareFloorSectionFragments
            // picks it up and re-registers the fragment on rematerialisation.
            if (!Array.isArray(asset.floors)) asset.floors = [];
            asset.floors = asset.floors.filter((f) => f && f.fragmentId !== FRAGMENT_ID);
            asset.floors.push({
                fragmentId: FRAGMENT_ID,
                surfaceId: SURFACE_ID,
                ownerSectionKey: sectionKey,
                level: LEVEL,
                nodeBaseZ: BASE_Z,
                outerPolygon,
                holes: []
            });

            // Apply wall blocking to the initial nodes.
            const { applyPrototypeBlockedEdgesForSection } =
                blockingModule.createSectionWorldBlockingHelpers(m, {});
            applyPrototypeBlockedEdgesForSection(m, sectionKey);

            // ── Override registerSectionFloorNodes ─────────────────────────
            //
            // The real implementation reads from state.nodesBySectionKey.  Our
            // synthetic nodes are not there, so we hook the function to also
            // recreate them after the original runs.  This override persists on
            // the map object across subsequent page.evaluate calls.
            const origRegisterSectionFloorNodes = m.registerSectionFloorNodes;
            m.registerSectionFloorNodes = function syntheticRegisterSectionFloorNodes(key) {
                const result = origRegisterSectionFloorNodes
                    ? origRegisterSectionFloorNodes.call(this, key)
                    : 0;
                if (key !== sectionKey) return result;
                // Re-register the synthetic fragment (idempotent) and recreate nodes.
                const frag2 = this.registerFloorFragment({
                    fragmentId: FRAGMENT_ID,
                    surfaceId: SURFACE_ID,
                    ownerSectionKey: sectionKey,
                    level: LEVEL,
                    nodeBaseZ: BASE_Z,
                    outerPolygon
                });
                const newA = this.createFloorNodeFromSource(srcA, frag2, { baseZ: BASE_Z, traversalLayer: LEVEL });
                const newB = this.createFloorNodeFromSource(srcB, frag2, { baseZ: BASE_Z, traversalLayer: LEVEL });
                newA.neighbors[3] = newB;
                newB.neighbors[9] = newA;
                return result;
            };

            return {
                synthetic: true,
                sectionKey,
                nodeAXi: XI_A, nodeAYi: YI_A, nodeALayer: LEVEL,
                nodeBXi: XI_B, nodeBYi: YI_B, nodeBLayer: LEVEL,
                level: LEVEL
            };
        });

        if (scenario.error) {
            assert.fail(`Could not set up test scenario: ${scenario.error}`);
        }

        // ── Step 2: confirm wall blocks BEFORE rematerialisation ──────────────
        const beforeReset = await page.evaluate((s) => {
            const m = globalThis.map;
            const nodeA = m.getFloorNodeAtLayer(s.nodeAXi, s.nodeAYi, s.nodeALayer);
            const nodeB = m.getFloorNodeAtLayer(s.nodeBXi, s.nodeBYi, s.nodeBLayer);
            if (!nodeA || !nodeB) return { error: "NODES_MISSING_BEFORE_RESET" };
            const path = m.findPathAStar(nodeA, nodeB);
            return {
                blockedNeighborsSize: nodeA.blockedNeighbors instanceof Map ? nodeA.blockedNeighbors.size : 0,
                pathFound: path !== null
            };
        }, scenario);

        if (beforeReset.error) {
            assert.fail(`Pre-reset check failed: ${beforeReset.error}`);
        }
        assert.equal(beforeReset.blockedNeighborsSize > 0, true,
            "wall must block before rematerialisation (test setup problem)");
        assert.equal(beforeReset.pathFound, false,
            "pathfinding must be blocked before rematerialisation (test setup problem)");

        // ── Step 3: trigger rematerialisation ─────────────────────────────────
        //
        // FloorStairs._test.rematerializeSections exercises the same production
        // code path as SpellSystem.castWizardSpell("floorhole"):
        //   unregisterSectionFloorNodes → registerSectionFloorNodes
        //   → (our fix) applyPrototypeBlockedEdgesForSection
        //   → syncPrototypeWalls
        //
        // Using the test hook avoids having to satisfy all the section-geometry
        // preconditions (centerAxial, polygon intersection, …) that
        // applyFloorBooleanEdit requires.
        await page.evaluate((s) => {
            globalThis.FloorStairs._test.rematerializeSections(
                globalThis.map,
                new Set([s.sectionKey])
            );
        }, scenario);

        // Give the game one render tick for any deferred work.
        await page.waitForTimeout(150);

        // ── Step 4: verify wall blocking persists after rematerialisation ─────
        const afterReset = await page.evaluate((s) => {
            const m = globalThis.map;
            const newA = m.getFloorNodeAtLayer(s.nodeAXi, s.nodeAYi, s.nodeALayer);
            const newB = m.getFloorNodeAtLayer(s.nodeBXi, s.nodeBYi, s.nodeBLayer);
            if (!newA) return { error: "NODE_A_MISSING_AFTER_RESET" };
            if (!newB) return { error: "NODE_B_MISSING_AFTER_RESET" };
            const blockedNeighborsSize = newA.blockedNeighbors instanceof Map
                ? newA.blockedNeighbors.size : 0;
            const path = m.findPathAStar(newA, newB);
            return { blockedNeighborsSize, pathFound: path !== null };
        }, scenario);

        if (afterReset.error) {
            assert.fail(
                `Post-reset lookup failed (${afterReset.error}) — ` +
                `nodeAXi=${scenario.nodeAXi} nodeAYi=${scenario.nodeAYi} layer=${scenario.nodeALayer}`
            );
        }

        assert.equal(
            afterReset.blockedNeighborsSize > 0, true,
            "new floor node must have wall blocking re-applied after rematerialisation " +
            `(blockedNeighborsSize=${afterReset.blockedNeighborsSize})`
        );

        assert.equal(
            afterReset.pathFound, false,
            "wall must still block pathfinding after rematerialisation — " +
            "wizard must not be able to walk through the wall"
        );

    } finally {
        await browser.close();
    }
});
