class Roof {
    constructor(x, y, heightFromGround) {
        this.x = x;
        this.y = y;
        this.heightFromGround = heightFromGround;
        this.peakHeight = heightFromGround + 5; // Peak is 3 units above base
        this.pixiMesh = null;

        const eaves = Array.from({ length: 12 }, (_, i) => {
            const angle = 30 * i - 15; // Start at -15° to align with hex points
            const rad = angle * (Math.PI / 180);
            const radius = 7; // Distance from center to eave
            return {
                x: Math.cos(rad) * radius,
                y: Math.sin(rad) * radius,
                z: this.heightFromGround
            };
        });
        
        const hexRing = Array.from({ length: 6 }, (_, i) => {
            const angle = 60 * i;
            const rad = angle * (Math.PI / 180);
            const radius = 3.5;
            return {
                x: Math.cos(rad) * radius,
                y: Math.sin(rad) * radius,
                z: this.heightFromGround + this.peakHeight / 2
            };
        });

        const topPoint = { x: 0, y: 0, z: this.heightFromGround + this.peakHeight };

        this.vertices = [...eaves, ...hexRing, topPoint];
        this.faces = this.buildFaces(eaves.length, hexRing.length);
    }

    buildFaces(numEaves, numHexRing) {
        const faces = [];
        const eaveStartIdx = 0;
        const hexRingStartIdx = numEaves;
        const peakIdx = numEaves + numHexRing;

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
            const hexIdx1 = hexRingStartIdx + i;
            const hexIdx2 = hexRingStartIdx + (i + 1) % numHexRing;

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
        // For isometric matching xyratio, we rotate so the foreshortening matches
        // atan(xyratio) gives us the angle from the ground plane
        const rotationRadians = Math.atan(xyratio);

        // Flatten vertices for PIXI geometry with rotation applied
        const vertexData = new Float32Array(this.vertices.length * 2);
        for (let i = 0; i < this.vertices.length; i++) {
            const v = this.vertices[i];
            
            // Apply rotation on X-axis (pitch the roof toward the viewer)
            const cosR = Math.cos(rotationRadians);
            const sinR = Math.sin(rotationRadians);
            const rotatedY = v.y * cosR + v.z * sinR;
            const rotatedZ = -v.y * sinR + v.z * cosR;
            
            // Project to screen space (isometric projection)
            vertexData[i * 2] = v.x * viewscale;
            vertexData[i * 2 + 1] = (rotatedY - rotatedZ) * viewscale * xyratio;
        }

        // Flatten indices from faces
        const indexData = new Uint16Array(this.faces.length * 3);
        for (let i = 0; i < this.faces.length; i++) {
            indexData[i * 3] = this.faces[i][0];
            indexData[i * 3 + 1] = this.faces[i][1];
            indexData[i * 3 + 2] = this.faces[i][2];
        }

        // Create UVs (simple default mapping)
        const uvData = new Float32Array(this.vertices.length * 2);
        for (let i = 0; i < this.vertices.length; i++) {
            uvData[i * 2] = (this.vertices[i].x + 7) / 14;     // Normalize to 0-1
            uvData[i * 2 + 1] = (this.vertices[i].y + 7) / 14;
        }

        const geometry = new PIXI.Geometry()
            .addAttribute('aVertexPosition', vertexData, 2)
            .addAttribute('aUvs', uvData, 2)
            .addIndex(indexData);

        const material = new PIXI.MeshMaterial(PIXI.Texture.WHITE);
        material.tint = 0xcc8844; // Roof color (tan/brown)

        this.pixiMesh = new PIXI.Mesh(geometry, material);
        this.pixiMesh.visible = false;

        return this.pixiMesh;
    }
}
