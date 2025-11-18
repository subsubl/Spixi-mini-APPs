# Mini Apps Test Environment

Local testing environment for Spixi Mini Apps. Run the packed apps directly in your browser without needing the full Spixi client.

## Quick Start

1. **Open the test environment:**
   ```
   Open index.html in your web browser
   ```

2. **View an app:**
   - Click the **View App** button to open any app directly
   - The app will load in a new browser tab
   - Some SDK features will be simulated, others will be limited

3. **Extract an app:**
   - Click the **Extract** button to download the `.zip` file
   - Extract it to inspect the app's structure and files

## Apps Available

- **🏓 Pong** - Real-time multiplayer game (2 players)
- **⭕ Tic Tac Toe** - Classic turn-based game
- **🎨 Whiteboard** - Collaborative drawing
- **📹 Video Test** - Media device testing
- **🚪 Gate Control** - IoT device control
- **🔐 Auth Test** - Authentication & QR codes
- **🧪 Mini Apps Test** - SDK functionality testing
- **🤖 AI Assistant** - AI-powered tools

## Features

✅ One-click app launching  
✅ Direct browser testing  
✅ App extraction for inspection  
✅ Responsive design  
✅ Real-time status  

## Limitations

- **Network Communication**: Multi-player features require Spixi client context
- **Storage API**: Limited to browser localStorage simulation
- **Native Features**: Camera, microphone, biometrics require Spixi integration
- **App-to-App Communication**: Not available in browser mode

## Full Testing

For complete app testing with networking and all SDK features:

1. **Package the app:**
   ```bash
   node pack-app.js ./apps/com.baracuda.spixi.pong ./packed
   ```

2. **Deploy to Spixi:**
   - Upload `.spixi`, `.zip`, and `.png` files to your hosting
   - Add to Spixi app store or test via local deployment

3. **Test with Spixi Client:**
   - Download Spixi Messenger
   - Add mini app from app store
   - Create session with another user to test multiplayer features

## Development

To test locally during development:

1. Edit app files directly in `apps/yourapp/app/`
2. Open the app in your browser: `apps/yourapp/app/index.html`
3. Use browser DevTools (F12) to debug
4. Check Console tab for SDK debug messages

## Browser Compatibility

- **Chrome/Edge**: Full support
- **Firefox**: Full support
- **Safari**: Full support
- **Mobile Browsers**: Full support (touch controls work)

## Tips

- **F12**: Open DevTools to see console messages and debug
- **Network Tab**: Monitor mock SDK calls
- **Mobile**: Test on actual device or use Chrome DevTools device emulation
- **Storage**: Browser localStorage is used to simulate app storage

## File Structure

```
test-environment/
├── index.html          # This test hub
├── README.md           # Documentation
└── [apps accessible via relative paths]
```

---

Created for local testing of Spixi Mini Apps SDK
