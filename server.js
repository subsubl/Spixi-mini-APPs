const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const mqtt = require('mqtt');

const MAIN_PORT = 8000;
const DEV_PORT = 8081;

// ============================================
// MQTT BROKER MANAGER - Optional MQTT support
// ============================================
class MqttBrokerManager {
    constructor() {
        this.client = null;
        this.isConnected = false;
        this.config = {
            host: '192.168.88.250',
            port: 1883,
            clientId: 'spixi-dev-client-' + Math.random().toString(36).substr(2, 9)
        };
        this.subscriptions = new Map();
        this.messageHandlers = [];
    }

    setConfig(config) {
        if (config.host) this.config.host = config.host;
        if (config.port) this.config.port = config.port;
        if (config.clientId) this.config.clientId = config.clientId;
    }

    async connect() {
        return new Promise((resolve, reject) => {
            try {
                const brokerUrl = `mqtt://${this.config.host}:${this.config.port}`;
                console.log(`[MQTT] Connecting to ${brokerUrl} with client ID: ${this.config.clientId}`);

                this.client = mqtt.connect(brokerUrl, {
                    clientId: this.config.clientId,
                    reconnectPeriod: 5000,
                    connectTimeout: 4000
                });

                this.client.on('connect', () => {
                    console.log('[MQTT] ✅ Connected to broker');
                    this.isConnected = true;
                    resolve();
                });

                this.client.on('error', (err) => {
                    console.error('[MQTT] ❌ Connection error:', err.message);
                    this.isConnected = false;
                    reject(err);
                });

                this.client.on('message', (topic, message) => {
                    console.log(`[MQTT] Message on ${topic}:`, message.toString());
                    this.messageHandlers.forEach(handler => {
                        try {
                            handler(topic, message.toString());
                        } catch (e) {
                            console.error('[MQTT] Handler error:', e.message);
                        }
                    });
                });

                // Set a timeout to handle connection failures
                setTimeout(() => {
                    if (!this.isConnected) {
                        reject(new Error('MQTT connection timeout'));
                    }
                }, 5000);

            } catch (error) {
                console.error('[MQTT] Connection failed:', error.message);
                this.isConnected = false;
                reject(error);
            }
        });
    }

    async disconnect() {
        return new Promise((resolve) => {
            if (this.client) {
                this.client.end(false, () => {
                    console.log('[MQTT] ✅ Disconnected from broker');
                    this.isConnected = false;
                    resolve();
                });
            } else {
                resolve();
            }
        });
    }

    subscribe(topic) {
        if (this.client && this.isConnected) {
            this.client.subscribe(topic, (err) => {
                if (err) {
                    console.error(`[MQTT] Subscribe error for ${topic}:`, err.message);
                } else {
                    console.log(`[MQTT] ✅ Subscribed to ${topic}`);
                    this.subscriptions.set(topic, true);
                }
            });
        }
    }

    unsubscribe(topic) {
        if (this.client && this.isConnected) {
            this.client.unsubscribe(topic, (err) => {
                if (err) {
                    console.error(`[MQTT] Unsubscribe error for ${topic}:`, err.message);
                } else {
                    console.log(`[MQTT] ✅ Unsubscribed from ${topic}`);
                    this.subscriptions.delete(topic);
                }
            });
        }
    }

    publish(topic, message, options = {}) {
        if (this.client && this.isConnected) {
            this.client.publish(topic, message, options, (err) => {
                if (err) {
                    console.error(`[MQTT] Publish error for ${topic}:`, err.message);
                } else {
                    console.log(`[MQTT] ✅ Published to ${topic}`);
                }
            });
        }
    }

    onMessage(handler) {
        this.messageHandlers.push(handler);
    }

    getStatus() {
        return {
            isConnected: this.isConnected,
            config: this.config,
            subscriptions: Array.from(this.subscriptions.keys())
        };
    }
}

const mqttBroker = new MqttBrokerManager();

