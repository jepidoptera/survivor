const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const app = express();

// require ('firebase/database')
require('dotenv').config();

const port = process.env.PORT || 8080;
// const apiKey = process.env.APIKEY || "no_api_key";
const authtokens = {};
const players = [];

// Serve static files
app.use('/vendor', express.static(path.join(__dirname, 'node_modules')));
app.use(express.static(__dirname + '/public'));
app.use(bodyParser.urlencoded({ extended: false, limit: '25mb' }));
app.use(bodyParser.json({ limit: '25mb' }));
app.set('view engine', 'ejs');

app.get('/', (req, res) => {
    res.render('sectionworld')
})

app.get('/hunt', (req, res) => {
    res.render('hunt')
})

app.get('/sectiontesting', (req, res) => {
    res.render('sectiontesting')
})

app.get('/sectionworld', (req, res) => {
    res.render('sectionworld')
})

app.get('/twosectionprototype', (req, res) => {
    res.render('sectionworld')
})

const saveFilePath = path.join(__dirname, 'public', 'assets', 'saves', 'savefile.json');
const saveBackupsDir = path.join(__dirname, 'public', 'assets', 'saves', 'backups');
const sectionWorldSavesRoot = path.join(__dirname, 'public', 'assets', 'saves');

function normalizeSaveSlotName(rawSlot) {
    const slot = String(rawSlot === undefined || rawSlot === null ? '' : rawSlot).trim();
    if (!slot) return '';
    const safe = slot.replace(/[^a-zA-Z0-9_-]/g, '');
    return safe === slot ? safe : '';
}

function resolveSavePathsForSlot(slotName) {
    const normalizedSlot = normalizeSaveSlotName(slotName);
    if (!normalizedSlot || normalizedSlot === 'savefile') {
        return {
            normalizedSlot: '',
            savePath: saveFilePath,
            responsePath: '/assets/saves/savefile.json',
            backupPrefix: 'savefile'
        };
    }
    return {
        normalizedSlot,
        savePath: path.join(__dirname, 'public', 'assets', 'saves', `${normalizedSlot}.json`),
        responsePath: `/assets/saves/${encodeURIComponent(normalizedSlot)}.json`,
        backupPrefix: normalizedSlot
    };
}

function resolveSectionWorldDirForSlot(slotName) {
    const normalizedSlot = normalizeSaveSlotName(slotName);
    if (!normalizedSlot) return null;
    return path.join(sectionWorldSavesRoot, normalizedSlot);
}

function isValidSectionCoordRecord(section) {
    return !!(
        section &&
        typeof section === 'object' &&
        section.coord &&
        Number.isFinite(Number(section.coord.q)) &&
        Number.isFinite(Number(section.coord.r))
    );
}

function buildSectionFileName(section) {
    const q = Math.trunc(Number(section.coord.q) || 0);
    const r = Math.trunc(Number(section.coord.r) || 0);
    return `${q},${r}.json`;
}

function formatTimestampToSecond(date = new Date()) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    const hh = String(date.getHours()).padStart(2, '0');
    const mm = String(date.getMinutes()).padStart(2, '0');
    const ss = String(date.getSeconds()).padStart(2, '0');
    return `${y}-${m}-${d}_${hh}-${mm}-${ss}`;
}

