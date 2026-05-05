const test = require("node:test");
const assert = require("node:assert/strict");

const {
    classifyAnchorSection,
    isAlongSeam,
    computeWallRecordSplits
} = require("../public/assets/javascript/prototypes/wallSectionSplitting.js");

// --- Test helpers ---

class TestNode {
    constructor(xindex, yindex) {
        this.xindex = xindex;
        this.yindex = yindex;
        this.x = xindex * 0.866;
        this.y = yindex + (xindex % 2 === 0 ? 0.5 : 0);
        this.neighbors = new Array(12).fill(null);
        this._prototypeSectionKey = null;
    }
}

// Even-Q offset neighbor tables (direction index 0–11)
const EVEN_OFFSETS = [
    [-2, 0], [-1, 0], [-1, -1], [0, -1], [1, -1], [1, 0],
    [2, 0],  [1, 1],  [1, 2],   [0, 1],  [-1, 2], [-1, 1]
];
const ODD_OFFSETS = [
    [-2, 0], [-1, -1], [-1, -2], [0, -1], [1, -2], [1, -1],
    [2, 0],  [1, 0],   [1, 1],   [0, 1],  [-1, 1], [-1, 0]
];

function buildTestGrid(width, height) {
    const nodes = [];
    for (let x = 0; x < width; x++) {
        nodes[x] = [];
        for (let y = 0; y < height; y++) {
            nodes[x][y] = new TestNode(x, y);
        }
    }
    for (let x = 0; x < width; x++) {
        const offsets = x % 2 === 0 ? EVEN_OFFSETS : ODD_OFFSETS;
        for (let y = 0; y < height; y++) {
            for (let d = 0; d < 12; d++) {
                const nx = x + offsets[d][0];
                const ny = y + offsets[d][1];
                if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                    nodes[x][y].neighbors[d] = nodes[nx][ny];
                }
            }
        }
    }
    return nodes;
}

/** Mirror of Map.js makeMidpoint — canonical form: nodeA.neighbors[k] === nodeB, k in 0–5. */
function makeMidpoint(nodeX, nodeY) {
    if (!nodeX || !nodeY) return null;
    for (let d = 0; d < 6; d++) {
        if (nodeX.neighbors[d] === nodeY) return { nodeA: nodeX, nodeB: nodeY, k: d,
            x: (nodeX.x + nodeY.x) * 0.5, y: (nodeX.y + nodeY.y) * 0.5 };
        if (nodeY.neighbors[d] === nodeX) return { nodeA: nodeY, nodeB: nodeX, k: d,
            x: (nodeX.x + nodeY.x) * 0.5, y: (nodeX.y + nodeY.y) * 0.5 };
    }
    return null;
}

function assignSections(nodes, fn) {
    for (let x = 0; x < nodes.length; x++) {
        for (let y = 0; y < nodes[x].length; y++) {
            nodes[x][y]._prototypeSectionKey = fn(x, y);
        }
    }
}

// --- classifyAnchorSection unit tests ---

test("classifyAnchorSection — node with section key returns definite", () => {
    const node = new TestNode(2, 3);
    node._prototypeSectionKey = "0,0";
    const result = classifyAnchorSection(node);
    assert.deepEqual(result, { type: "definite", sectionKey: "0,0" });
});

test("classifyAnchorSection — node without section key returns unknown", () => {
    const node = new TestNode(2, 3);
    const result = classifyAnchorSection(node);
    assert.deepEqual(result, { type: "unknown" });
});

test("classifyAnchorSection — midpoint with both parents in same section returns definite", () => {
    const nodes = buildTestGrid(4, 4);
    assignSections(nodes, () => "A");
    const mid = makeMidpoint(nodes[0][0], nodes[1][0]);
    assert.notEqual(mid, null, "makeMidpoint should find adjacent nodes");
    const result = classifyAnchorSection(mid);
    assert.deepEqual(result, { type: "definite", sectionKey: "A" });
});

