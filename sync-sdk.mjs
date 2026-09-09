import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SDK_SRC_DIR = path.join(__dirname, '../Spixi-Mini-Apps/mini-apps-sdk');
const APPS_DIR = path.join(__dirname, 'apps');

const sdkFiles = ['spixi-app-sdk.js', 'spixi-tools.js'];

const folders = fs.readdirSync(APPS_DIR);

for (const folder of folders) {
    const folderPath = path.join(APPS_DIR, folder);
    if (!fs.statSync(folderPath).isDirectory()) continue;

    let jsDir = path.join(folderPath, 'app', 'js');
    if (!fs.existsSync(path.join(folderPath, 'app'))) {
        jsDir = path.join(folderPath, 'js');
    }

    if (!fs.existsSync(jsDir)) {
        fs.mkdirSync(jsDir, { recursive: true });
    }

    for (const sdkFile of sdkFiles) {
        const srcPath = path.join(SDK_SRC_DIR, sdkFile);
        const destPath = path.join(jsDir, sdkFile);
        if (fs.existsSync(srcPath)) {
            fs.copyFileSync(srcPath, destPath);
            console.log(`Synced ${sdkFile} -> ${path.relative(__dirname, destPath)}`);
        }
    }
}
console.log('✅ SDK Sync Complete!');
