#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { promisify } = require('util');

// Check if JSZip is available
let JSZip;
try {
    JSZip = require('jszip');
} catch (e) {
    console.error('Error: JSZip module not found. Install it with: npm install jszip');
    process.exit(1);
}

const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);
const readdir = promisify(fs.readdir);
const stat = promisify(fs.stat);

async function getAllFiles(dirPath, arrayOfFiles = [], basePath = '') {
    const files = await readdir(dirPath);

    for (const file of files) {
        const fullPath = path.join(dirPath, file);
        const fileStat = await stat(fullPath);

        if (fileStat.isDirectory()) {
            const relativePath = path.join(basePath, file);
            arrayOfFiles = await getAllFiles(fullPath, arrayOfFiles, relativePath);
        } else {
            const relativePath = basePath ? path.join(basePath, file) : file;
            arrayOfFiles.push({
                relativePath: relativePath.replace(/\\/g, '/'),
                fullPath: fullPath
            });
        }
    }

    return arrayOfFiles;
}

function parseAppInfo(text) {
    const lines = text.split(/\r?\n/);
    const info = {};
    for (const line of lines) {
        const match = line.match(/^\s*([^=]+?)\s*=\s*(.*?)\s*$/);
        if (match) {
            info[match[1]] = match[2];
        }
    }
    return info;
}

function computeSHA256(buffer) {
    return crypto.createHash('sha256').update(buffer).digest('hex');
}

function bytesToNice(n) {
    if (!Number.isFinite(n)) return '-';
    const units = ['B', 'KB', 'MB', 'GB'];
    let i = 0;
    let v = Number(n);
    while (v >= 1024 && i < units.length - 1) {
        v /= 1024;
        i++;
    }
    return `${v.toFixed(v < 10 && i > 0 ? 2 : 0)} ${units[i]}`;
}

async function packApp(appPath, outputDir = null) {
    // Resolve absolute path
    const absoluteAppPath = path.resolve(appPath);

    // Check if path exists
    if (!fs.existsSync(absoluteAppPath)) {
        console.error(`Error: Path not found: ${absoluteAppPath}`);
        process.exit(1);
    }

    // Check if it's a directory
    const pathStat = await stat(absoluteAppPath);
    if (!pathStat.isDirectory()) {
        console.error(`Error: Path is not a directory: ${absoluteAppPath}`);
        process.exit(1);
    }

    console.log(`📦 Packing app from: ${absoluteAppPath}`);

    // Get all files
    const allFiles = await getAllFiles(absoluteAppPath);
    console.log(`   Found ${allFiles.length} files`);

    // Check for required files
    const appInfoFile = allFiles.find(f => f.relativePath.toLowerCase() === 'appinfo.spixi');
    const indexHtmlFile = allFiles.find(f => f.relativePath.toLowerCase() === 'app/index.html');

    if (!appInfoFile) {
        console.error('Error: Missing required file: appinfo.spixi');
        process.exit(1);
    }

    if (!indexHtmlFile) {
        console.error('Error: Missing required file: app/index.html');
        process.exit(1);
    }

    // Parse appinfo.spixi
    const appInfoText = await readFile(appInfoFile.fullPath, 'utf8');
    const appInfo = parseAppInfo(appInfoText);

    console.log(`   App: ${appInfo.name || 'Unknown'}`);
    console.log(`   Version: ${appInfo.version || 'Unknown'}`);
    console.log(`   ID: ${appInfo.id || 'Unknown'}`);

    // Create ZIP
    const zip = new JSZip();

    for (const file of allFiles) {
        const relativePath = file.relativePath;
        
        // Only include app/, appinfo.spixi, and icon.png
        if (!relativePath.startsWith('app/') && 
            !relativePath.startsWith('appinfo.spixi') && 
            !relativePath.startsWith('icon.png')) {
            continue;
        }

        const fileContent = await readFile(file.fullPath);
        zip.file(relativePath, fileContent);
    }

    console.log('   Creating ZIP archive...');
    const zipBuffer = await zip.generateAsync({
        type: 'nodebuffer',
        compression: 'DEFLATE',
        compressionOptions: { level: 6 }
    });

    const contentSize = zipBuffer.length;
    const checksum = computeSHA256(zipBuffer);

    console.log(`   ZIP size: ${bytesToNice(contentSize)}`);
    console.log(`   Checksum: ${checksum}`);

    // Auto-fill image and contentUrl based on 'name'
    const baseName = (appInfo.name || 'app').trim().replace(/\s+/g, '-').toLowerCase();
    const imageUrl = appInfo.image || `${baseName}.png`;
    const contentUrl = appInfo.contentUrl || `${baseName}.zip`;

    // Create .spixi file content
    const spixiContent = `caVersion = ${appInfo.caVersion || '0'}
id = ${appInfo.id || ''}
publisher = ${appInfo.publisher || ''}
name = ${appInfo.name || ''}
version = ${appInfo.version || ''}
capabilities = ${appInfo.capabilities || ''}
image = ${imageUrl}
minUsers = ${appInfo.minUsers || ''}
maxUsers = ${appInfo.maxUsers || ''}
protocols = ${appInfo.protocols || ''}
contentUrl = ${contentUrl}
checksum = ${checksum}
contentSize = ${contentSize}`;

    // Determine output directory
    const outputPath = outputDir ? path.resolve(outputDir) : absoluteAppPath;

    // Ensure output directory exists
    if (!fs.existsSync(outputPath)) {
        fs.mkdirSync(outputPath, { recursive: true });
    }

    // Write files
    const zipPath = path.join(outputPath, `${baseName}.zip`);
    const spixiPath = path.join(outputPath, `${baseName}.spixi`);
    const iconPath = path.join(outputPath, `${baseName}.png`);

    await writeFile(zipPath, zipBuffer);
    await writeFile(spixiPath, spixiContent);

    console.log(`   ✓ Saved: ${path.basename(zipPath)}`);
    console.log(`   ✓ Saved: ${path.basename(spixiPath)}`);

    // Copy icon.png if it exists
    const iconFile = allFiles.find(f => f.relativePath.toLowerCase() === 'icon.png');
    if (iconFile) {
        const iconContent = await readFile(iconFile.fullPath);
        await writeFile(iconPath, iconContent);
        console.log(`   ✓ Saved: ${path.basename(iconPath)}`);
    } else {
        console.log(`   ⚠ Warning: icon.png not found - skipping`);
    }

    console.log(`\n✅ Packing complete!`);
    console.log(`   Output directory: ${outputPath}`);
}

// CLI handling
const args = process.argv.slice(2);

if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    console.log(`
Spixi Mini App Packer - Command Line Tool

Usage:
  node pack-app.js <app-path> [output-dir]

Arguments:
  app-path     Path to the app folder containing appinfo.spixi and app/
  output-dir   Optional: Directory to save packed files (default: app-path)

Examples:
  node pack-app.js ./apps/com.ixilabs.spixi.pong
  node pack-app.js ./apps/com.ixilabs.spixi.pong ./packed
  node pack-app.js C:\\Apps\\MySpixiApp C:\\Output

Required files in app folder:
  - appinfo.spixi
  - app/index.html
  - icon.png (recommended)

Output:
  - <appname>.zip      (ZIP archive with app contents)
  - <appname>.spixi    (Metadata file with checksum)
  - <appname>.png      (App icon, if available)
`);
    process.exit(0);
}

const appPath = args[0];
const outputDir = args[1] || null;

packApp(appPath, outputDir).catch(err => {
    console.error(`\n❌ Error: ${err.message}`);
    process.exit(1);
});
