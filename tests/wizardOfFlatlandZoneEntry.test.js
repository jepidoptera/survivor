const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.join(__dirname, "../public/wizard-of-flatland");

test("Wizard of Flatland announces and persists first entry into a new zone", () => {
    const main = fs.readFileSync(path.join(ROOT, "main.js"), "utf8");
    const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
    const styles = fs.readFileSync(path.join(ROOT, "styles.css"), "utf8");

    assert.match(html, /id="zoneAnnouncement" class="zoneAnnouncement"/);
    assert.match(styles, /\.levelUpAnnouncement,\s*\.zoneAnnouncement/);
    assert.match(styles, /\.levelUpAnnouncement\.active,\s*\.zoneAnnouncement\.active/);
    assert.match(main, /highestEnteredMazeZone: 0/);
    assert.match(main, /const enteredZone = getMazeZoneForWorldPoint\(state\.target\.x, state\.target\.y, getMazeOptions\(\)\)/);
    assert.match(main, /function getMazeZoneBoundaryPolygon\(zone, options\)/);
    assert.match(main, /boundaryDistance > getMazeZoneBoundaryApothem\(zone, options\)/);
    assert.match(main, /if \(enteredZone <= state\.highestEnteredMazeZone\) return;/);
    assert.match(main, /state\.highestEnteredMazeZone = enteredZone;\s*playZoneAnnouncement\(enteredZone\);/);
    assert.match(main, /zoneAnnouncement\.textContent = `Zone \$\{zone\}`/);
    assert.match(main, /const color = FLOOR_ZONE_COLORS\[Math\.min\(zone, FLOOR_ZONE_COLORS\.length - 1\)\]/);
    assert.match(main, /highestEnteredMazeZone: state\.highestEnteredMazeZone/);
    assert.match(main, /state\.highestEnteredMazeZone = snapshot\.highestEnteredMazeZone === undefined/);
});

test("Wizard of Flatland does not recruit hibernating enemies for turrets", () => {
    const main = fs.readFileSync(path.join(ROOT, "main.js"), "utf8");
    assert.match(main, /agent !== targetedAgent[\s\S]*agent\.activated === true[\s\S]*agent\.targetTurretId/);
    assert.match(main, /cannot recruit hibernating enemy/);
});