function saveSectionWorldSlot(requestedSlot, payload) {
    const slotDir = resolveSectionWorldDirForSlot(requestedSlot);
    if (!slotDir) {
        return { status: 400, body: { ok: false, reason: 'invalid-slot' } };
    }
    const sections = Array.isArray(payload && payload.sections) ? payload.sections : null;
    if (!sections) {
        return { status: 400, body: { ok: false, reason: 'invalid-payload' } };
    }
    const manifest = (payload && payload.manifest && typeof payload.manifest === 'object')
        ? payload.manifest
        : {};
    const hasTriggers = Object.prototype.hasOwnProperty.call(payload || {}, 'triggers');
    const triggers = Array.isArray(payload && payload.triggers) ? payload.triggers : [];

    fs.mkdirSync(slotDir, { recursive: true });
    const manifestPath = path.join(slotDir, 'manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
    if (hasTriggers) {
        const triggersPath = path.join(slotDir, 'triggers.json');
        fs.writeFileSync(triggersPath, JSON.stringify(triggers, null, 2), 'utf8');
    }
    const validSections = sections.filter(isValidSectionCoordRecord);
    for (let i = 0; i < validSections.length; i++) {
        const section = validSections[i];
        const fileName = buildSectionFileName(section);
        const filePath = path.join(slotDir, fileName);
        fs.writeFileSync(filePath, JSON.stringify(section, null, 2), 'utf8');
    }

    return {
        status: 200,
        body: {
            ok: true,
            slot: requestedSlot,
            count: validSections.length,
            path: `/assets/saves/${encodeURIComponent(requestedSlot)}/`
        }
    };
}

function loadSectionWorldSlot(requestedSlot) {
    const slotDir = resolveSectionWorldDirForSlot(requestedSlot);
    if (!slotDir) {
        return { status: 400, body: { ok: false, reason: 'invalid-slot' } };
    }
    if (!fs.existsSync(slotDir)) {
        return { status: 404, body: { ok: false, reason: 'missing' } };
    }

    const sectionFiles = fs.readdirSync(slotDir, { withFileTypes: true })
        .filter(entry => entry.isFile() && entry.name.endsWith('.json') && entry.name !== 'manifest.json' && entry.name !== 'triggers.json')
        .map(entry => entry.name)
        .sort((a, b) => a.localeCompare(b));

    const manifestPath = path.join(slotDir, 'manifest.json');
    let manifest = {};
    if (fs.existsSync(manifestPath)) {
        const rawManifest = fs.readFileSync(manifestPath, 'utf8');
        const parsedManifest = JSON.parse(rawManifest);
        if (parsedManifest && typeof parsedManifest === 'object' && !Array.isArray(parsedManifest)) {
            manifest = parsedManifest;
        }
    }

    const triggersPath = path.join(slotDir, 'triggers.json');
    let triggers = [];
    if (fs.existsSync(triggersPath)) {
        const rawTriggers = fs.readFileSync(triggersPath, 'utf8');
        const parsedTriggers = JSON.parse(rawTriggers);
        if (Array.isArray(parsedTriggers)) {
            triggers = parsedTriggers;
        }
    } else if (Array.isArray(manifest.triggers)) {
        triggers = manifest.triggers;
    }

    const sections = [];
    for (let i = 0; i < sectionFiles.length; i++) {
        const fileName = sectionFiles[i];
        const filePath = path.join(slotDir, fileName);
        const raw = fs.readFileSync(filePath, 'utf8');
        const parsed = JSON.parse(raw);
        if (isValidSectionCoordRecord(parsed)) {
            sections.push(parsed);
        }
    }

    return {
        status: 200,
        body: {
            ok: true,
            slot: requestedSlot,
            manifest,
            triggers,
            sections
        }
    };
}

app.post('/api/savefile', (req, res) => {
    try {
        const payload = req.body;
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
            return res.status(400).json({ ok: false, reason: 'invalid-payload' });
        }
        const requestedSlot = (typeof req.query.slot === 'string') ? req.query.slot : '';
        const paths = resolveSavePathsForSlot(requestedSlot);
        if (requestedSlot && !paths.normalizedSlot) {
            return res.status(400).json({ ok: false, reason: 'invalid-slot' });
        }

        fs.mkdirSync(path.dirname(paths.savePath), { recursive: true });
        if (fs.existsSync(paths.savePath)) {
            fs.mkdirSync(saveBackupsDir, { recursive: true });
            const timestamp = formatTimestampToSecond(new Date());
            let backupName = `${paths.backupPrefix}_${timestamp}.json`;
            let backupPath = path.join(saveBackupsDir, backupName);
            let suffix = 1;
            while (fs.existsSync(backupPath)) {
                backupName = `${paths.backupPrefix}_${timestamp}_${suffix}.json`;
                backupPath = path.join(saveBackupsDir, backupName);
                suffix++;
            }
            fs.copyFileSync(paths.savePath, backupPath);
        }
        fs.writeFileSync(paths.savePath, JSON.stringify(payload, null, 2), 'utf8');
        return res.json({ ok: true, path: paths.responsePath, slot: paths.normalizedSlot || 'savefile' });
    } catch (e) {
        console.error('Failed to write save file:', e);
        return res.status(500).json({ ok: false, reason: 'write-failed' });
    }
});

