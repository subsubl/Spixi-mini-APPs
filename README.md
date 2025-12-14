# cPanel Deployment Setup

This project is configured to automatically deploy to your cPanel server when you push to the `main` branch.

## 1. Create a GitHub Repository
1. Initialize a git repo here and push it to GitHub.
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   # git remote add origin <your-repo-url>
   # git push -u origin main
   ```

## 2. Configure GitHub Secrets
To allow GitHub to access your cPanel FTP, you must add these secrets:

1. Go to your repository on GitHub.
2. Navigate to **Settings** > **Secrets and variables** > **Actions**.
3. Click **New repository secret** and add the following:

| Secret Name | Value Example | Description |
|-------------|---------------|-------------|
| `FTP_SERVER` | `ftp.yourdomain.com` | Your cPanel domain or Server IP |
| `FTP_USERNAME` | `youruser@yourdomain.com` | Your cPanel/FTP username |
| `FTP_PASSWORD` | `your_secure_password` | Your cPanel/FTP password |

## 3. Deploy
Once the secrets are set, any new push to the `main` branch will trigger the deployment. You can check the progress in the **Actions** tab of your repository.
