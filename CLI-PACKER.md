# Spixi Mini App Packer - CLI Tool

Command-line tool for packing Spixi Mini Apps. This Node.js script automates the process of creating `.zip`, `.spixi`, and `.png` files for your Mini Apps.

## Installation

1. Clone this repository or navigate to the project directory
2. Install dependencies:

```bash
npm install
```

## Usage

### Basic Syntax

```bash
node pack-app.js <app-path> [output-dir]
```

### Parameters

- **`app-path`** (required) - Path to your app folder containing `appinfo.spixi` and `app/` directory
- **`output-dir`** (optional) - Directory where packed files will be saved. If not specified, files are saved in the app directory

### Examples

#### Pack app to its own directory

```bash
node pack-app.js ./apps/com.ixilabs.spixi.pong
```

#### Pack app to specific output directory

```bash
node pack-app.js ./apps/com.ixilabs.spixi.pong ./packed
```

#### Pack with absolute paths

```bash
node pack-app.js C:\Apps\MySpixiApp C:\Output
```

#### Pack multiple apps (Windows PowerShell)

```powershell
Get-ChildItem ./apps -Directory | ForEach-Object { node pack-app.js $_.FullName ./packed }
```

#### Pack multiple apps (bash/Linux/macOS)

```bash
for app in ./apps/*; do node pack-app.js "$app" ./packed; done
```

## Output Files

The packer generates three files:

1. **`<appname>.zip`** - Compressed archive containing:
   - `appinfo.spixi`
   - `app/` directory with all contents
   - `icon.png` (if present)

2. **`<appname>.spixi`** - Metadata file with:
   - All fields from original `appinfo.spixi`
   - `contentUrl` - URL where the `.zip` will be hosted
   - `image` - URL where the icon will be hosted
   - `checksum` - SHA-256 hash of the `.zip` file
   - `contentSize` - Size of the `.zip` file in bytes

3. **`<appname>.png`** - App icon (copied from `icon.png` in app folder)

## Required App Structure

Your app folder must contain:

```text
yourapp/
├── appinfo.spixi        # REQUIRED - App metadata
├── icon.png             # Recommended - 512x512 app icon
└── app/                 # REQUIRED
    └── index.html       # REQUIRED - Entry point
```

### Minimal appinfo.spixi

```text
caVersion = 0
id = com.example.myapp
publisher = Your Name
name = My App
version = 1.0.0
capabilities = singleUser
```

## Features

✅ Validates required files before packing  
✅ Automatically calculates SHA-256 checksum  
✅ Compresses files with optimal settings  
✅ Auto-generates URLs based on app name  
✅ Reports file sizes in human-readable format  
✅ Preserves all metadata from `appinfo.spixi`  
✅ Supports relative and absolute paths  

## Error Handling

The script will exit with an error if:

- App path doesn't exist
- `appinfo.spixi` is missing
- `app/index.html` is missing
- Path is not a directory

## Publishing Your App

After packing:

1. Upload all three files (`.zip`, `.spixi`, `.png`) to your web host
2. Update the URLs in the `.spixi` file if they differ from auto-generated names
3. Host the `.spixi` file at a publicly accessible URL
4. Share the `.spixi` URL with users or submit to Spixi app directory

## Troubleshooting

### "JSZip module not found"

```bash
npm install jszip
```

### "Missing required file: app/index.html"

Ensure your app has the correct structure with `app/` folder containing `index.html`

### "Path is not a directory"

Make sure you're pointing to the app folder, not a file

## Integration with CI/CD

Example GitHub Actions workflow:

```yaml
name: Pack Spixi App
on: [push]
jobs:
  pack:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - run: npm install
      - run: node pack-app.js ./apps/my-app ./dist
      - uses: actions/upload-artifact@v3
        with:
          name: packed-app
          path: ./dist/*
```

## Comparison with Web Packer

| Feature | CLI Tool | Web Packer |
|---------|----------|------------|
| Installation | Requires Node.js | No installation |
| Batch processing | ✅ Yes | ❌ No |
| CI/CD integration | ✅ Yes | ❌ No |
| Automation | ✅ Full | ⚠️ Manual |
| Browser required | ❌ No | ✅ Yes (Firefox for local) |
| Speed | ⚡ Fast | 🐌 Slower |

## License

MIT License - see [LICENSE](./LICENSE) file for details.

---

**IXI Labs © 2025**
