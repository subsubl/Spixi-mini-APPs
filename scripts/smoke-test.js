#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');

const appId = process.argv[2] || 'com.baracuda.spixi.pong';
const outputsDir = process.argv[3] || path.join(__dirname, '..', 'tests-outputs');

const appInfoPath = path.join(__dirname, '..', 'apps', appId, 'appinfo.spixi');
if (!fs.existsSync(appInfoPath)) {
    console.error(`Appinfo not found for ${appId} at ${appInfoPath}`);
    process.exit(2);
}

const appInfo = fs.readFileSync(appInfoPath, 'utf8');
const matchName = appInfo.match(/^name\s*=\s*(.+)$/m);
const baseName = (matchName && matchName[1] ? matchName[1] : 'app').trim().replace(/\s+/g, '-').toLowerCase();

const zipPath = path.join(outputsDir, `${baseName}.zip`);
const spixiPath = path.join(outputsDir, `${baseName}.spixi`);

console.log(`Checking outputs for: ${baseName}`);

let ok = true;
if (!fs.existsSync(outputsDir)) {
    console.error(`Outputs directory not found: ${outputsDir}`);
    process.exit(3);
}

if (!fs.existsSync(zipPath)) {
    console.error(`ZIP not found: ${zipPath}`);
    ok = false;
} else {
    console.log(`ZIP exists: ${zipPath}`);
}

if (!fs.existsSync(spixiPath)) {
    console.error(`.spixi not found: ${spixiPath}`);
    ok = false;
} else {
    console.log(`.spixi exists: ${spixiPath}`);
}

if (!ok) process.exit(4);

// Validate contents of zip
(async () => {
    try {
        const data = fs.readFileSync(zipPath);
        const zip = await JSZip.loadAsync(data);
        const entries = Object.keys(zip.files);
        console.log(`ZIP entries count: ${entries.length}`);
        // Expect at least app/index.html
        if (!entries.includes('app/index.html')) {
            console.error('ERROR: app/index.html missing from zip');
            process.exit(5);
        }
        console.log('app/index.html found in zip');
        // Expect an app JS file
        if (!entries.some(e => e.startsWith('app/js/'))) {
            console.error('ERROR: app/js/* missing from zip');
            process.exit(6);
        }
        console.log('app/js/* found in zip');

        // Validate .spixi contains checksum key
        const spixiText = fs.readFileSync(spixiPath, 'utf8');
        if (!/checksum\s*=\s*[0-9a-f]{64}/i.test(spixiText)) {
            console.error('ERROR: .spixi checksum missing or invalid');
            process.exit(6);
        }
        console.log('.spixi checksum looks valid');

        console.log('Smoke test: SUCCESS');
        process.exit(0);
    } catch (err) {
        console.error('Smoke test failed:', err);
        process.exit(10);
    }
})();
