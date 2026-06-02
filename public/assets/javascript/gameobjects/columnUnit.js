(function (globalScope) {
    "use strict";

    const CAMERA_DEFAULT_PITCH = Math.PI / 4;
    const DEPTH_NEAR_METRIC = -128;
    const DEPTH_FAR_METRIC = 256;
    const DEFAULT_COLUMN_TEXTURE = "/assets/images/walls/stonewall.png";
    const DEFAULT_REPEAT_X = 0.1;
    const DEFAULT_REPEAT_Y = 0.1;

    function _wallTextureRepeatConfig(texturePath) {
        const wallCtor = globalScope.WallSectionUnit || null;
        if (!wallCtor || typeof wallCtor._getWallTextureRepeatConfig !== "function") {
            throw new Error("column texture tiling requires WallSectionUnit texture repeat config");
        }
        const cfg = wallCtor._getWallTextureRepeatConfig(texturePath || DEFAULT_COLUMN_TEXTURE);
        const repeatX = Number(cfg && cfg.repeatsPerMapUnitX);
        const repeatY = Number(cfg && cfg.repeatsPerMapUnitY);
        return {
            texturePath: (cfg && typeof cfg.texturePath === "string" && cfg.texturePath.length > 0)
                ? cfg.texturePath
                : (texturePath || DEFAULT_COLUMN_TEXTURE),
            repeatsPerMapUnitX: Number.isFinite(repeatX) && repeatX > 0 ? repeatX : DEFAULT_REPEAT_X,
            repeatsPerMapUnitY: Number.isFinite(repeatY) && repeatY > 0 ? repeatY : DEFAULT_REPEAT_Y
        };
    }

    function _columnVertices(x, y, sideCount, size, rotation, width = null, depth = null) {
        const n = Math.max(3, Math.min(12, Math.round(Number(sideCount) || 4)));
        const apothem = Math.max(0.001, Number(size) || 0.125);
        const resolvedWidth = Math.max(0.001, Number.isFinite(Number(width)) ? Number(width) : apothem * 2);
        const resolvedDepth = Math.max(0.001, Number.isFinite(Number(depth)) ? Number(depth) : apothem * 2);
        const rot = Number(rotation) || 0;
        const scale = 1 / Math.cos(Math.PI / n);
        const verts = [];
        for (let i = 0; i < n; i++) {
            const angle = Math.PI / n + (i * 2 * Math.PI) / n;
            const localX = (resolvedWidth * 0.5 * scale) * Math.cos(angle);
            const localY = (resolvedDepth * 0.5 * scale) * Math.sin(angle);
            verts.push({
                x: x + localX * Math.cos(rot) - localY * Math.sin(rot),
                y: y + localX * Math.sin(rot) + localY * Math.cos(rot)
            });
        }
        return verts;
    }

    class ColumnUnit {
        static _nextId = 1;

        constructor(options = {}) {
            this.type = "column";
            this.id = Number.isInteger(options.id) ? Number(options.id) : ColumnUnit._nextId++;
            ColumnUnit._nextId = Math.max(ColumnUnit._nextId, this.id + 1);
            this.map = options.map || null;
            this.gone = false;
            this.blocksTile = true;
            this.isPassable = false;
            this.traversalLayer = Number.isFinite(options.traversalLayer)
                ? Math.round(Number(options.traversalLayer))
                : 0;

            this.x = Number.isFinite(options.x) ? Number(options.x) : 0;
            this.y = Number.isFinite(options.y) ? Number(options.y) : 0;
            this.sideCount = Math.max(3, Math.min(12, Math.round(Number(options.sideCount) || 4)));
            this.size = Math.max(0.001, Number.isFinite(options.size) ? Number(options.size) : 0.125);
            this.width = Math.max(0.001, Number.isFinite(Number(options.width)) ? Number(options.width) : this.size * 2);
            this.depth = Math.max(0.001, Number.isFinite(Number(options.depth)) ? Number(options.depth) : this.size * 2);
            this.rotation = Number.isFinite(options.rotation) ? Number(options.rotation) : 0;
            this.height = Math.max(0.001, Number.isFinite(options.height) ? Number(options.height) : 3);
            this.topHeights = Array.isArray(options.topHeights)
                ? options.topHeights.map((value) => Math.max(0.001, Number(value) || 0.001))
                : null;
            this.bottomZ = Number.isFinite(options.bottomZ) ? Number(options.bottomZ) : 0;
            this.texturePath = (typeof options.texturePath === "string" && options.texturePath.length > 0)
                ? options.texturePath
                : DEFAULT_COLUMN_TEXTURE;

            this.nodes = [];
            this._indexedNodes = [];
            this.mesh3d = null;
            this._depthDisplayMesh = null;
            this._depthGeometryCache = null;

            if (!options.deferSetup) {
                this.rebuildMesh3d();
            }
        }

        static loadJson(data, mapRef, options = {}) {
            if (!data || data.type !== "column" || !mapRef) return null;
            try {
                const pos = data.position || {};
                return new ColumnUnit({
                    id: Number.isInteger(data.id) ? Number(data.id) : undefined,
                    map: mapRef,
                    x: Number.isFinite(pos.x) ? pos.x : data.x,
                    y: Number.isFinite(pos.y) ? pos.y : data.y,
                    sideCount: data.sideCount,
                    size: data.size,
                    width: data.width,
                    depth: data.depth,
                    rotation: data.rotation,
                    height: data.height,
                    topHeights: data.topHeights,
                    bottomZ: data.bottomZ,
                    texturePath: data.texturePath,
                    traversalLayer: data.traversalLayer,
                    deferSetup: !!options.deferSetup
                });
            } catch (_e) {
                return null;
            }
        }

        addToMapNodes() {
            this.removeFromMapNodes();
            if (!this.map || typeof this.map.worldToNode !== "function") return;
            let node = this.map.worldToNode(this.x, this.y);
            if (
                node &&
                this.traversalLayer !== 0 &&
                typeof this.map.getFloorNodeAtLayer === "function"
            ) {
                const floorNode = this.map.getFloorNodeAtLayer(node.xindex, node.yindex, this.traversalLayer);
                if (floorNode) node = floorNode;
            }
            if (!node) return;
            this.nodes = [node];
            this._indexedNodes = [node];
            if (typeof node.addObject === "function") {
                node.addObject(this);
            }
        }

        removeFromMapNodes() {
            for (let i = 0; i < this.nodes.length; i++) {
                const node = this.nodes[i];
                if (node && typeof node.removeObject === "function") {
                    node.removeObject(this);
                }
            }
            this.nodes = [];
            this._indexedNodes = [];
        }

        rebuildMesh3d() {
            const verts = _columnVertices(this.x, this.y, this.sideCount, this.size, this.rotation, this.width, this.depth);
            if (!verts || verts.length < 3) {
                this.mesh3d = null;
                this._depthGeometryCache = null;
                return null;
            }
            const n = verts.length;
            const z0 = Number.isFinite(this.bottomZ) ? Number(this.bottomZ) : 0;
            const topHeights = Array.isArray(this.topHeights) && this.topHeights.length === n
                ? this.topHeights.map((value) => Math.max(0.001, Number(value) || 0.001))
                : null;
            const maxHeight = topHeights ? topHeights.reduce((max, value) => Math.max(max, value), 0.001) : this.height;

            // bottom ring: 0..n-1, top ring: n..2n-1
            const vertices = [];
            for (const v of verts) vertices.push(v.x, v.y, z0);
            for (let i = 0; i < verts.length; i++) {
                vertices.push(verts[i].x, verts[i].y, z0 + (topHeights ? topHeights[i] : maxHeight));
            }

            const indices = [];
            for (let i = 1; i < n - 1; i++) {         // top face fan
                indices.push(n, n + i, n + i + 1);
            }
            for (let i = 0; i < n; i++) {             // side faces
                const j = (i + 1) % n;
                indices.push(i, j, j + n, i, j + n, i + n);
            }

            this.mesh3d = { kind: "columnPrism", id: this.id, vertices, indices };
            this._depthGeometryCache = null;
            return this.mesh3d;
        }

        _buildDepthGeometry() {
            const wallTextureCfg = _wallTextureRepeatConfig(this.texturePath);
            const repeatX = Math.max(0.0001, Number(wallTextureCfg.repeatsPerMapUnitX) || DEFAULT_REPEAT_X);
            const repeatY = Math.max(0.0001, Number(wallTextureCfg.repeatsPerMapUnitY) || DEFAULT_REPEAT_Y);
            const repeatSignature = [
                wallTextureCfg.texturePath || this.texturePath || DEFAULT_COLUMN_TEXTURE,
                repeatX.toFixed(6),
                repeatY.toFixed(6)
            ].join("|");
            if (this._depthGeometryCache && this._depthGeometryCache.repeatSignature === repeatSignature) return this._depthGeometryCache;
            const mesh3d = this.mesh3d || this.rebuildMesh3d();
            if (!mesh3d) return null;
            const { vertices, indices } = mesh3d;
            if (!vertices || !indices || vertices.length < 9 || indices.length < 3) return null;

            const n = this.sideCount;
            const topFaceTriCount = n - 2;
            const z0 = Number.isFinite(this.bottomZ) ? Number(this.bottomZ) : 0;
            const verts = _columnVertices(this.x, this.y, n, this.size, this.rotation, this.width, this.depth);
            const topHeights = Array.isArray(this.topHeights) && this.topHeights.length === n
                ? this.topHeights.map((value) => Math.max(0.001, Number(value) || 0.001))
                : null;
            const maxHeight = topHeights ? topHeights.reduce((max, value) => Math.max(max, value), 0.001) : this.height;

            // Precompute cumulative perimeter distances for UV wrapping
            const perimeterDists = [0];
            let totalPerimeter = 0;
            for (let i = 0; i < n; i++) {
                const j = (i + 1) % n;
                totalPerimeter += Math.hypot(verts[j].x - verts[i].x, verts[j].y - verts[i].y);
                perimeterDists.push(totalPerimeter);
            }

            const triCount = Math.floor(indices.length / 3);
            const positions = new Float32Array(triCount * 9);
            const uvs = new Float32Array(triCount * 6);
            const colors = new Float32Array(triCount * 12);
            const textureMix = new Float32Array(triCount * 3);
            const outIndices = new Uint16Array(triCount * 3);

            let vOut = 0;
            for (let tri = 0; tri < triCount; tri++) {
                const isTopFace = tri < topFaceTriCount;
                const brightness = isTopFace ? 1.25 : 1.0;
                for (let c = 0; c < 3; c++) {
                    const src = indices[tri * 3 + c];
                    const isTopRing = src >= n;
                    const ringIdx = isTopRing ? src - n : src;
                    const wx = vertices[src * 3], wy = vertices[src * 3 + 1], wz = vertices[src * 3 + 2];
                    positions[vOut * 3] = wx;
                    positions[vOut * 3 + 1] = wy;
                    positions[vOut * 3 + 2] = wz;
                    uvs[vOut * 2] = perimeterDists[ringIdx] * repeatX;
                    uvs[vOut * 2 + 1] = (maxHeight - (wz - z0)) * repeatY;
                    colors[vOut * 4] = brightness;
                    colors[vOut * 4 + 1] = brightness;
                    colors[vOut * 4 + 2] = brightness;
                    colors[vOut * 4 + 3] = 1;
                    textureMix[vOut] = 1;
                    outIndices[vOut] = vOut;
                    vOut++;
                }
            }

            let texture = null;
            if (typeof PIXI !== "undefined" && PIXI.Texture) {
                texture = PIXI.Texture.from(wallTextureCfg.texturePath || this.texturePath);
                if (texture && texture.baseTexture) {
                    texture.baseTexture.wrapMode = PIXI.WRAP_MODES.REPEAT;
                    texture.baseTexture.scaleMode = PIXI.SCALE_MODES.LINEAR;
                }
            }

            const geometry = { positions, uvs, colors, textureMix, indices: outIndices, texture, alphaCutoff: 0.02, repeatSignature };
            this._depthGeometryCache = geometry;
            return geometry;
        }

        _createDepthDisplayMesh() {
            const wallCtor = globalScope.WallSectionUnit || null;
            const vs = wallCtor && wallCtor._DEPTH_VS;
            const fs = wallCtor && wallCtor._DEPTH_FS;
            if (!vs || !fs) return null;
            if (typeof PIXI === "undefined" || !PIXI.Geometry || !PIXI.Shader || !PIXI.Mesh) return null;
            const state = wallCtor && typeof wallCtor._ensureDepthMeshState === "function"
                ? wallCtor._ensureDepthMeshState()
                : null;
            if (!state) return null;
            const geo = new PIXI.Geometry()
                .addAttribute("aWorldPosition", new Float32Array(0), 3)
                .addAttribute("aUvs", new Float32Array(0), 2)
                .addAttribute("aColor", new Float32Array(0), 4)
                .addAttribute("aTextureMix", new Float32Array(0), 1)
                .addIndex(new Uint16Array(0));
            const shader = PIXI.Shader.from(vs, fs, {
                uScreenSize: new Float32Array([1, 1]),
                uCameraWorld: new Float32Array([0, 0]),
                uCameraZ: 0,
                uViewScale: 1,
                uXyRatio: 1,
                uCameraPitch: CAMERA_DEFAULT_PITCH,
                uDepthRange: new Float32Array([0, 1]),
                uCameraRotation: 0,
                uCameraRotationCenter: new Float32Array([0, 0]),
                uTint: new Float32Array([1, 1, 1, 1]),
                uBrightness: 0,
                uAlphaCutoff: 0.02,
                uClipMinZ: -1000000,
                uBuildingCutawayDataPass: 0,
                uBuildingCutawayDataZRange: new Float32Array([-64, 1 / 256]),
                uSampler: PIXI.Texture.WHITE
            });
            const mesh = new PIXI.Mesh(geo, shader, state, PIXI.DRAW_MODES.TRIANGLES);
            mesh.name = `columnUnit_${this.id}_depthMesh`;
            mesh.interactive = false;
            mesh.roundPixels = false;
            mesh.visible = false;
            return mesh;
        }

        _ensureDepthDisplayMesh() {
            if (this._depthDisplayMesh && !this._depthDisplayMesh.destroyed) return this._depthDisplayMesh;
            this._depthDisplayMesh = this._createDepthDisplayMesh();
            return this._depthDisplayMesh;
        }

        getDepthMeshDisplayObject(options = {}) {
            const mesh = this._ensureDepthDisplayMesh();
            if (!mesh || !mesh.geometry || !mesh.shader || !mesh.shader.uniforms) return null;
            const geometry = this._buildDepthGeometry();
            if (!geometry) return null;
            if (mesh._columnGeometryRef !== geometry) {
                const pos = mesh.geometry.getBuffer("aWorldPosition");
                const uv = mesh.geometry.getBuffer("aUvs");
                const col = mesh.geometry.getBuffer("aColor");
                const mix = mesh.geometry.getBuffer("aTextureMix");
                const idx = mesh.geometry.getIndex();
                if (!pos || !uv || !col || !mix || !idx) return null;
                pos.data = geometry.positions;
                uv.data = geometry.uvs;
                col.data = geometry.colors;
                mix.data = geometry.textureMix;
                idx.data = geometry.indices;
                pos.update(); uv.update(); col.update(); mix.update(); idx.update();
                mesh._columnGeometryRef = geometry;
            }
            const camera = options.camera || (typeof globalScope.viewport !== "undefined" ? globalScope.viewport : null);
            const appRef = options.app || (typeof globalScope.app !== "undefined" ? globalScope.app : null);
            const viewscale = Number.isFinite(options.viewscale) ? options.viewscale
                : (Number.isFinite(globalScope.viewscale) ? globalScope.viewscale : 1);
            const xyratio = Number.isFinite(options.xyratio) ? options.xyratio
                : (Number.isFinite(globalScope.xyratio) ? globalScope.xyratio : 1);
            const tint = Number.isFinite(options.tint) ? options.tint : 0xFFFFFF;
            const alpha = Number.isFinite(options.alpha) ? options.alpha : 1;
            const brightnessPct = Number(options.brightness) || 0;
            const invSpan = 1 / Math.max(1e-6, DEPTH_FAR_METRIC - DEPTH_NEAR_METRIC);
            const screenW = appRef && appRef.screen ? Number(appRef.screen.width) : 1;
            const screenH = appRef && appRef.screen ? Number(appRef.screen.height) : 1;
            const u = mesh.shader.uniforms;
            u.uScreenSize[0] = Math.max(1, screenW);
            u.uScreenSize[1] = Math.max(1, screenH);
            u.uCameraWorld[0] = Number(camera && camera.x) || 0;
            u.uCameraWorld[1] = Number(camera && camera.y) || 0;
            u.uCameraZ = Number(camera && camera.z) || 0;
            u.uViewScale = viewscale;
            u.uXyRatio = xyratio;
            u.uCameraPitch = Number.isFinite(options.cameraPitch) ? options.cameraPitch
                : (Number.isFinite(camera && camera.pitch) ? camera.pitch : CAMERA_DEFAULT_PITCH);
            u.uDepthRange[0] = DEPTH_FAR_METRIC;
            u.uDepthRange[1] = invSpan;
            u.uCameraRotation = Number.isFinite(options.cameraRotation) ? options.cameraRotation
                : (Number.isFinite(camera && camera.rotation) ? camera.rotation : 0);
            const rotCenter = options.cameraRotationCenter || (camera && camera.rotationCenter) || null;
            u.uCameraRotationCenter[0] = Number(rotCenter && rotCenter.x) || 0;
            u.uCameraRotationCenter[1] = Number(rotCenter && rotCenter.y) || 0;
            u.uTint[0] = ((tint >> 16) & 255) / 255;
            u.uTint[1] = ((tint >> 8) & 255) / 255;
            u.uTint[2] = (tint & 255) / 255;
            u.uTint[3] = Math.max(0, Math.min(1, alpha));
            u.uBrightness = Math.max(-1, Math.min(1, brightnessPct / 100));
            u.uAlphaCutoff = 0.02;
            u.uClipMinZ = -1000000;
            u.uSampler = geometry.texture || PIXI.Texture.WHITE;
            mesh.visible = true;
            return mesh;
        }

        draw() {}

        remove() {
            if (this.gone) return;
            this.gone = true;
            this.removeFromMapNodes();
            if (this._depthDisplayMesh && !this._depthDisplayMesh.destroyed) {
                if (this._depthDisplayMesh.parent) this._depthDisplayMesh.parent.removeChild(this._depthDisplayMesh);
                this._depthDisplayMesh.destroy({ children: false, texture: false, baseTexture: false });
                this._depthDisplayMesh = null;
            }
        }
    }

    globalScope.ColumnUnit = ColumnUnit;
})(typeof globalThis !== "undefined" ? globalThis : window);
