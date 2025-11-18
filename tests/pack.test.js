const { expect } = require('chai');
const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const JSZip = require('jszip');

const appId = 'com.baracuda.spixi.pong';
const appPath = path.join(__dirname, '..', 'apps', appId);
const outputsDir = path.join(__dirname, '..', 'tests-outputs');

function cleanup() {
    if (fs.existsSync(outputsDir)) {
        const items = fs.readdirSync(outputsDir);
        for (const item of items) {
            fs.unlinkSync(path.join(outputsDir, item));
        }
    } else {
        fs.mkdirSync(outputsDir, { recursive: true });
    }
}

describe('pack-app smoke tests', function() {
    this.timeout(20000);

    before(() => cleanup());

    // Start server for API endpoint tests
    let serverProc = null;
    before(function(done) {
        // start server
        serverProc = require('child_process').spawn('node', ['server.js'], { cwd: path.join(__dirname, '..') });
        serverProc.stdout.on('data', (d) => { /*console.log(d.toString());*/ });
        serverProc.stderr.on('data', (d) => { /*console.error(d.toString());*/ });

        const http = require('http');
            // Check if server already running
            http.get('http://localhost:8000/api/mqtt/status', (res) => {
                // server is already running
                if (res.statusCode === 200) return done();
            }).on('error', () => {
                // Not running -> start server
                serverProc = require('child_process').spawn('node', ['server.js'], { cwd: path.join(__dirname, '..') });
                serverProc.stdout.on('data', (d) => { /*console.log(d.toString());*/ });
                serverProc.stderr.on('data', (d) => { /*console.error(d.toString());*/ });

                // Wait for server to start
                const startTime = Date.now();
                (function waitFor() {
                    http.get('http://localhost:8000/api/mqtt/status', (res) => {
                        if (res.statusCode === 200) return done();
                        if (Date.now() - startTime > 10000) return done(new Error('Server did not start'));
                        setTimeout(waitFor, 200);
                    }).on('error', () => {
                        if (Date.now() - startTime > 10000) return done(new Error('Server did not start'));
                        setTimeout(waitFor, 200);
                    });
                })();
            });
    });

    it('packs the app and creates expected outputs', () => {
        const res = spawnSync('node', ['pack-app.js', appPath, outputsDir], { encoding: 'utf8' });
        // console.log('PACK OUTPUT:', res.stdout, res.stderr);
        if (res.error) throw res.error;
        expect(res.status).to.equal(0);

        // compute expected base name from appinfo
        const appInfoText = fs.readFileSync(path.join(appPath, 'appinfo.spixi'), 'utf8');
        const nameMatch = appInfoText.match(/^name\s*=\s*(.+)$/m);
        const baseName = (nameMatch && nameMatch[1] ? nameMatch[1].trim() : 'app').replace(/\s+/g, '-').toLowerCase();

        const zipPath = path.join(outputsDir, `${baseName}.zip`);
        const spixiPath = path.join(outputsDir, `${baseName}.spixi`);

        expect(fs.existsSync(zipPath)).to.be.true;
        expect(fs.existsSync(spixiPath)).to.be.true;

        // Validate zip contents
        const zbuf = fs.readFileSync(zipPath);
        return JSZip.loadAsync(zbuf).then(zip => {
            const entries = Object.keys(zip.files);
            expect(entries).to.include('app/index.html');
            expect(entries.some(e => e.startsWith('app/js/'))).to.be.true;

            // Recompute checksum and verify .spixi has matching checksum
            const recomputed = crypto.createHash('sha256').update(zbuf).digest('hex');
            const spixiText = fs.readFileSync(spixiPath, 'utf8');
            const csMatch = spixiText.match(/checksum\s*=\s*([0-9a-f]{64})/i);
            expect(csMatch).to.not.be.null;
            expect(csMatch[1]).to.equal(recomputed);
        });
    });

    it('packs the app using server /api/pack', function (done) {
        const http = require('http');
        const postData = JSON.stringify({ appId });
        const opts = {
            hostname: 'localhost',
            port: 8000,
            path: '/api/pack',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData)
            }
        };
        const req = http.request(opts, (res) => {
            let body = '';
            res.setEncoding('utf8');
            res.on('data', (chunk) => body += chunk);
            res.on('end', () => {
                try {
                    const result = JSON.parse(body);
                    expect(res.statusCode).to.equal(200);
                    expect(result.success).to.equal(true);
                    expect(result.zip).to.exist;
                    expect(result.spixi).to.exist;

                    // Validate that zip exists on disk
                    const zipFullPath = path.join(__dirname, '..', result.zip);
                    expect(fs.existsSync(zipFullPath)).to.be.true;
                    done();
                } catch (e) {
                    done(e);
                }
            });
        });
        req.on('error', done);
        req.write(postData);
        req.end();
    });

    after(() => {
        if (serverProc) serverProc.kill();
    });
});