test("classifyAnchorSection — midpoint with parents in different sections returns seam", () => {
    const nodes = buildTestGrid(4, 4);
    assignSections(nodes, (x) => x < 2 ? "A" : "B");
    const mid = makeMidpoint(nodes[1][0], nodes[2][0]);
    assert.notEqual(mid, null, "makeMidpoint should find adjacent nodes");
    const result = classifyAnchorSection(mid);
    assert.equal(result.type, "seam");
    assert.deepEqual(result.keys, ["A", "B"]);
});

// --- isAlongSeam unit tests ---

test("isAlongSeam — all seam midpoints returns true", () => {
    const classifications = [
        { type: "seam", keys: ["A", "B"] },
        { type: "seam", keys: ["A", "B"] },
        { type: "seam", keys: ["A", "B"] }
    ];
    assert.equal(isAlongSeam(classifications), true);
});

test("isAlongSeam — alternating definite sections returns true", () => {
    const classifications = [
        { type: "definite", sectionKey: "A" },
        { type: "seam", keys: ["A", "B"] },
        { type: "definite", sectionKey: "B" },
        { type: "seam", keys: ["A", "B"] },
        { type: "definite", sectionKey: "A" }
    ];
    assert.equal(isAlongSeam(classifications), true);
});

test("isAlongSeam — consecutive same-section anchors returns false", () => {
    const classifications = [
        { type: "definite", sectionKey: "A" },
        { type: "definite", sectionKey: "A" },
        { type: "seam", keys: ["A", "B"] },
        { type: "definite", sectionKey: "B" }
    ];
    assert.equal(isAlongSeam(classifications), false);
});

// --- computeWallRecordSplits integration tests ---

test("does not split wall entirely within one section", () => {
    const nodes = buildTestGrid(8, 8);
    assignSections(nodes, (x) => x < 4 ? "0,0" : "1,0");

    const mid = makeMidpoint(nodes[1][3], nodes[2][3]);
    assert.notEqual(mid, null);

    const orderedAnchors = [
        { anchor: nodes[1][3], t: 0.0, key: "n:1,3" },
        { anchor: mid, t: 0.5, key: "m:1" },
        { anchor: nodes[2][3], t: 1.0, key: "n:2,3" }
    ];

    const wallRecord = {
        type: "wallSection", id: 200, height: 2, thickness: 0.375, bottomZ: 0,
        wallTexturePath: "/assets/images/walls/stonewall.png", direction: 5, lineAxis: 5,
        startPoint: { kind: "node", xindex: 1, yindex: 3, x: nodes[1][3].x, y: nodes[1][3].y },
        endPoint: { kind: "node", xindex: 2, yindex: 3, x: nodes[2][3].x, y: nodes[2][3].y }
    };

    const result = computeWallRecordSplits(wallRecord, orderedAnchors);
    assert.equal(result.needsSplit, false);
    assert.equal(result.pieces.length, 1);
    assert.equal(result.pieces[0].sectionKey, "0,0");
});