// ============================================
// MAIN SERVER - Serves test environment UI + MQTT API
// ============================================
const mainServer = http.createServer((req, res) => {
    // Handle MQTT API calls
    if (req.url.startsWith('/api/mqtt')) {
        handleMqttApi(req, res);
        return;
    }

    // Remove query string from URL
    let urlPath = req.url.split('?')[0];
    
    // Set default path
    let filePath = urlPath === '/' ? '/index.html' : urlPath;
    
    // If requesting an app resource, serve from apps directory
    if (filePath.includes('/apps/')) {
        filePath = path.join(__dirname, '..', filePath);
    } else {
        filePath = path.join(__dirname, filePath);
    }
    
    console.log(`[${new Date().toISOString()}] MAIN GET ${req.url} -> ${filePath}`);

    // Get file extension
    const ext = path.extname(filePath);

    // MIME types
    const mimeTypes = {
        '.html': 'text/html',
        '.js': 'text/javascript',
        '.css': 'text/css',
        '.json': 'application/json',
        '.png': 'image/png',
        '.jpg': 'image/jpg',
        '.jpeg': 'image/jpeg',
        '.gif': 'image/gif',
        '.svg': 'image/svg+xml',
        '.webp': 'image/webp',
        '.woff': 'font/woff',
        '.woff2': 'font/woff2',
        '.ttf': 'font/ttf',
        '.eot': 'application/vnd.ms-fontobject'
    };

    const contentType = mimeTypes[ext] || 'application/octet-stream';

    // Read and serve the file
    fs.readFile(filePath, (err, content) => {
        if (err) {
            if (err.code === 'ENOENT') {
                res.writeHead(404, { 'Content-Type': 'text/html' });
                res.end('<h1>404 - File Not Found</h1>', 'utf-8');
            } else {
                res.writeHead(500);
                res.end('Sorry, check with the site admin for error: ' + err, 'utf-8');
            }
        } else {
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content);
        }
    });
});

// ============================================
// MQTT API Handler
// ============================================
function handleMqttApi(req, res) {
    const urlPath = req.url;
    
    res.setHeader('Content-Type', 'application/json');

    // GET /api/mqtt/status - Get MQTT connection status
    if (req.method === 'GET' && urlPath === '/api/mqtt/status') {
        const status = mqttBroker.getStatus();
        res.writeHead(200);
        res.end(JSON.stringify(status));
        return;
    }

    // POST /api/mqtt/connect - Connect to broker
    if (req.method === 'POST' && urlPath === '/api/mqtt/connect') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', async () => {
            try {
                const data = JSON.parse(body);
                if (data.host || data.port || data.clientId) {
                    mqttBroker.setConfig(data);
                }
                await mqttBroker.connect();
                res.writeHead(200);
                res.end(JSON.stringify({ success: true, message: 'Connected to MQTT broker' }));
            } catch (error) {
                res.writeHead(400);
                res.end(JSON.stringify({ success: false, error: error.message }));
            }
        });
        return;
    }

    // POST /api/mqtt/disconnect - Disconnect from broker
    if (req.method === 'POST' && urlPath === '/api/mqtt/disconnect') {
        mqttBroker.disconnect().then(() => {
            res.writeHead(200);
            res.end(JSON.stringify({ success: true, message: 'Disconnected from MQTT broker' }));
        });
        return;
    }

    // POST /api/mqtt/subscribe - Subscribe to topic
    if (req.method === 'POST' && urlPath === '/api/mqtt/subscribe') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            try {
                const data = JSON.parse(body);
                const topic = data.topic;
                if (!topic) {
                    res.writeHead(400);
                    res.end(JSON.stringify({ success: false, error: 'Missing topic' }));
                    return;
                }
                mqttBroker.subscribe(topic);
                res.writeHead(200);
                res.end(JSON.stringify({ success: true, message: `Subscribed to ${topic}` }));
            } catch (error) {
                res.writeHead(400);
                res.end(JSON.stringify({ success: false, error: error.message }));
            }
        });
        return;
    }

    // POST /api/mqtt/unsubscribe - Unsubscribe from topic
    if (req.method === 'POST' && urlPath === '/api/mqtt/unsubscribe') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            try {
                const data = JSON.parse(body);
                const topic = data.topic;
                if (!topic) {
                    res.writeHead(400);
                    res.end(JSON.stringify({ success: false, error: 'Missing topic' }));
                    return;
                }
                mqttBroker.unsubscribe(topic);
                res.writeHead(200);
                res.end(JSON.stringify({ success: true, message: `Unsubscribed from ${topic}` }));
            } catch (error) {
                res.writeHead(400);
                res.end(JSON.stringify({ success: false, error: error.message }));
            }
        });
        return;
    }

    // POST /api/mqtt/publish - Publish message
    if (req.method === 'POST' && urlPath === '/api/mqtt/publish') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            try {
                const data = JSON.parse(body);
                const { topic, message } = data;
                if (!topic || !message) {
                    res.writeHead(400);
                    res.end(JSON.stringify({ success: false, error: 'Missing topic or message' }));
                    return;
                }
                mqttBroker.publish(topic, message);
                res.writeHead(200);
                res.end(JSON.stringify({ success: true, message: `Published to ${topic}` }));
            } catch (error) {
                res.writeHead(400);
                res.end(JSON.stringify({ success: false, error: error.message }));
            }
        });
        return;
    }

    // 404 for unknown API endpoints
    res.writeHead(404);
    res.end(JSON.stringify({ error: 'Not found' }));
}


