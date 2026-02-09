// Mesh Deformation utilities for custom sprite transformations

/**
 * Creates a trapezoid mesh deformation for a falling tree
 * The bottom stays full width, the top narrows
 */
function applyTreeTaperMesh(item, coors) {
    if (!item.type || item.type !== "tree" || !item.rotation || item.rotation === 0) {
        // Remove mesh if tree is not falling
        if (item.taperMesh) {
            if (objectLayer && objectLayer.contains(item.taperMesh)) {
                objectLayer.removeChild(item.taperMesh);
            }
            item.taperMesh.destroy();
            item.taperMesh = null;
        }
        if (item.taperOutline) {
            if (objectLayer && objectLayer.contains(item.taperOutline)) {
                objectLayer.removeChild(item.taperOutline);
            }
            item.taperOutline.destroy();
            item.taperOutline = null;
        }
        if (item.pixiSprite) {
            item.pixiSprite.visible = true;
        }
        return;
    }

    const rotationProgress = Math.min(item.rotation / 90, 1); // 0 to 1 as tree falls
    let width = (item.width || 1) * viewscale;
    let height = (item.height || 1) * viewscale;
    
    // Only skew happens in the last 15 degrees (75-90° or -75 to -90°)
    let topWidth = width;
    const absRotation = Math.abs(item.rotation);
    if (absRotation >= 75) {
        const lateProgress = Math.min((absRotation - 75) / 15, 1); // 0 to 1 from 75-90°
        topWidth = width * (1 - lateProgress * (1 / 2)); // Shrink to 1/2 in final 15°
        height = height * (1 + lateProgress * 0.1); // Stretch to 110% in final 15°
    }
    
    // Set random fall direction when tree first starts burning
    if (!item.fallDirection) {
        item.fallDirection = Math.random() < 0.5 ? 'left' : 'right';
    }

    const rotRad = item.rotation * (Math.PI / 180);
    const cosR = Math.cos(rotRad);
    const sinR = Math.sin(rotRad);
    const rotatePoint = (x, y) => ({
        x: x * cosR - y * sinR,
        y: x * sinR + y * cosR
    });

    const bl = rotatePoint(-width / 2, 0);
    const br = rotatePoint(width / 2, 0);
    const tr = rotatePoint(topWidth / 2, -height);
    const tl = rotatePoint(-topWidth / 2, -height);

    // Cache trapezoid bounds in screen space for occlusion
    const minX = Math.min(bl.x, br.x, tr.x, tl.x) + coors.x;
    const maxX = Math.max(bl.x, br.x, tr.x, tl.x) + coors.x;
    const minY = Math.min(bl.y, br.y, tr.y, tl.y) + coors.y;
    const maxY = Math.max(bl.y, br.y, tr.y, tl.y) + coors.y;
    item.taperBounds = {
        left: minX,
        right: maxX,
        top: minY,
        bottom: maxY
    };

    // Create or update mesh
    if (!item.taperMesh) {
        try {
            
            // Vertices: 4 corners of trapezoid
            const vertices = new Float32Array([
                bl.x, bl.y,   // Bottom left
                br.x, br.y,   // Bottom right
                tr.x, tr.y,   // Top right
                tl.x, tl.y    // Top left
            ]);

            // UVs: map texture coordinates to trapezoid
            // Scale U based on width ratio at each row so texture stretches evenly
            const topRatio = topWidth / width;
            const uvs = new Float32Array([
                0, 1,                    // Bottom left
                1, 1,                    // Bottom right
                (1 + topRatio) / 2, 0,   // Top right (scaled inward)
                (1 - topRatio) / 2, 0    // Top left (scaled inward)
            ]);

            // Indices: two triangles - choose based on fall direction
            let indices;
            if (item.fallDirection === 'right') {
                indices = new Uint16Array([
                    1, 2, 3,  // Right triangle
                    0, 1, 3   // Left triangle
                ]);
            } else {
                indices = new Uint16Array([
                    0, 1, 2,  // Right triangle
                    0, 2, 3   // Left triangle
                ]);
            }

            const geometry = new PIXI.Geometry()
                .addAttribute('aVertexPosition', vertices, 2)
                .addAttribute('aUvs', uvs, 2)
                .addIndex(indices);


            // Use MeshMaterial to properly handle texture
            const material = new PIXI.MeshMaterial(item.pixiSprite.texture);
            
            item.taperMesh = new PIXI.Mesh(geometry, material);
            
            objectLayer.addChild(item.taperMesh);
        } catch (e) {
            console.error("Error creating tree taper mesh:", e);
            console.error("Stack:", e.stack);
            return;
        }
    } else {
        // Update mesh vertices for animation
        try {
            const vertices = item.taperMesh.geometry.getBuffer('aVertexPosition').data;
            vertices[0] = bl.x; // Bottom left X
            vertices[1] = bl.y; // Bottom left Y
            vertices[2] = br.x; // Bottom right X
            vertices[3] = br.y; // Bottom right Y
            vertices[4] = tr.x; // Top right X
            vertices[5] = tr.y; // Top right Y
            vertices[6] = tl.x; // Top left X
            vertices[7] = tl.y; // Top left Y
            item.taperMesh.geometry.getBuffer('aVertexPosition').update();
        } catch (e) {
            console.error("Error updating tree taper mesh:", e);
        }
    }

    // Ensure mesh is on the object layer (it gets cleared each frame)
    if (item.taperMesh && !item.taperMesh.parent) {
        objectLayer.addChild(item.taperMesh);
    }

    // // Create or update trapezoid outline for debugging
    // if (!item.taperOutline) {
    //     item.taperOutline = new PIXI.Graphics();
    //     objectLayer.addChild(item.taperOutline);
    // } else if (!item.taperOutline.parent) {
    //     objectLayer.addChild(item.taperOutline);
    // }

    // item.taperOutline.clear();
    // item.taperOutline.lineStyle(2, 0xff00ff, 0.9);
    // item.taperOutline.drawPolygon([
    //     bl.x, bl.y,
    //     br.x, br.y,
    //     tr.x, tr.y,
    //     tl.x, tl.y
    // ]);
    // item.taperOutline.closePath();

    // Position and rotation
    item.taperMesh.x = coors.x;
    item.taperMesh.y = coors.y;
    // item.taperOutline.x = coors.x;
    // item.taperOutline.y = coors.y;
    
    // Update texture and material properties
    if (item.pixiSprite.texture && item.taperMesh.material) {
        item.taperMesh.material.texture = item.pixiSprite.texture;
    }
    item.taperMesh.alpha = item.pixiSprite.alpha;
    item.taperMesh.tint = item.pixiSprite.tint;
    
    // Hide the sprite now that mesh is active
    if (item.pixiSprite) {
        item.pixiSprite.visible = false;
    }
    
    item.taperMesh.rotation = 0;
    // item.taperOutline.rotation = 0;
}

/**
 * Cleans up mesh deformations when tree is no longer in scene
 */
function cleanupTreeMesh(item) {
    if (item.taperMesh) {
        if (objectLayer && objectLayer.contains(item.taperMesh)) {
            objectLayer.removeChild(item.taperMesh);
        }
        item.taperMesh.geometry.destroy();
        item.taperMesh.destroy();
        item.taperMesh = null;
    }
    if (item.taperOutline) {
        if (objectLayer && objectLayer.contains(item.taperOutline)) {
            objectLayer.removeChild(item.taperOutline);
        }
        item.taperOutline.destroy();
        item.taperOutline = null;
    }
}