test("splits non-diagonal wall at seam midpoint", () => {
    const nodes = buildTestGrid(8, 8);
    assignSections(nodes, (x) => x < 4 ? "0,0" : "1,0");

    // Wall from node(2,3) to node(5,2) going direction 5 (up-right).
    // Anchors: node→mid→node→SEAM_MID→node→mid→node
    // Section boundary is between columns 3 and 4.
    const mid_2_3__3_3 = makeMidpoint(nodes[2][3], nodes[3][3]);
    const mid_3_3__4_2 = makeMidpoint(nodes[3][3], nodes[4][2]);
    const mid_4_2__5_2 = makeMidpoint(nodes[4][2], nodes[5][2]);

    assert.notEqual(mid_2_3__3_3, null);
    assert.notEqual(mid_3_3__4_2, null);
    assert.notEqual(mid_4_2__5_2, null);

    const orderedAnchors = [
        { anchor: nodes[2][3], t: 0 / 6, key: "n:2,3" },
        { anchor: mid_2_3__3_3, t: 1 / 6, key: "m:1" },
        { anchor: nodes[3][3], t: 2 / 6, key: "n:3,3" },
        { anchor: mid_3_3__4_2, t: 3 / 6, key: "m:2" },
        { anchor: nodes[4][2], t: 4 / 6, key: "n:4,2" },
        { anchor: mid_4_2__5_2, t: 5 / 6, key: "m:3" },
        { anchor: nodes[5][2], t: 6 / 6, key: "n:5,2" }
    ];

    const wallRecord = {
        type: "wallSection", id: 100, height: 2, thickness: 0.375, bottomZ: 0,
        wallTexturePath: "/assets/images/walls/stonewall.png", direction: 5, lineAxis: 5,
        startPoint: { kind: "node", xindex: 2, yindex: 3, x: nodes[2][3].x, y: nodes[2][3].y },
        endPoint: { kind: "node", xindex: 5, yindex: 2, x: nodes[5][2].x, y: nodes[5][2].y }
    };

    const result = computeWallRecordSplits(wallRecord, orderedAnchors);

    assert.equal(result.needsSplit, true);
    assert.equal(result.pieces.length, 2);
    assert.equal(result.splitPoints.length, 1);

    // Split point is the seam midpoint between (3,3) and (4,2)
    assert.equal(result.splitPoints[0].anchorIndex, 3);
    assert.equal(result.splitPoints[0].fromSection, "0,0");
    assert.equal(result.splitPoints[0].toSection, "1,0");
    assert.equal(result.splitPoints[0].isVirtual, false);

    // Piece 1: start → seam midpoint, section "0,0"
    assert.equal(result.pieces[0].sectionKey, "0,0");
    assert.deepEqual(result.pieces[0].record.startPoint, wallRecord.startPoint);
    assert.equal(result.pieces[0].record.endPoint.kind, "midpoint");
    assert.equal(result.pieces[0].record.endPoint.a.xindex, mid_3_3__4_2.nodeA.xindex);
    assert.equal(result.pieces[0].record.endPoint.a.yindex, mid_3_3__4_2.nodeA.yindex);
    assert.equal(result.pieces[0].record.endPoint.b.xindex, mid_3_3__4_2.nodeB.xindex);
    assert.equal(result.pieces[0].record.endPoint.b.yindex, mid_3_3__4_2.nodeB.yindex);
    assert.ok(Math.abs(result.pieces[0].record.endPoint.x - mid_3_3__4_2.x) < 0.001);
    assert.ok(Math.abs(result.pieces[0].record.endPoint.y - mid_3_3__4_2.y) < 0.001);
    assert.equal(result.pieces[0].record._splitGroupId, 100);
    assert.equal(result.pieces[0].record.id, null);

    // Piece 2: seam midpoint → end, section "1,0"
    assert.equal(result.pieces[1].sectionKey, "1,0");
    assert.equal(result.pieces[1].record.startPoint.kind, "midpoint");
    assert.ok(Math.abs(result.pieces[1].record.startPoint.x - mid_3_3__4_2.x) < 0.001);
    assert.ok(Math.abs(result.pieces[1].record.startPoint.y - mid_3_3__4_2.y) < 0.001);
    assert.deepEqual(result.pieces[1].record.endPoint, wallRecord.endPoint);
    assert.equal(result.pieces[1].record._splitGroupId, 100);
    assert.equal(result.pieces[1].record.id, null);

    // Original properties preserved on both pieces
    for (const piece of result.pieces) {
        assert.equal(piece.record.height, 2);
        assert.equal(piece.record.thickness, 0.375);
        assert.equal(piece.record.wallTexturePath, "/assets/images/walls/stonewall.png");
        assert.equal(piece.record.direction, 5);
        assert.equal(piece.record.lineAxis, 5);
    }
});