// ============================================
// DEV SERVER - Serves mini app HTML and resources
// ============================================
const devServer = http.createServer((req, res) => {
    const parsedUrl = url.parse(req.url, true);
    const pathname = parsedUrl.pathname;
    const query = parsedUrl.query;
    const appId = query.app;

    console.log(`[${new Date().toISOString()}] DEV GET ${req.url}`);

    // If requesting root with ?app parameter, serve app's index.html
    if (pathname === '/' && appId) {
        const appsDir = path.join(__dirname, '..', 'apps');
        const appPath = path.join(appsDir, appId, 'app', 'index.html');

        console.log(`[${new Date().toISOString()}] DEV Serving app ${appId} from: ${appPath}`);

        // Check if file exists
        if (!fs.existsSync(appPath)) {
            res.writeHead(404, { 'Content-Type': 'text/html' });
            res.end(`<h1>404 - App Not Found</h1><p>App: ${appId}</p>`, 'utf-8');
            return;
        }

        // Read and serve the app's index.html
        fs.readFile(appPath, 'utf-8', (err, content) => {
            if (err) {
                res.writeHead(500, { 'Content-Type': 'text/html' });
                res.end(`<h1>500 - Server Error</h1><p>${err.message}</p>`, 'utf-8');
                return;
            }

            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(content, 'utf-8');
        });
        return;
    }

    // If requesting a resource path with ?app parameter, serve from app directory
    if (appId && pathname && pathname !== '/') {
        const appsDir = path.join(__dirname, '..', 'apps');
        const resourcePath = path.join(appsDir, appId, 'app', pathname);

        console.log(`[${new Date().toISOString()}] DEV Serving resource: ${resourcePath}`);

        // Security check - prevent path traversal
        const appDir = path.join(appsDir, appId, 'app');
        if (!resourcePath.startsWith(appDir)) {
            res.writeHead(403, { 'Content-Type': 'text/html' });
            res.end('<h1>403 - Forbidden</h1>', 'utf-8');
            return;
        }

        // Get file extension
        const ext = path.extname(resourcePath);
        
        // MIME types
        const mimeTypes = {
            '.html': 'text/html',
            '.js': 'text/javascript',
            '.css': 'text/css',
            '.json': 'application/json',
            '.png': 'image/png',
            '.jpg': 'image/jpg',
            '.jpeg': 'image/jpeg',
            '.gif': 'image/gif',
            '.svg': 'image/svg+xml',
            '.webp': 'image/webp',
            '.woff': 'font/woff',
            '.woff2': 'font/woff2',
            '.ttf': 'font/ttf',
            '.eot': 'application/vnd.ms-fontobject'
        };

        const contentType = mimeTypes[ext] || 'application/octet-stream';

        // Read and serve the file
        fs.readFile(resourcePath, (err, content) => {
            if (err) {
                if (err.code === 'ENOENT') {
                    res.writeHead(404, { 'Content-Type': 'text/html' });
                    res.end(`<h1>404 - File Not Found</h1>`, 'utf-8');
                } else {
                    res.writeHead(500, { 'Content-Type': 'text/html' });
                    res.end(`<h1>500 - Server Error</h1><p>${err.message}</p>`, 'utf-8');
                }
                return;
            }

            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content);
        });
        return;
    }

    // No app parameter
    res.writeHead(400, { 'Content-Type': 'text/html' });
    res.end('<h1>400 - Bad Request</h1><p>Missing "app" query parameter</p>', 'utf-8');
});

// Start servers
mainServer.listen(MAIN_PORT, () => {
    console.log(`✅ Main Server (Test Environment) running at http://localhost:${MAIN_PORT}`);
});

devServer.listen(DEV_PORT, () => {
    console.log(`✅ Dev Server (Mini Apps) running at http://localhost:${DEV_PORT}`);
});

console.log('Press Ctrl+C to stop the servers');
