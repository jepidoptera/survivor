const test = require("node:test");
const assert = require("node:assert/strict");

const savedRoof = globalThis.Roof;
const savedPolygonHitbox = globalThis.PolygonHitbox;
const savedScripting = globalThis.Scripting;
const savedWallSectionUnit = globalThis.WallSectionUnit;
require("../public/assets/javascript/gameobjects/roof.js");
const Roof = globalThis.Roof;

test.after(() => {
    if (typeof savedRoof === "undefined") {
        delete globalThis.Roof;
    } else {
        globalThis.Roof = savedRoof;
    }
    if (typeof savedPolygonHitbox === "undefined") {
        delete globalThis.PolygonHitbox;
    } else {
        globalThis.PolygonHitbox = savedPolygonHitbox;
    }
    if (typeof savedScripting === "undefined") {
        delete globalThis.Scripting;
    } else {
        globalThis.Scripting = savedScripting;
    }
    if (typeof savedWallSectionUnit === "undefined") {
        delete globalThis.WallSectionUnit;
    } else {
        globalThis.WallSectionUnit = savedWallSectionUnit;
    }
});

function makeMockWallLoop(heights, bottomZ = 0) {
    const points = [
        { x: 0, y: 0 },
        { x: 2, y: 0 },
        { x: 2, y: 2 },
        { x: 0, y: 2 }
    ];
    const sections = [];
    const getProfileFor = (startPoint, endPoint) => {
        const dx = endPoint.x - startPoint.x;
        const dy = endPoint.y - startPoint.y;
        const len = Math.hypot(dx, dy) || 1;
        const nx = -dy / len * 0.05;
        const ny = dx / len * 0.05;
        return {
            aLeft: { x: startPoint.x + nx, y: startPoint.y + ny },
            aRight: { x: startPoint.x - nx, y: startPoint.y - ny },
            bLeft: { x: endPoint.x + nx, y: endPoint.y + ny },
            bRight: { x: endPoint.x - nx, y: endPoint.y - ny }
        };
    };

    for (let i = 0; i < 4; i++) {
        const startPoint = points[i];
        const endPoint = points[(i + 1) % points.length];
        sections.push({
            id: i + 1,
            startPoint,
            endPoint,
            bottomZ,
            height: heights[i],
            gone: false,
            vanishing: false,
            connections: new Map(),
            getWallProfile() {
                return getProfileFor(startPoint, endPoint);
            }
        });
    }

    const connect = (a, b) => {
        a.connections.set(b.id, { section: b });
        b.connections.set(a.id, { section: a });
    };
    connect(sections[0], sections[1]);
    connect(sections[1], sections[2]);
    connect(sections[2], sections[3]);
    connect(sections[3], sections[0]);

    class MockWallSectionUnit {}
    MockWallSectionUnit._allSections = new Map(sections.map(section => [section.id, section]));
    MockWallSectionUnit.endpointKey = point => `${Number(point.x).toFixed(4)},${Number(point.y).toFixed(4)}`;

    return { sections, wallCtor: MockWallSectionUnit };
}

test("roof placement uses lower-layer wall height above the current layer for top z", () => {
    const previousWallCtor = globalThis.WallSectionUnit;
    const previousHovered = Roof.getHoveredWallSectionAtPoint;
    try {
        const { sections, wallCtor } = makeMockWallLoop([4, 4, 4, 4], 0);
        globalThis.WallSectionUnit = wallCtor;
        Roof.getHoveredWallSectionAtPoint = () => sections[0];

        const wizard = {
            map: {},
            currentLayer: 1,
            currentLayerBaseZ: 3
        };
        const candidate = Roof.getPlacementCandidate(wizard, 1, 1, { maxDepth: 8 });

        assert.ok(candidate);
        assert.equal(candidate.previewZ, 4);

        const roofRef = {
            setInteriorHideHitboxFromLocalPoints(points) {
                this.interiorLocalPoints = points;
            },
            updateGroundPlaneHitbox() {
                this.updatedGroundPlaneHitbox = true;
            },
            createPixiMesh() {
                this.createdPixiMesh = true;
            }
        };
        assert.equal(Roof.applyWallLoopCandidateToRoof(roofRef, candidate, wizard.map, { peakOffsetZ: 2, overhang: 0 }), true);
        assert.equal(roofRef.z, 4);
        assert.equal(roofRef.heightFromGround, 4);
        assert.equal(roofRef.peakHeight, 2);
    } finally {
        globalThis.WallSectionUnit = previousWallCtor;
        Roof.getHoveredWallSectionAtPoint = previousHovered;
    }
});

