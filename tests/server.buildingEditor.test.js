const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const {
    app,
    normalizeBuildingEditorBuildingName,
    resolveBuildingEditorSavePath
} = require("../server.js");

function listen(app) {
    return new Promise((resolve) => {
        const server = app.listen(0, () => resolve(server));
    });
}

function close(server) {
    return new Promise((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
    });
}

function minimalBuilding(name) {
    return {
        schema: "survivor-building-v1",
        id: "building-test",
        name,
        origin: { x: 0, y: 0 },
        defaults: {},
        floorFragments: [],
        wallSections: [],
        mountedWallObjects: [],
        roof: null
    };
}

test("building editor API saves, lists, and loads named building files", async () => {
    const name = `Test Building ${process.pid}`;
    const paths = resolveBuildingEditorSavePath(name);
    assert.ok(paths);
    fs.rmSync(paths.savePath, { force: true });

    const server = await listen(app);
    const baseUrl = `http://127.0.0.1:${server.address().port}`;

    try {
        const saveResponse = await fetch(`${baseUrl}/api/building-editor/buildings/${encodeURIComponent(name)}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(minimalBuilding(name))
        });
        const savePayload = await saveResponse.json();
        assert.equal(saveResponse.status, 200);
        assert.equal(savePayload.ok, true);
        assert.equal(savePayload.name, name);
        assert.ok(fs.existsSync(paths.savePath));

        const listResponse = await fetch(`${baseUrl}/api/building-editor/buildings`);
        const listPayload = await listResponse.json();
        assert.equal(listResponse.status, 200);
        assert.equal(listPayload.ok, true);
        assert.ok(listPayload.buildings.some((building) => building.name === name && building.file === `${name}.json`));

        const loadResponse = await fetch(`${baseUrl}/api/building-editor/buildings/${encodeURIComponent(name)}`);
        const loadPayload = await loadResponse.json();
        assert.equal(loadResponse.status, 200);
        assert.equal(loadPayload.ok, true);
        assert.deepEqual(loadPayload.data, minimalBuilding(name));
    } finally {
        await close(server);
        fs.rmSync(paths.savePath, { force: true });
    }
});

test("building editor building names reject path-like and extension-like names", () => {
    assert.equal(normalizeBuildingEditorBuildingName("../house"), "");
    assert.equal(normalizeBuildingEditorBuildingName("house.json"), "");
    assert.equal(normalizeBuildingEditorBuildingName("House 1"), "House 1");
});
