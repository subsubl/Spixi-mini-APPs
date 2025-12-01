---
description: Pack the Spixi mini app, commit changes, and push to main
---

1. Pack the DOOM app
// turbo
node pack-app.js apps/com.baracuda.spixi.doom packed

2. Stage all changes
// turbo
git add .

3. Commit changes
git commit -m "Fix corrupted index.html and enable joystick pointer events"

4. Push to main
// turbo
git push origin main