test("wall-loop roof mesh keeps every eave at the loop high point", () => {
    const previousWallCtor = globalThis.WallSectionUnit;
    try {
        const { sections, wallCtor } = makeMockWallLoop([6, 4, 5, 4], 0);
        globalThis.WallSectionUnit = wallCtor;

        const meshData = Roof.buildWallLoopMeshData(sections, {}, { peakOffsetZ: 2, overhang: 0 });

        assert.ok(meshData);
        assert.equal(meshData.baseZ, 6);
        assert.equal(meshData.peakZ, 8);
        assert.equal(meshData.vertices.length, 5);
        assert.deepEqual(meshData.vertices.slice(0, 4).map(vertex => vertex.z), [0, 0, 0, 0]);
        assert.equal(meshData.vertices[4].z, 2);
    } finally {
        globalThis.WallSectionUnit = previousWallCtor;
    }
});

test("roof placement ignores wall loops with sections flush with the current layer", () => {
    const previousWallCtor = globalThis.WallSectionUnit;
    const previousHovered = Roof.getHoveredWallSectionAtPoint;
    try {
        const { sections, wallCtor } = makeMockWallLoop([4, 4, 3, 4], 0);
        globalThis.WallSectionUnit = wallCtor;
        Roof.getHoveredWallSectionAtPoint = () => sections[0];

        const wizard = {
            map: {},
            currentLayer: 1,
            currentLayerBaseZ: 3
        };

        assert.equal(Roof.getPlacementCandidate(wizard, 1, 1, { maxDepth: 8 }), null);
    } finally {
        globalThis.WallSectionUnit = previousWallCtor;
        Roof.getHoveredWallSectionAtPoint = previousHovered;
    }
});

test("roof face UVs pin the eave edge to the bottom of the texture", () => {
    const repeatsPerUnit = 0.25;
    const uvs = Roof.computeFaceUvs([
        { x: 0, y: 0, z: 0 },
        { x: 4, y: 0, z: 0 },
        { x: 2, y: 0, z: 2 }
    ], repeatsPerUnit);

    assert.equal(uvs[1], 1);
    assert.equal(uvs[3], 1);
    assert.ok(uvs[5] < 1);
    assert.equal(uvs[1] - uvs[5], 0.5);
});

test("roof face UVs keep the eave edge pinned even when triangle winding flips", () => {
    const repeatsPerUnit = 0.25;
    const uvs = Roof.computeFaceUvs([
        { x: 0, y: 0, z: 0 },
        { x: 2, y: 0, z: 2 },
        { x: 4, y: 0, z: 0 }
    ], repeatsPerUnit);

    assert.equal(uvs[1], 1);
    assert.ok(uvs[3] < 1);
    assert.equal(uvs[5], 1);
    assert.equal(uvs[1] - uvs[3], 0.5);
});

test("roof loadJson can skip auto scripting-name generation during trusted restore", () => {
    let ensureCalls = 0;
    const setCalls = [];

    globalThis.PolygonHitbox = class PolygonHitbox {
        constructor(points) {
            this.points = points;
        }
    };
    globalThis.Scripting = {
        ensureObjectScriptingName() {
            ensureCalls += 1;
            return "generatedRoof";
        },
        setObjectScriptingName(target, name, options) {
            setCalls.push({ target, name, options });
            target.scriptingName = name;
            return true;
        }
    };

    const roof = Roof.loadJson({
        type: "roof",
        x: 4,
        y: 5,
        heightFromGround: 2,
        placed: true,
        vertices: [
            { x: -1, y: -1, z: 0 },
            { x: 1, y: -1, z: 0 },
            { x: 0, y: 1, z: 2 }
        ],
        triangles: [[0, 1, 2]],
        scriptingName: "roofAlpha"
    }, {
        suppressAutoScriptingName: true,
        trustLoadedScriptingName: true,
        targetSectionKey: "0,0"
    });

    assert.ok(roof);
    assert.equal(ensureCalls, 0);
    assert.equal(roof.scriptingName, "roofAlpha");
    assert.equal(setCalls.length, 1);
    assert.equal(setCalls[0].name, "roofAlpha");
    assert.equal(setCalls[0].options.restoreFromSave, true);
    assert.equal(setCalls[0].options.skipBubbleEnsureOnRestore, true);
    assert.equal(setCalls[0].options.targetSectionKey, "0,0");
});
