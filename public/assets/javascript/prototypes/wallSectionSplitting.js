(function (globalScope) {
    "use strict";

    // --- Anchor type detection (mirrors WallSectionUnit helpers) ---

    function _isMapNode(anchor) {
        return !!(anchor && typeof anchor.xindex === "number" && typeof anchor.yindex === "number");
    }

    function _isNodeMidpoint(anchor) {
        return !!(
            anchor &&
            !_isMapNode(anchor) &&
            anchor.nodeA &&
            anchor.nodeB &&
            anchor.k !== undefined
        );
    }

    // --- Section classification ---

    /**
     * Classify an anchor's section membership.
     *
     * @param {Object} anchor — a MapNode, midpoint {nodeA, nodeB, k, x, y}, or raw {x, y}
     * @returns {{ type: "definite", sectionKey: string }
     *         | { type: "seam", keys: [string, string] }
     *         | { type: "unknown" }}
     */
    function classifyAnchorSection(anchor) {
        if (_isMapNode(anchor)) {
            var key = anchor._prototypeSectionKey;
            if (typeof key === "string") return { type: "definite", sectionKey: key };
            return { type: "unknown" };
        }
        if (_isNodeMidpoint(anchor)) {
            var keyA = anchor.nodeA ? anchor.nodeA._prototypeSectionKey : undefined;
            var keyB = anchor.nodeB ? anchor.nodeB._prototypeSectionKey : undefined;
            if (typeof keyA === "string" && typeof keyB === "string") {
                if (keyA === keyB) return { type: "definite", sectionKey: keyA };
                return { type: "seam", keys: keyA < keyB ? [keyA, keyB] : [keyB, keyA] };
            }
            if (typeof keyA === "string") return { type: "definite", sectionKey: keyA };
            if (typeof keyB === "string") return { type: "definite", sectionKey: keyB };
        }
        return { type: "unknown" };
    }

    /**
     * Determine whether a wall runs along a section seam and should NOT be split.
     *
     * A wall is "along seam" if:
     *   (a) all anchors are seam midpoints (no definite-section anchors exist), or
     *   (b) every consecutive pair of definite-section anchors are in different sections
     *       (the wall zigzags across the boundary with no sustained run in either section).
     */
    function isAlongSeam(classifications) {
        var definites = [];
        var seamCount = 0;
        for (var i = 0; i < classifications.length; i++) {
            if (classifications[i].type === "definite") definites.push(classifications[i]);
            if (classifications[i].type === "seam") seamCount++;
        }

        // (a) All seam / unknown — no definite anchors at all
        if (definites.length === 0) {
            return seamCount >= 2;
        }

        // Need at least three definite anchors to detect a zigzag along the seam.
        // With exactly two definites in different sections (A→B), it's a single
        // crossing, not an along-seam pattern.
        if (definites.length < 3) return false;

        // (b) Every consecutive pair alternates sections
        for (var j = 1; j < definites.length; j++) {
            if (definites[j].sectionKey === definites[j - 1].sectionKey) return false;
        }
        return true;
    }

    // --- Split-point detection ---

    /**
     * Walk the classified anchor sequence and find the indices where the wall
     * should be split.
     *
     * @returns {Array<{ anchorIndex: number, anchor: Object, t: number,
     *                    fromSection: string, toSection: string, isVirtual: boolean }>}
     */
    function findSplitPoints(orderedAnchors, classifications) {
        var currentSection = null;
        var lastDefiniteIndex = -1;
        var splitPoints = [];

        for (var i = 0; i < orderedAnchors.length; i++) {
            var c = classifications[i];
            if (c.type !== "definite") continue;

            if (currentSection === null) {
                // First definite anchor establishes the starting section.
                currentSection = c.sectionKey;
                lastDefiniteIndex = i;
                continue;
            }

            if (c.sectionKey === currentSection) {
                lastDefiniteIndex = i;
                continue;
            }

            // --- Section transition detected ---
            // Scan backward from this anchor toward the previous same-section definite
            // anchor, looking for the nearest seam midpoint.
            var splitIndex = -1;
            for (var j = i - 1; j > lastDefiniteIndex; j--) {
                if (classifications[j].type === "seam") {
                    splitIndex = j;
                    break;
                }
            }

            if (splitIndex >= 0) {
                // Normal case: split at the seam midpoint.
                splitPoints.push({
                    anchorIndex: splitIndex,
                    anchor: orderedAnchors[splitIndex].anchor,
                    t: orderedAnchors[splitIndex].t,
                    fromSection: currentSection,
                    toSection: c.sectionKey,
                    isVirtual: false
                });
            } else {
                // No seam midpoint between the two different-section definite anchors
                // (e.g. diagonal wall crossing at a hex vertex).
                // Create a virtual split point at the geometric midpoint.
                var prevAnchor = orderedAnchors[lastDefiniteIndex].anchor;
                var currAnchor = orderedAnchors[i].anchor;
                splitPoints.push({
                    anchorIndex: -1,
                    anchor: {
                        x: (Number(prevAnchor.x) + Number(currAnchor.x)) / 2,
                        y: (Number(prevAnchor.y) + Number(currAnchor.y)) / 2
                    },
                    t: (orderedAnchors[lastDefiniteIndex].t + orderedAnchors[i].t) / 2,
                    fromSection: currentSection,
                    toSection: c.sectionKey,
                    isVirtual: true
                });
            }

            currentSection = c.sectionKey;
            lastDefiniteIndex = i;
        }

        return splitPoints;
    }

    // --- Endpoint serialization for split points ---

    /**
     * Serialize a split point anchor to a wall-record endpoint.
     * Seam midpoints → kind:"midpoint" with proper node indices.
     * Virtual hex vertices → kind:"point" with _splitVertex:true.
     */
    function serializeSplitEndpoint(sp) {
        var anchor = sp.anchor;
        if (!sp.isVirtual && _isNodeMidpoint(anchor)) {
            var a = anchor.nodeA;
            var b = anchor.nodeB;
            if (_isMapNode(a) && _isMapNode(b)) {
                return {
                    kind: "midpoint",
                    a: { xindex: Number(a.xindex), yindex: Number(a.yindex) },
                    b: { xindex: Number(b.xindex), yindex: Number(b.yindex) },
                    x: Number(anchor.x),
                    y: Number(anchor.y)
                };
            }
        }
        if (!sp.isVirtual && _isMapNode(anchor)) {
            return {
                kind: "node",
                xindex: Number(anchor.xindex),
                yindex: Number(anchor.yindex),
                x: Number(anchor.x),
                y: Number(anchor.y)
            };
        }
        // Virtual split point (hex vertex) or fallback
        return {
            kind: "point",
            x: Number(anchor.x),
            y: Number(anchor.y),
            _splitVertex: sp.isVirtual === true
        };
    }

    // --- Record splitting ---

    /**
     * Produce piece records from the original wall record and the computed
     * split points.
     *
     * Each piece is a shallow copy of the original record with:
     *   - id set to null (caller assigns new IDs)
     *   - _splitGroupId set to the original record's id
     *   - startPoint / endPoint updated for the piece's range
     *   - split-boundary endpoints serialized properly (midpoints as
     *     kind:"midpoint", hex vertices as kind:"point" with _splitVertex)
     *
     * @returns {Array<{ record: Object, sectionKey: string }>}
     */
    function splitWallRecord(wallRecord, splitPoints) {
        if (!splitPoints || splitPoints.length === 0) {
            return [{ record: wallRecord, sectionKey: null }];
        }

        var originalId = wallRecord.id;
        var pieces = [];
        var currentStartPoint = wallRecord.startPoint;

        for (var s = 0; s < splitPoints.length; s++) {
            var sp = splitPoints[s];
            var splitEndpoint = serializeSplitEndpoint(sp);

            var pieceRecord = Object.assign({}, wallRecord);
            pieceRecord.id = null;
            pieceRecord.startPoint = currentStartPoint;
            pieceRecord.endPoint = splitEndpoint;
            pieceRecord._splitGroupId = originalId;

            pieces.push({ record: pieceRecord, sectionKey: sp.fromSection });

            currentStartPoint = serializeSplitEndpoint(sp);
        }

        // Final piece: from last split point to original end
        var finalRecord = Object.assign({}, wallRecord);
        finalRecord.id = null;
        finalRecord.startPoint = currentStartPoint;
        finalRecord.endPoint = wallRecord.endPoint;
        finalRecord._splitGroupId = originalId;

        pieces.push({
            record: finalRecord,
            sectionKey: splitPoints[splitPoints.length - 1].toSection
        });

        return pieces;
    }

    // --- Main entry point ---

    /**
     * Compute how a wall record should be split at section seams.
     *
     * @param {Object} wallRecord — serialized wall record (as stored in a section asset)
     * @param {Array}  orderedAnchors — anchor entries from a walked wall, each
     *   { anchor, t, key } where anchor is a live MapNode or midpoint object
     *   with _prototypeSectionKey set on its constituent nodes.
     *
     * @returns {{
     *   needsSplit: boolean,
     *   pieces: Array<{ record: Object, sectionKey: string|null }>,
     *   splitPoints: Array
     * }}
     */
    function computeWallRecordSplits(wallRecord, orderedAnchors) {
        if (!wallRecord || !Array.isArray(orderedAnchors) || orderedAnchors.length < 2) {
            return { needsSplit: false, pieces: [{ record: wallRecord, sectionKey: null }], splitPoints: [] };
        }

        // Classify every anchor
        var classifications = [];
        for (var i = 0; i < orderedAnchors.length; i++) {
            classifications.push(classifyAnchorSection(orderedAnchors[i].anchor));
        }

        // Walls that run along the seam boundary should not be split
        if (isAlongSeam(classifications)) {
            return { needsSplit: false, pieces: [{ record: wallRecord, sectionKey: null }], splitPoints: [] };
        }

        // Find split points
        var splitPoints = findSplitPoints(orderedAnchors, classifications);

        if (splitPoints.length === 0) {
            // No transitions found — wall is in a single section
            var sectionKey = null;
            for (var k = 0; k < classifications.length; k++) {
                if (classifications[k].type === "definite") {
                    sectionKey = classifications[k].sectionKey;
                    break;
                }
            }
            return { needsSplit: false, pieces: [{ record: wallRecord, sectionKey: sectionKey }], splitPoints: [] };
        }

        var pieces = splitWallRecord(wallRecord, splitPoints);
        return { needsSplit: true, pieces: pieces, splitPoints: splitPoints };
    }

    // --- Exports ---

    var api = {
        classifyAnchorSection: classifyAnchorSection,
        isAlongSeam: isAlongSeam,
        findSplitPoints: findSplitPoints,
        splitWallRecord: splitWallRecord,
        computeWallRecordSplits: computeWallRecordSplits
    };

    globalScope.__wallSectionSplitting = api;

})(typeof globalThis !== "undefined" ? globalThis : window);

if (typeof module !== "undefined" && module.exports) {
    module.exports = globalThis.__wallSectionSplitting;
}
