class Roof {
    static buildConvexHull(points) {
        if (!Array.isArray(points) || points.length < 3) return Array.isArray(points) ? points.slice() : [];

        const sorted = points
            .filter(p => p && Number.isFinite(p.x) && Number.isFinite(p.y))
            .slice()
            .sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x));
        if (sorted.length < 3) return sorted;

        const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
        const lower = [];
        for (let i = 0; i < sorted.length; i++) {
            const p = sorted[i];
            while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
                lower.pop();
            }
            lower.push(p);
        }

        const upper = [];
        for (let i = sorted.length - 1; i >= 0; i--) {
            const p = sorted[i];
            while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
                upper.pop();
            }
            upper.push(p);
        }

        lower.pop();
        upper.pop();
        return lower.concat(upper);
    }

    constructor(x, y, heightFromGround) {
        this.x = x;
        this.y = y;
        this.heightFromGround = heightFromGround;
        this.peakHeight = heightFromGround + 7; // Peak is 3 units above base
        this.midHeight = heightFromGround + 4; // Midpoint for hex ring
        this.pixiMesh = null;
        this.textureName = 'assets/images/smallshingles.png';
        this.placed = false;

        const radius = 10.5; // Distance from center to eave

        const eaves = Array.from({ length: 12 }, (_, i) => {
            const angle = 30 * i - 15; // Start at -15° to align with hex points
            const rad = angle * (Math.PI / 180);

            return {
                x: Math.cos(rad) * radius,
                y: Math.sin(rad) * radius,
                z: this.heightFromGround
            };
        });
        
        const hexRingInner = Array.from({ length: 6 }, (_, i) => {
            const angle = 60 * i;
            const rad = angle * (Math.PI / 180);
            return {
                x: Math.cos(rad) * radius * 0.5,
                y: Math.sin(rad) * radius * 0.5,
                z: this.heightFromGround + this.midHeight
            };
        });

        const hexRingOuter = Array.from({ length: 6 }, (_, i) => {
            const angle = 60 * i;
            const rad = angle * (Math.PI / 180);
            return {
                x: Math.cos(rad) * radius * 0.625,
                y: Math.sin(rad) * radius * 0.625,
                z: this.heightFromGround + this.midHeight - 0.5
            };
        });

        const topPoint = { x: 0, y: 0, z: this.heightFromGround + this.peakHeight };

        this.numEaves = eaves.length;
        this.numHexRing = hexRingInner.length;
        this.vertices = [...eaves, ...hexRingInner, ...hexRingOuter, topPoint];
        this.faces = this.buildFaces(this.numEaves, this.numHexRing);
        this.updateGroundPlaneHitbox();
    }

    buildFaces(numEaves, numHexRing) {
        const faces = [];
        const eaveStartIdx = 0;
        const hexRingStartIdx = numEaves;
        const hexRingOuterStartIdx = numEaves + numHexRing;
        const peakIdx = numEaves + numHexRing + numHexRing;

        // Connect eaves to hexring with 3 triangles per section
        // Each section spans 2 adjacent eaves and 1 hexring, plus the next hexring
        for (let i = 0; i < numHexRing; i++) {
            const eaveIdx1 = eaveStartIdx + (2 * i);
            const eaveIdx2 = eaveStartIdx + ((2 * i + 1) % numEaves);
            const eaveIdx3 = eaveStartIdx + ((2 * i + 2) % numEaves);
            const hexIdx1 = hexRingStartIdx + i;
            const hexIdx2 = hexRingStartIdx + (i + 1) % numHexRing;

            // Triangle 1: Two eaves + first hexring vertex
            faces.push([eaveIdx1, eaveIdx2, hexIdx1]);

            // Triangle 2: Second eave + both hexring vertices (forms trapezoid)
            faces.push([eaveIdx2, eaveIdx3, hexIdx1]);

            // Triangle 3: Second eave + hexring vertices (completes section)
            faces.push([eaveIdx3, hexIdx2, hexIdx1]);
        }

        // Connect hexring vertices to peak (cone at top)
        for (let i = 0; i < numHexRing; i++) {
            const hexIdx1 = hexRingOuterStartIdx + i;
            const hexIdx2 = hexRingOuterStartIdx + (i + 1) % numHexRing;

            // Triangle from hexring edge up to peak
            faces.push([hexIdx1, hexIdx2, peakIdx]);
        }

        return faces;
    }

    createPixiMesh() {
        if (this.pixiMesh) {
            this.pixiMesh.destroy();
        }

        // Calculate rotation angle for isometric view
        const rotationRadians = Math.atan(1.15547);

        // Light direction (from upper right, slightly in front)
        const lightDir = { x: 0.5, y: -0.5, z: 0.7 };
        const lightLen = Math.sqrt(lightDir.x * lightDir.x + lightDir.y * lightDir.y + lightDir.z * lightDir.z);
        lightDir.x /= lightLen;
        lightDir.y /= lightLen;
        lightDir.z /= lightLen;

        // Calculate lighting for each face
        const faceLighting = new Array(this.faces.length);
        for (let i = 0; i < this.faces.length; i++) {
            const face = this.faces[i];
            const v0 = this.vertices[face[0]];
            const v1 = this.vertices[face[1]];
            const v2 = this.vertices[face[2]];

            // Calculate face normal (cross product)
            const edge1 = { x: v1.x - v0.x, y: v1.y - v0.y, z: v1.z - v0.z };
            const edge2 = { x: v2.x - v0.x, y: v2.y - v0.y, z: v2.z - v0.z };
            const normal = {
                x: edge1.y * edge2.z - edge1.z * edge2.y,
                y: edge1.z * edge2.x - edge1.x * edge2.z,
                z: edge1.x * edge2.y - edge1.y * edge2.x
            };
            const normalLen = Math.sqrt(normal.x * normal.x + normal.y * normal.y + normal.z * normal.z);
            normal.x /= normalLen;
            normal.y /= normalLen;
            normal.z /= normalLen;

            // Calculate lighting (dot product with light direction)
            const dot = normal.x * lightDir.x + normal.y * lightDir.y + normal.z * lightDir.z;
            const brightness = Math.max(0.3, Math.min(1.0, dot * 0.7 + 0.5)); // 0.3 to 1.0 range
            faceLighting[i] = brightness;
        }

        // Create vertex colors based on face lighting
        const vertexColors = new Float32Array(this.vertices.length);
        for (let i = 0; i < this.vertices.length; i++) {
            // Find all faces that use this vertex and average their lighting
            let totalBrightness = 0;
            let faceCount = 0;
            for (let f = 0; f < this.faces.length; f++) {
                if (this.faces[f].includes(i)) {
                    totalBrightness += faceLighting[f];
                    faceCount++;
                }
            }
            vertexColors[i] = faceCount > 0 ? totalBrightness / faceCount : 1.0;
        }

        // Flatten vertices for PIXI geometry with rotation applied
        const vertexData = new Float32Array(this.vertices.length * 2);
        for (let i = 0; i < this.vertices.length; i++) {
            const v = this.vertices[i];
            
            // Apply rotation on X-axis (pitch the roof toward the viewer)
            const cosR = Math.cos(rotationRadians);
            const sinR = Math.sin(rotationRadians);
            const rotatedY = v.y * cosR - v.z * sinR;
            const rotatedZ = v.y * sinR + v.z * cosR;
            
            // Store rotated coordinates without scaling
            vertexData[i * 2] = v.x;
            vertexData[i * 2 + 1] = rotatedY;
        }

        // Flatten indices from faces
        const indexData = new Uint16Array(this.faces.length * 3);
        for (let i = 0; i < this.faces.length; i++) {
            indexData[i * 3] = this.faces[i][0];
            indexData[i * 3 + 1] = this.faces[i][1];
            indexData[i * 3 + 2] = this.faces[i][2];
        }

        // Create a container to hold all face meshes
        this.pixiMesh = new PIXI.Container();
        this.pixiMesh.visible = false;

        // Load shingles texture
        const shinglesTexture = PIXI.Texture.from(this.textureName || 'assets/images/smallshingles.png');
        
        // Slate gray base color for lighting tint
        const baseColor = { r: 0x70, g: 0x80, b: 0x90 };

        // Create a separate mesh for each face with its own lighting
        for (let f = 0; f < this.faces.length; f++) {
            const face = this.faces[f];
            const brightness = faceLighting[f];
            
            // Create vertex data for this face
            const faceVertexData = new Float32Array(6); // 3 vertices * 2 coords
            for (let i = 0; i < 3; i++) {
                const vertexIndex = face[i];
                faceVertexData[i * 2] = vertexData[vertexIndex * 2];
                faceVertexData[i * 2 + 1] = vertexData[vertexIndex * 2 + 1];
            }

            // Simple index data for single triangle
            const faceIndexData = new Uint16Array([0, 1, 2]);

            const faceUvData = new Float32Array(6);
            const isRoofSideFace = f < this.numHexRing * 3;
            const faceInSection = f % 3;

            if (isRoofSideFace && faceInSection === 1) {
                // Triangle 2: part of rectangular face (eave2, eave3, hex1)
                faceUvData[0] = 0; faceUvData[1] = 1;
                faceUvData[2] = 1; faceUvData[3] = 1;
                faceUvData[4] = 0; faceUvData[5] = 0;
            } else if (isRoofSideFace && faceInSection === 2) {
                // Triangle 3: completes rectangular face (eave3, hex2, hex1)
                faceUvData[0] = 1; faceUvData[1] = 1;
                faceUvData[2] = 1; faceUvData[3] = 0;
                faceUvData[4] = 0; faceUvData[5] = 0;
            } else {
                // Triangle-only faces (eave triangle + peak cone)
                faceUvData[0] = 0; faceUvData[1] = 1;
                faceUvData[2] = 1; faceUvData[3] = 1;
                faceUvData[4] = 0.5; faceUvData[5] = 0;
            }

            const faceGeometry = new PIXI.Geometry()
                .addAttribute('aVertexPosition', faceVertexData, 2)
                .addAttribute('aUvs', faceUvData, 2)
                .addIndex(faceIndexData);

            const faceMaterial = new PIXI.MeshMaterial(shinglesTexture);
            const faceMesh = new PIXI.Mesh(faceGeometry, faceMaterial);
            
            // Apply lighting by tinting each face differently
            const r = Math.floor(baseColor.r * brightness);
            const g = Math.floor(baseColor.g * brightness);
            const b = Math.floor(baseColor.b * brightness);
            faceMesh.tint = (r << 16) | (g << 8) | b;

            this.pixiMesh.addChild(faceMesh);
        }

        return this.pixiMesh;
    }

    updateGroundPlaneHitbox() {
        // Ground-plane hitbox uses eave footprint, inset by 0.75 world units
        // (0.5 original + 0.25 additional), at z=0 semantics.
        // Wall depth ordering uses projected eaves-to-ground footprint.
        const eaveCount = Math.max(0, this.numEaves || 0);
        const eaves = Array.isArray(this.vertices) ? this.vertices.slice(0, eaveCount) : [];
        if (!eaves.length || typeof PolygonHitbox === 'undefined') {
            this.groundPlaneHitbox = null;
            this.wallDepthHitbox = null;
            return;
        }

        const eavePoints = eaves.map(v => ({
            x: this.x + v.x,
            y: this.y + v.y
        }));
        const projectedPoints = eaves.map(v => {
            // Project roof eaves to ground along the vertical draw axis used by
            // tall objects (y decreases as height increases), so occlusion depth
            // captures walls visually covered by roof slopes near the perimeter.
            const projection = Math.max(0, Number(this.peakHeight) || 0);
            return {
                x: this.x + v.x,
                y: this.y + v.y + projection
            };
        });
        const wallDepthHull = Roof.buildConvexHull(eavePoints.concat(projectedPoints));
        this.wallDepthHitbox = wallDepthHull.length >= 3 ? new PolygonHitbox(wallDepthHull) : null;

        const shrunkPoints = eaves.map(v => {
            const len = Math.hypot(v.x, v.y);
            if (len <= 0.000001) {
                return { x: this.x, y: this.y };
            }
            const targetLen = Math.max(0, len - 0.75);
            const scale = targetLen / len;
            return {
                x: this.x + v.x * scale,
                y: this.y + v.y * scale
            };
        });

        this.groundPlaneHitbox = new PolygonHitbox(shrunkPoints);
    }

    saveJson() {
        return {
            type: 'roof',
            x: this.x,
            y: this.y,
            heightFromGround: this.heightFromGround,
            peakHeight: this.peakHeight,
            midHeight: this.midHeight,
            textureName: this.textureName,
            placed: !!this.placed,
            numEaves: this.numEaves,
            numHexRing: this.numHexRing,
            vertices: Array.isArray(this.vertices)
                ? this.vertices.map(v => ({ x: v.x, y: v.y, z: v.z }))
                : [],
            triangles: Array.isArray(this.faces)
                ? this.faces.map(face => [face[0], face[1], face[2]])
                : [],
            groundPlaneHitbox: this.groundPlaneHitbox && Array.isArray(this.groundPlaneHitbox.points)
                ? { points: this.groundPlaneHitbox.points.map(p => ({ x: p.x, y: p.y })) }
                : null
        };
    }

    static loadJson(data) {
        if (!data || data.type !== 'roof') return null;

        const x = Number.isFinite(data.x) ? data.x : 0;
        const y = Number.isFinite(data.y) ? data.y : 0;
        const heightFromGround = Number.isFinite(data.heightFromGround) ? data.heightFromGround : 0;
        const roof = new Roof(x, y, heightFromGround);

        if (Number.isFinite(data.peakHeight)) roof.peakHeight = data.peakHeight;
        if (Number.isFinite(data.midHeight)) roof.midHeight = data.midHeight;
        if (typeof data.textureName === 'string' && data.textureName.length > 0) {
            roof.textureName = data.textureName;
        }
        roof.placed = !!data.placed;

        if (Array.isArray(data.vertices) && data.vertices.length >= 3) {
            roof.vertices = data.vertices.map(v => ({
                x: Number(v.x) || 0,
                y: Number(v.y) || 0,
                z: Number(v.z) || 0
            }));
        }
        if (Array.isArray(data.triangles) && data.triangles.length > 0) {
            roof.faces = data.triangles.map(t => [
                Number(t[0]) || 0,
                Number(t[1]) || 0,
                Number(t[2]) || 0
            ]);
        }

        // Keep ring metadata available for UV mapping fallback.
        roof.numEaves = Number.isFinite(data.numEaves) ? data.numEaves : 12;
        roof.numHexRing = Number.isFinite(data.numHexRing) ? data.numHexRing : 6;

        // Always rebuild derived hitboxes from geometry for current logic.
        roof.updateGroundPlaneHitbox();
        // Preserve saved indoor mask when present for backward compatibility.
        if (
            data.groundPlaneHitbox &&
            Array.isArray(data.groundPlaneHitbox.points) &&
            data.groundPlaneHitbox.points.length >= 3 &&
            typeof PolygonHitbox !== 'undefined'
        ) {
            roof.groundPlaneHitbox = new PolygonHitbox(
                data.groundPlaneHitbox.points.map(p => ({
                    x: Number(p.x) || 0,
                    y: Number(p.y) || 0
                }))
            );
        }

        return roof;
    }
}
