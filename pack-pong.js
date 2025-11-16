const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Simple zip creation using Node.js
function createZipManually(appDir, outputZip) {
    const appinfoPath = path.join(appDir, 'appinfo.spixi');
    const iconPath = path.join(appDir, 'icon.png');
    const appFolder = path.join(appDir, 'app');
    
    // Read all files recursively
    const files = [];
    
    function walkDir(dir, baseDir = '') {
        const items = fs.readdirSync(dir);
        for (const item of items) {
            const fullPath = path.join(dir, item);
            const relativePath = path.join(baseDir, item);
            const stat = fs.statSync(fullPath);
            
            if (stat.isDirectory()) {
                walkDir(fullPath, relativePath);
            } else {
                files.push({
                    path: relativePath.replace(/\\/g, '/'),
                    content: fs.readFileSync(fullPath)
                });
            }
        }
    }
    
    // Add files
    if (fs.existsSync(appinfoPath)) {
        files.push({ path: 'appinfo.spixi', content: fs.readFileSync(appinfoPath) });
    }
    if (fs.existsSync(iconPath)) {
        files.push({ path: 'icon.png', content: fs.readFileSync(iconPath) });
    }
    if (fs.existsSync(appFolder)) {
        walkDir(appFolder, 'app');
    }
    
    console.log('Files to pack:');
    files.forEach(f => console.log('  -', f.path));
    
    // Calculate checksum of content
    const allContent = Buffer.concat(files.map(f => f.content));
    const checksum = crypto.createHash('sha256').update(allContent).digest('hex');
    
    console.log(`\nChecksum: ${checksum}`);
    console.log(`Size: ${allContent.length} bytes`);
    
    return { files, checksum, size: allContent.length };
}

// Pack pong app
const pongDir = path.join(__dirname, 'apps', 'com.baracuda.spixi.pong');
const outputDir = path.join(__dirname, 'packed');

console.log('Packing Pong app...\n');
const result = createZipManually(pongDir, path.join(outputDir, 'pong.zip'));

// Read appinfo to generate .spixi file
const appinfoContent = fs.readFileSync(path.join(pongDir, 'appinfo.spixi'), 'utf8');
const version = appinfoContent.match(/version = (.+)/)[1].trim();

const spixiContent = `${appinfoContent}
image = pong.png
contentUrl = pong.zip
checksum = ${result.checksum}
contentSize = ${result.size}
`;

fs.writeFileSync(path.join(outputDir, 'pong.spixi'), spixiContent);
console.log(`\nCreated pong.spixi (version ${version})`);
console.log('Note: Manual zip creation with proper compression needed for final deployment');