test("does not split wall running along seam (all seam midpoints)", () => {
    const nodes = buildTestGrid(8, 8);
    assignSections(nodes, (x) => x < 4 ? "0,0" : "1,0");

    // Wall going direction 9 (down) along the seam between columns 3 and 4.
    // All anchors are midpoints whose parent nodes straddle the two sections.
    const mid1 = makeMidpoint(nodes[3][3], nodes[4][2]); // nodeA=(3,3) 0,0 / nodeB=(4,2) 1,0
    const mid2 = makeMidpoint(nodes[3][3], nodes[4][3]); // nodeA=(4,3) 1,0 / nodeB=(3,3) 0,0
    const mid3 = makeMidpoint(nodes[3][4], nodes[4][3]); // nodeA=(3,4) 0,0 / nodeB=(4,3) 1,0

    assert.notEqual(mid1, null, "mid1 between (3,3) and (4,2)");
    assert.notEqual(mid2, null, "mid2 between (3,3) and (4,3)");
    assert.notEqual(mid3, null, "mid3 between (3,4) and (4,3)");

    const orderedAnchors = [
        { anchor: mid1, t: 0.0, key: "m:1" },
        { anchor: mid2, t: 0.5, key: "m:2" },
        { anchor: mid3, t: 1.0, key: "m:3" }
    ];

    const wallRecord = {
        type: "wallSection", id: 300, height: 2, thickness: 0.375, bottomZ: 0,
        wallTexturePath: "/assets/images/walls/stonewall.png", direction: 9, lineAxis: 3,
        startPoint: { kind: "point", x: mid1.x, y: mid1.y },
        endPoint: { kind: "point", x: mid3.x, y: mid3.y }
    };

    const result = computeWallRecordSplits(wallRecord, orderedAnchors);
    assert.equal(result.needsSplit, false);
    assert.equal(result.pieces.length, 1);
    // sectionKey is null because there are no definite anchors — caller assigns externally
    assert.equal(result.pieces[0].sectionKey, null);
});

