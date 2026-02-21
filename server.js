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
app.use(express.static(__dirname + '/public'));
app.use(bodyParser.urlencoded({ extended: false, limit: '25mb' }));
app.use(bodyParser.json({ limit: '25mb' }));
app.set('view engine', 'ejs');

// Serve app
console.log('Listening on: http://localhost:' + port);

app.get('/', (req, res) => {
    res.render('hunt')
})

const saveFilePath = path.join(__dirname, 'public', 'assets', 'saves', 'savefile.json');
const saveBackupsDir = path.join(__dirname, 'public', 'assets', 'saves', 'backups');

function formatTimestampToSecond(date = new Date()) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    const hh = String(date.getHours()).padStart(2, '0');
    const mm = String(date.getMinutes()).padStart(2, '0');
    const ss = String(date.getSeconds()).padStart(2, '0');
    return `${y}-${m}-${d}_${hh}-${mm}-${ss}`;
}

app.post('/api/savefile', (req, res) => {
    try {
        const payload = req.body;
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
            return res.status(400).json({ ok: false, reason: 'invalid-payload' });
        }

        fs.mkdirSync(path.dirname(saveFilePath), { recursive: true });
        if (fs.existsSync(saveFilePath)) {
            fs.mkdirSync(saveBackupsDir, { recursive: true });
            const timestamp = formatTimestampToSecond(new Date());
            let backupName = `savefile_${timestamp}.json`;
            let backupPath = path.join(saveBackupsDir, backupName);
            let suffix = 1;
            while (fs.existsSync(backupPath)) {
                backupName = `savefile_${timestamp}_${suffix}.json`;
                backupPath = path.join(saveBackupsDir, backupName);
                suffix++;
            }
            fs.copyFileSync(saveFilePath, backupPath);
        }
        fs.writeFileSync(saveFilePath, JSON.stringify(payload, null, 2), 'utf8');
        return res.json({ ok: true, path: '/assets/saves/savefile.json' });
    } catch (e) {
        console.error('Failed to write save file:', e);
        return res.status(500).json({ ok: false, reason: 'write-failed' });
    }
});

app.get('/api/savefile', (req, res) => {
    try {
        const requestedFile = (typeof req.query.file === 'string') ? req.query.file.trim() : '';
        let resolvedPath = saveFilePath;
        let responsePath = '/assets/saves/savefile.json';

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
        const categories = ['flowers', 'windows', 'doors', 'furniture', 'signs'];
        const out = {};
        categories.forEach(category => {
            const dir = path.join(imageRoot, category);
            if (!fs.existsSync(dir)) {
                out[category] = [];
                return;
            }
            const files = fs.readdirSync(dir, { withFileTypes: true })
                .filter(entry => entry.isFile())
                .map(entry => entry.name)
                .filter(name => /\.(png|jpg|jpeg|webp|gif)$/i.test(name))
                .sort((a, b) => a.localeCompare(b))
                .map(name => `/assets/images/${category}/${encodeURIComponent(name)}`);
            out[category] = files;
        });
        return res.json({ ok: true, categories: out });
    } catch (e) {
        console.error('Failed to read placeables directories:', e);
        return res.status(500).json({ ok: false, reason: 'read-failed' });
    }
});

app.listen(port);

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
