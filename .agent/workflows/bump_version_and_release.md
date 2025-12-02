---
description: Bump app version, repack, and push changes
---

This workflow describes how to update an app's version, repack it, and push the changes to the repository.

1.  **Update Version in `appinfo.spixi`**
    -   Locate the `appinfo.spixi` file in the app's directory (e.g., `apps/<app_id>/appinfo.spixi`).
    -   Increment the `version` field (e.g., `version=1.0.1` -> `version=1.0.2`).

2.  **Repack the App**
    -   Run the packer script to generate the new `.zip` and `.spixi` files.
    -   Command: `node pack-app.js apps/<app_id> packed`
    -   Example: `node pack-app.js apps/com.baracuda.spixi.survivalmanual packed`

3.  **Commit and Push Changes**
    -   Stage the modified `appinfo.spixi` and the updated files in the `packed/` directory.
    -   Command: `git add apps/<app_id>/appinfo.spixi packed/<app_name>.spixi packed/<app_name>.zip`
    -   Commit with a descriptive message.
    -   Command: `git commit -m "Bump <AppName> version to <NewVersion>"`
    -   Push to the remote repository.
    -   Command: `git push`