test("splits wall crossing two seams into three pieces", () => {
    const nodes = buildTestGrid(12, 8);
    assignSections(nodes, (x) => {
        if (x < 4) return "A";
        if (x < 8) return "B";
        return "C";
    });

    // Wall from (2,4) across A→B boundary, through B, across B→C boundary, to (9,4-ish).
    // Direction 5 (up-right): even (x,y)→(x+1,y), odd (x,y)→(x+1,y-1).
    //
    // Trace (direction 5):
    //   node(2,4)  A   → mid((2,4),(3,4)) A  → node(3,4) A
    //   → mid((3,4),(4,3)) SEAM A|B  → node(4,3) B
    //   → mid((4,3),(5,3)) B  → node(5,3) B
    //   → mid((5,3),(6,2)) B  → node(6,2) B
    //   → mid((6,2),(7,2)) B  → node(7,2) B
    //   → mid((7,2),(8,1)) SEAM B|C  → node(8,1) C
    //   → mid((8,1),(9,1)) C  → node(9,1) C

    const mid_2_4__3_4 = makeMidpoint(nodes[2][4], nodes[3][4]);
    const seam_AB      = makeMidpoint(nodes[3][4], nodes[4][3]);
    const mid_4_3__5_3 = makeMidpoint(nodes[4][3], nodes[5][3]);
    const mid_5_3__6_2 = makeMidpoint(nodes[5][3], nodes[6][2]);
    const mid_6_2__7_2 = makeMidpoint(nodes[6][2], nodes[7][2]);
    const seam_BC      = makeMidpoint(nodes[7][2], nodes[8][1]);
    const mid_8_1__9_1 = makeMidpoint(nodes[8][1], nodes[9][1]);

    assert.notEqual(mid_2_4__3_4, null, "mid (2,4)-(3,4)");
    assert.notEqual(seam_AB, null,      "seam A|B (3,4)-(4,3)");
    assert.notEqual(mid_4_3__5_3, null, "mid (4,3)-(5,3)");
    assert.notEqual(mid_5_3__6_2, null, "mid (5,3)-(6,2)");
    assert.notEqual(mid_6_2__7_2, null, "mid (6,2)-(7,2)");
    assert.notEqual(seam_BC, null,      "seam B|C (7,2)-(8,1)");
    assert.notEqual(mid_8_1__9_1, null, "mid (8,1)-(9,1)");

    const orderedAnchors = [
        { anchor: nodes[2][4],  t:  0 / 14, key: "n:2,4" },
        { anchor: mid_2_4__3_4, t:  1 / 14, key: "m:a1" },
        { anchor: nodes[3][4],  t:  2 / 14, key: "n:3,4" },
        { anchor: seam_AB,      t:  3 / 14, key: "m:ab" },
        { anchor: nodes[4][3],  t:  4 / 14, key: "n:4,3" },
        { anchor: mid_4_3__5_3, t:  5 / 14, key: "m:b1" },
        { anchor: nodes[5][3],  t:  6 / 14, key: "n:5,3" },
        { anchor: mid_5_3__6_2, t:  7 / 14, key: "m:b2" },
        { anchor: nodes[6][2],  t:  8 / 14, key: "n:6,2" },
        { anchor: mid_6_2__7_2, t:  9 / 14, key: "m:b3" },
        { anchor: nodes[7][2],  t: 10 / 14, key: "n:7,2" },
        { anchor: seam_BC,      t: 11 / 14, key: "m:bc" },
        { anchor: nodes[8][1],  t: 12 / 14, key: "n:8,1" },
        { anchor: mid_8_1__9_1, t: 13 / 14, key: "m:c1" },
        { anchor: nodes[9][1],  t: 14 / 14, key: "n:9,1" }
    ];

    const wallRecord = {
        type: "wallSection", id: 500, height: 2, thickness: 0.375, bottomZ: 0,
        wallTexturePath: "/assets/images/walls/stonewall.png", direction: 5, lineAxis: 5,
        startPoint: { kind: "node", xindex: 2, yindex: 4, x: nodes[2][4].x, y: nodes[2][4].y },
        endPoint: { kind: "node", xindex: 9, yindex: 1, x: nodes[9][1].x, y: nodes[9][1].y }
    };

    const result = computeWallRecordSplits(wallRecord, orderedAnchors);

    assert.equal(result.needsSplit, true);
    assert.equal(result.pieces.length, 3);
    assert.equal(result.splitPoints.length, 2);

    // Piece 1: section A
    assert.equal(result.pieces[0].sectionKey, "A");
    assert.deepEqual(result.pieces[0].record.startPoint, wallRecord.startPoint);
    assert.equal(result.pieces[0].record.endPoint.kind, "midpoint");
    assert.ok(Math.abs(result.pieces[0].record.endPoint.x - seam_AB.x) < 0.001);
    assert.ok(Math.abs(result.pieces[0].record.endPoint.y - seam_AB.y) < 0.001);

    // Piece 2: section B
    assert.equal(result.pieces[1].sectionKey, "B");
    assert.equal(result.pieces[1].record.startPoint.kind, "midpoint");
    assert.equal(result.pieces[1].record.endPoint.kind, "midpoint");
    assert.ok(Math.abs(result.pieces[1].record.startPoint.x - seam_AB.x) < 0.001);
    assert.ok(Math.abs(result.pieces[1].record.endPoint.x - seam_BC.x) < 0.001);

    // Piece 3: section C
    assert.equal(result.pieces[2].sectionKey, "C");
    assert.equal(result.pieces[2].record.startPoint.kind, "midpoint");
    assert.deepEqual(result.pieces[2].record.endPoint, wallRecord.endPoint);

    // All pieces have _splitGroupId = original id and null ids
    for (const piece of result.pieces) {
        assert.equal(piece.record._splitGroupId, 500);
        assert.equal(piece.record.id, null);
    }
});