app.get('/api/savefile', (req, res) => {
    try {
        const requestedFile = (typeof req.query.file === 'string') ? req.query.file.trim() : '';
        const requestedSlot = (typeof req.query.slot === 'string') ? req.query.slot : '';
        const slotPaths = resolveSavePathsForSlot(requestedSlot);
        if (requestedSlot && !slotPaths.normalizedSlot) {
            return res.status(400).json({ ok: false, reason: 'invalid-slot' });
        }
        let resolvedPath = slotPaths.savePath;
        let responsePath = slotPaths.responsePath;

        if (requestedFile) {
            if (requestedFile === 'savefile.json') {
                resolvedPath = saveFilePath;
                responsePath = '/assets/saves/savefile.json';
            } else {
                const safeName = path.basename(requestedFile);
                const isValidName = (
                    safeName === requestedFile &&
                    safeName.length > 0 &&
                    safeName.endsWith('.json') &&
                    !safeName.includes('/') &&
                    !safeName.includes('\\')
                );
                if (!isValidName) {
                    return res.status(400).json({ ok: false, reason: 'invalid-file' });
                }
                resolvedPath = path.join(saveBackupsDir, safeName);
                responsePath = `/assets/saves/backups/${encodeURIComponent(safeName)}`;
            }
        }

        if (!fs.existsSync(resolvedPath)) {
            return res.status(404).json({ ok: false, reason: 'missing' });
        }
        const raw = fs.readFileSync(resolvedPath, 'utf8');
        const parsed = JSON.parse(raw);
        return res.json({ ok: true, data: parsed, path: responsePath });
    } catch (e) {
        console.error('Failed to read save file:', e);
        return res.status(500).json({ ok: false, reason: 'read-failed' });
    }
});

app.post('/api/sectionworld', (req, res) => {
    try {
        const requestedSlot = (typeof req.query.slot === 'string') ? req.query.slot : '';
        const result = saveSectionWorldSlot(requestedSlot, req.body);
        return res.status(result.status).json(result.body);
    } catch (e) {
        console.error('Failed to write section world:', e);
        return res.status(500).json({ ok: false, reason: 'write-failed' });
    }
});

app.get('/api/sectionworld', (req, res) => {
    try {
        const requestedSlot = (typeof req.query.slot === 'string') ? req.query.slot : '';
        const result = loadSectionWorldSlot(requestedSlot);
        return res.status(result.status).json(result.body);
    } catch (e) {
        console.error('Failed to read section world:', e);
        return res.status(500).json({ ok: false, reason: 'read-failed' });
    }
});

app.get('/api/flooring', (req, res) => {
    try {
        const flooringDir = path.join(__dirname, 'public', 'assets', 'images', 'flooring');
        if (!fs.existsSync(flooringDir)) {
            return res.json({ ok: true, files: [] });
        }
        const files = fs.readdirSync(flooringDir, { withFileTypes: true })
            .filter(entry => entry.isFile())
            .map(entry => entry.name)
            .filter(name => /\.(png|jpg|jpeg|webp|gif)$/i.test(name))
            .sort((a, b) => a.localeCompare(b))
            .map(name => `/assets/images/flooring/${name}`);
        return res.json({ ok: true, files });
    } catch (e) {
        console.error('Failed to read flooring directory:', e);
        return res.status(500).json({ ok: false, reason: 'read-failed' });
    }
});

app.get('/api/placeables', (req, res) => {
    try {
        const imageRoot = path.join(__dirname, 'public', 'assets', 'images');
        const categories = ['flowers', 'windows', 'doors', 'furniture', 'signs', 'roof', 'walls'];
        const categoryDirByKey = {
            flowers: 'flowers',
            windows: 'windows',
            doors: 'doors',
            furniture: 'furniture',
            signs: 'signs',
            roof: 'roofs',
            walls: 'walls'
        };
        const out = {};
        categories.forEach(category => {
            const dirName = categoryDirByKey[category] || category;
            const dir = path.join(imageRoot, dirName);
            if (!fs.existsSync(dir)) {
                out[category] = [];
                return;
            }
            const files = fs.readdirSync(dir, { withFileTypes: true })
                .filter(entry => entry.isFile())
                .map(entry => entry.name)
                .filter(name => /\.(png|jpg|jpeg|webp|gif)$/i.test(name))
                .sort((a, b) => a.localeCompare(b))
                .map(name => `/assets/images/${dirName}/${encodeURIComponent(name)}`);
            out[category] = files;
        });
        return res.json({ ok: true, categories: out });
    } catch (e) {
        console.error('Failed to read placeables directories:', e);
        return res.status(500).json({ ok: false, reason: 'read-failed' });
    }
});

if (require.main === module) {
    app.listen(port, () => {
        console.log('Listening on: http://localhost:' + port);
    });
}

module.exports = {
    app,
    loadSectionWorldSlot,
    normalizeSaveSlotName,
    resolveSectionWorldDirForSlot,
    saveSectionWorldSlot
};

function generateToken() {
    let chars = "abcdefghijklmnopqrstuvwxyz1234567890";
    // string some random numbers and letters together
    return [1, 2, 3, 4, 5, 6, 7].map(n => chars[Math.floor(Math.random() * chars.length)]).join('');
}

function validateAuth(username, authtoken, res) {
    if (authtoken !== authtokens[username]) {
        console.log(`got auth token ${authtoken} vs expected ${authtokens[username]}`);
        res.render('logout');
        return false;
    }
    else return true;
}
