(function (globalScope) {
    "use strict";

    const CAMERA_DEFAULT_PITCH = Math.PI / 4;
    const DEPTH_NEAR_METRIC = -128;
    const DEPTH_FAR_METRIC = 256;
    const DEFAULT_BEAM_TEXTURE = "/assets/images/walls/stonewall.png";
    const DEFAULT_REPEAT_X = 0.1;
    const DEFAULT_REPEAT_Y = 0.1;

    class BeamUnit {
        static _nextId = 1;

        constructor(options = {}) {
            this.type = "beam";
            this.id = Number.isInteger(options.id) ? Number(options.id) : BeamUnit._nextId++;
            BeamUnit._nextId = Math.max(BeamUnit._nextId, this.id + 1);
            this.map = options.map || null;
            this.gone = false;
            this.blocksTile = false;
            this.isPassable = true;
            this.blocksMovement = !!options.blocksMovement;
            this.traversalLayer = Number.isFinite(options.traversalLayer)
                ? Math.round(Number(options.traversalLayer))
                : 0;

            this.startX = Number.isFinite(options.startX) ? Number(options.startX) : 0;
            this.startY = Number.isFinite(options.startY) ? Number(options.startY) : 0;
            this.startZ = Number.isFinite(options.startZ) ? Number(options.startZ) : 0;
            this.endX = Number.isFinite(options.endX) ? Number(options.endX) : 1;
            this.endY = Number.isFinite(options.endY) ? Number(options.endY) : 0;
            this.endZ = Number.isFinite(options.endZ) ? Number(options.endZ) : 0;
            this.thickness = Math.max(0.001, Number.isFinite(options.thickness) ? Number(options.thickness) : 0.3);
            this.height = Math.max(0.001, Number.isFinite(options.height) ? Number(options.height) : 0.2);
            this.bottomZ = Number.isFinite(options.bottomZ) ? Number(options.bottomZ) : Math.min(this.startZ, this.endZ);
            this.texturePath = (typeof options.texturePath === "string" && options.texturePath.length > 0)
                ? options.texturePath
                : DEFAULT_BEAM_TEXTURE;

            this.x = (this.startX + this.endX) * 0.5;
            this.y = (this.startY + this.endY) * 0.5;

            this.nodes = [];
            this.mesh3d = null;
            this._depthDisplayMesh = null;
            this._depthGeometryCache = null;

            if (!options.deferSetup) {
                this.rebuildMesh3d();
            }
        }

        static loadJson(data, mapRef, options = {}) {
            if (!data || data.type !== "beam" || !mapRef) return null;
            try {
                return new BeamUnit({
                    id: Number.isInteger(data.id) ? Number(data.id) : undefined,
                    map: mapRef,
                    startX: data.startX, startY: data.startY, startZ: data.startZ,
                    endX: data.endX, endY: data.endY, endZ: data.endZ,
                    thickness: data.thickness,
                    height: data.height,
                    bottomZ: data.bottomZ,
                    texturePath: data.texturePath,
                    traversalLayer: data.traversalLayer,
                    blocksMovement: !!data.blocksMovement,
                    deferSetup: !!options.deferSetup
                });
            } catch (_e) {
                return null;
            }
        }

        addToMapNodes() {
            this.removeFromMapNodes();
            if (!this.map || typeof this.map.worldToNode !== "function") return;
            const node = this.map.worldToNode(this.x, this.y);
            if (!node) return;
            this.nodes = [node];
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
        }

        rebuildMesh3d() {
            const sx = this.startX, sy = this.startY;
            const ex = this.endX, ey = this.endY;
            const dx = ex - sx, dy = ey - sy;
            const len = Math.hypot(dx, dy);
            if (!(len > 1e-6)) {
                this.mesh3d = null;
                this._depthGeometryCache = null;
                return null;
            }
            const nx = -dy / len, ny = dx / len;
            const t2 = this.thickness * 0.5;
            const z0 = Number.isFinite(this.bottomZ) ? Number(this.bottomZ) : 0;
            const z1 = z0 + this.height;

            // bottom ring: 0-3, top ring: 4-7
            const corners = [
                { x: sx + nx * t2, y: sy + ny * t2 },
                { x: ex + nx * t2, y: ey + ny * t2 },
                { x: ex - nx * t2, y: ey - ny * t2 },
                { x: sx - nx * t2, y: sy - ny * t2 }
            ];

            const vertices = [];
            for (const c of corners) vertices.push(c.x, c.y, z0);
            for (const c of corners) vertices.push(c.x, c.y, z1);

            const indices = [];
            indices.push(4, 5, 6, 4, 6, 7);          // top face
            indices.push(0, 3, 2, 0, 2, 1);           // bottom face
            for (let i = 0; i < 4; i++) {             // side faces
                const j = (i + 1) % 4;
                indices.push(i, j, j + 4, i, j + 4, i + 4);
            }

            this.mesh3d = { kind: "beamPrism", id: this.id, vertices, indices };
            this._depthGeometryCache = null;
            return this.mesh3d;
        }

        _buildDepthGeometry() {
            if (this._depthGeometryCache) return this._depthGeometryCache;
            const mesh3d = this.mesh3d || this.rebuildMesh3d();
            if (!mesh3d) return null;
            const { vertices, indices } = mesh3d;
            if (!vertices || !indices || vertices.length < 9 || indices.length < 3) return null;

            const sx = this.startX, sy = this.startY;
            const ex = this.endX, ey = this.endY;
            const dx = ex - sx, dy = ey - sy;
            const len = Math.hypot(dx, dy) || 1;
            const ux = dx / len, uy = dy / len;
            const z0 = Number.isFinite(this.bottomZ) ? Number(this.bottomZ) : 0;
            const topFaceTriCount = 2;

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
                    const wx = vertices[src * 3], wy = vertices[src * 3 + 1], wz = vertices[src * 3 + 2];
                    const along = (wx - sx) * ux + (wy - sy) * uy;
                    positions[vOut * 3] = wx;
                    positions[vOut * 3 + 1] = wy;
                    positions[vOut * 3 + 2] = wz;
                    uvs[vOut * 2] = along * DEFAULT_REPEAT_X;
                    uvs[vOut * 2 + 1] = (this.height - (wz - z0)) * DEFAULT_REPEAT_Y;
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
                texture = PIXI.Texture.from(this.texturePath);
                if (texture && texture.baseTexture) {
                    texture.baseTexture.wrapMode = PIXI.WRAP_MODES.REPEAT;
                    texture.baseTexture.scaleMode = PIXI.SCALE_MODES.LINEAR;
                }
            }

            const geometry = { positions, uvs, colors, textureMix, indices: outIndices, texture, alphaCutoff: 0.02 };
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
            mesh.name = `beamUnit_${this.id}_depthMesh`;
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
            if (mesh._beamGeometryRef !== geometry) {
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
                mesh._beamGeometryRef = geometry;
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

    globalScope.BeamUnit = BeamUnit;
})(typeof globalThis !== "undefined" ? globalThis : window);