test("handles virtual split point when no seam midpoint exists between sections", () => {
    // Simulate the diagonal crossing case: two consecutive definite anchors
    // in different sections with no seam midpoint between them.
    const nodeA = new TestNode(3, 3);
    nodeA._prototypeSectionKey = "A";
    const nodeB = new TestNode(4, 2);
    nodeB._prototypeSectionKey = "B";

    const orderedAnchors = [
        { anchor: nodeA, t: 0.0, key: "n:3,3" },
        { anchor: nodeB, t: 1.0, key: "n:4,2" }
    ];

    const wallRecord = {
        type: "wallSection", id: 400, height: 2, thickness: 0.375, bottomZ: 0,
        wallTexturePath: "/assets/images/walls/stonewall.png", direction: 4, lineAxis: 4,
        startPoint: { kind: "node", xindex: 3, yindex: 3, x: nodeA.x, y: nodeA.y },
        endPoint: { kind: "node", xindex: 4, yindex: 2, x: nodeB.x, y: nodeB.y }
    };

    const result = computeWallRecordSplits(wallRecord, orderedAnchors);

    assert.equal(result.needsSplit, true);
    assert.equal(result.pieces.length, 2);
    assert.equal(result.splitPoints.length, 1);
    assert.equal(result.splitPoints[0].isVirtual, true);
    assert.equal(result.splitPoints[0].fromSection, "A");
    assert.equal(result.splitPoints[0].toSection, "B");

    // Virtual split point is at the geometric midpoint of the two anchors
    const expectedX = (nodeA.x + nodeB.x) / 2;
    const expectedY = (nodeA.y + nodeB.y) / 2;
    assert.ok(Math.abs(result.splitPoints[0].anchor.x - expectedX) < 0.001);
    assert.ok(Math.abs(result.splitPoints[0].anchor.y - expectedY) < 0.001);

    assert.equal(result.pieces[0].sectionKey, "A");
    assert.equal(result.pieces[1].sectionKey, "B");

    // Virtual split endpoints should have _splitVertex: true
    assert.equal(result.pieces[0].record.endPoint.kind, "point");
    assert.equal(result.pieces[0].record.endPoint._splitVertex, true);
    assert.equal(result.pieces[1].record.startPoint.kind, "point");
    assert.equal(result.pieces[1].record.startPoint._splitVertex, true);
});

// --- _splitVertex round-trip through serialize → resolve ---

test("_splitVertex endpoint survives _serializeEndpoint → _resolveSerializedEndpoint round-trip", () => {
    // Load the real WallSectionUnit for its static methods
    require("../public/assets/javascript/gameobjects/wallSectionUnit.js");
    const WSU = globalThis.WallSectionUnit;

    // A split-vertex endpoint as produced by normalizeEndpoint bypass
    const splitEp = { x: 1.5, y: 2.75, _splitVertex: true };

    // Serialize (this is what toJson / save does)
    const serialized = WSU._serializeEndpoint(splitEp);
    assert.ok(serialized, "serialized endpoint should not be null");
    assert.equal(serialized.kind, "point");
    assert.equal(serialized._splitVertex, true, "_splitVertex must be preserved in serialized form");

    // Resolve (this is what loadJson does) — no mapRef needed for _splitVertex
    const resolved = WSU._resolveSerializedEndpoint(serialized, null);
    assert.ok(resolved, "resolved endpoint should not be null");
    assert.ok(Math.abs(resolved.x - 1.5) < 1e-6, "x must survive round-trip");
    assert.ok(Math.abs(resolved.y - 2.75) < 1e-6, "y must survive round-trip");
    assert.equal(resolved._splitVertex, true, "_splitVertex must survive round-trip");
});

test("preserves scriptingName on all split pieces", () => {
    const nodeA = new TestNode(2, 3);
    nodeA._prototypeSectionKey = "A";
    const nodeB = new TestNode(4, 2);
    nodeB._prototypeSectionKey = "B";
    // Wire them as neighbors so makeMidpoint works
    nodeA.neighbors[5] = nodeB;
    const seamMid = makeMidpoint(nodeA, nodeB);
    assert.notEqual(seamMid, null);

    const orderedAnchors = [
        { anchor: nodeA, t: 0.0, key: "n:2,3" },
        { anchor: seamMid, t: 0.5, key: "m:1" },
        { anchor: nodeB, t: 1.0, key: "n:4,2" }
    ];

    const wallRecord = {
        type: "wallSection", id: 600, height: 2, thickness: 0.375, bottomZ: 0,
        wallTexturePath: "/assets/images/walls/stonewall.png", direction: 5, lineAxis: 5,
        scriptingName: "outerWall",
        startPoint: { kind: "node", xindex: 2, yindex: 3, x: nodeA.x, y: nodeA.y },
        endPoint: { kind: "node", xindex: 4, yindex: 2, x: nodeB.x, y: nodeB.y }
    };

    const result = computeWallRecordSplits(wallRecord, orderedAnchors);

    assert.equal(result.needsSplit, true);
    for (const piece of result.pieces) {
        assert.equal(piece.record.scriptingName, "outerWall");
    }
});

