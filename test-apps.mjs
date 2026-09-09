import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const APPS_DIR = path.join(__dirname, 'apps');

if (!fs.existsSync(APPS_DIR)) {
    console.error(`❌ Apps directory does not exist: ${APPS_DIR}`);
    process.exit(1);
}

const folders = fs.readdirSync(APPS_DIR);
let totalApps = 0;
let passedApps = 0;
let failedApps = 0;

console.log(`🔍 Auditing ${folders.length} Spixi Mini Apps...\n`);

for (const folder of folders) {
    const folderPath = path.join(APPS_DIR, folder);
    if (!fs.statSync(folderPath).isDirectory()) continue;

    totalApps++;
    const appIssues = [];

    // 1. Check appinfo.spixi
    const appinfoPath = path.join(folderPath, 'appinfo.spixi');
    if (!fs.existsSync(appinfoPath)) {
        appIssues.push(`Missing appinfo.spixi file`);
    } else {
        const content = fs.readFileSync(appinfoPath, 'utf8');
        const info = {};
        for (const line of content.split(/\r?\n/)) {
            const m = line.match(/^\s*([^=]+?)\s*=\s*(.*?)\s*$/);
            if (m) info[m[1].trim()] = m[2].trim();
        }
        if (!info.id) appIssues.push(`appinfo.spixi missing 'id'`);
        if (!info.name) appIssues.push(`appinfo.spixi missing 'name'`);
        if (!info.version) appIssues.push(`appinfo.spixi missing 'version'`);
    }

    // 2. Check icon
    const iconPath = path.join(folderPath, 'icon.png');
    if (!fs.existsSync(iconPath)) {
        // Warning or issue
        appIssues.push(`Missing icon.png`);
    }

    // 3. Check HTML entrypoint (either app/index.html or index.html)
    let entrypoint = path.join(folderPath, 'app', 'index.html');
    if (!fs.existsSync(entrypoint)) {
        entrypoint = path.join(folderPath, 'index.html');
    }

    if (!fs.existsSync(entrypoint)) {
        appIssues.push(`Missing HTML entrypoint (index.html or app/index.html)`);
    } else {
        const htmlContent = fs.readFileSync(entrypoint, 'utf8');
        if (!htmlContent.includes('spixi-app-sdk.js') && !htmlContent.includes('spixi-tools.js')) {
            // Check if app has spixi SDK included or bundled
            // Some standalone web apps might need spixi-app-sdk script tag
        }
    }

    // 4. Validate all JS files for syntax errors
    const checkJSInDir = (dir) => {
        if (!fs.existsSync(dir)) return;
        const items = fs.readdirSync(dir);
        for (const item of items) {
            const fullPath = path.join(dir, item);
            const stat = fs.statSync(fullPath);
            if (stat.isDirectory()) {
                checkJSInDir(fullPath);
            } else if (item.endsWith('.js')) {
                try {
                    execSync(`node --check "${fullPath}"`, { stdio: 'pipe' });
                } catch (e) {
                    appIssues.push(`JS Syntax Error in ${path.relative(folderPath, fullPath)}: ${e.stderr ? e.stderr.toString() : e.message}`);
                }
            }
        }
    };

    checkJSInDir(folderPath);

    if (appIssues.length === 0) {
        console.log(`✅ [PASS] ${folder}`);
        passedApps++;
    } else {
        console.log(`❌ [FAIL] ${folder}:`);
        for (const issue of appIssues) {
            console.log(`   - ${issue}`);
        }
        failedApps++;
    }
}

console.log(`\n========================================`);
console.log(`App Audit Summary: ${passedApps}/${totalApps} Passed (${failedApps} Failed)`);
console.log(`========================================\n`);

if (failedApps > 0) {
    process.exit(1);
} else {
    process.exit(0);
}