test("WallSectionUnit joinery ignores walls on different traversal layers", () => {
    delete require.cache[require.resolve("../public/assets/javascript/gameobjects/wallSectionUnit.js")];
    require("../public/assets/javascript/gameobjects/wallSectionUnit.js");
    const WSU = globalThis.WallSectionUnit;
    WSU._allSections.clear();

    const nodes = buildTestGrid(5, 5);
    const a = nodes[1][2];
    const shared = nodes[2][2];
    const b = nodes[3][2];

    const lower = new WSU(a, shared, {
        deferSetup: true,
        bottomZ: 0,
        traversalLayer: 0,
        level: 0
    });
    const upper = new WSU(shared, b, {
        deferSetup: true,
        bottomZ: 3,
        traversalLayer: 1,
        level: 1
    });
    const lowerNeighbor = new WSU(shared, b, {
        deferSetup: true,
        bottomZ: 0,
        traversalLayer: 0,
        level: 0
    });

    assert.equal(lower.sharesEndpointWith(upper), false);
    assert.equal(lower.connectTo(upper), false);
    assert.equal(lower.connectTo(lowerNeighbor), true);

    lower.connections.clear();
    lowerNeighbor.connections.clear();
    WSU.batchHandleJoinery([lower, upper, lowerNeighbor]);

    assert.equal(lower.connections.has(upper.id), false);
    assert.equal(upper.connections.size, 0);
    assert.equal(lower.connections.has(lowerNeighbor.id), true);

    WSU._allSections.clear();
});

test("WallSectionUnit registers upper-layer walls to nodes touched by their ground hitbox", () => {
    delete require.cache[require.resolve("../public/assets/javascript/gameobjects/wallSectionUnit.js")];
    require("../public/assets/javascript/gameobjects/wallSectionUnit.js");
    const WSU = globalThis.WallSectionUnit;
    WSU._allSections.clear();

    const baseNode = new TestNode(10, 10);
    baseNode._prototypeSectionKey = "0,0";
    const upperNode = new TestNode(10, 10);
    upperNode.traversalLayer = 1;
    upperNode.level = 1;
    upperNode.sourceNode = baseNode;
    upperNode.objects = [];
    upperNode.addObject = function addObject(obj) {
        this.objects.push(obj);
    };
    upperNode.removeObject = function removeObject(obj) {
        const index = this.objects.indexOf(obj);
        if (index >= 0) this.objects.splice(index, 1);
    };
    const outsideStart = new TestNode(99, 99);
    const outsideEnd = new TestNode(100, 99);
    const map = {
        worldToNode() {
            return baseNode;
        },
        getNodesInIndexWindow() {
            return [baseNode];
        },
        getFloorNodeAtLayer(xindex, yindex, layer) {
            return Number(xindex) === 10 && Number(yindex) === 10 && Number(layer) === 1
                ? upperNode
                : null;
        }
    };

    const wall = new WSU(outsideStart, outsideEnd, {
        deferSetup: true,
        map,
        bottomZ: 3,
        traversalLayer: 1,
        level: 1,
        thickness: 0.35
    });
    wall._collectCenterlineMapNodes = () => [];
    wall.groundPlaneHitbox = {
        getBounds() {
            return { x: baseNode.x - 0.1, y: baseNode.y - 0.1, width: 0.2, height: 0.2 };
        }
    };

    wall.addToMapNodes({ applyDirectionalBlocking: false });

    assert.equal(upperNode.objects.includes(wall), true);
    assert.equal(wall.nodes.includes(upperNode), true);

    wall.removeFromMapNodes();
    WSU._allSections.clear();
});
