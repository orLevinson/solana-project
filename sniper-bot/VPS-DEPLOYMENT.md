# Production VPS Deployment Guide

This guide will walk you through deploying your Sniper Bot and web Dashboard to a Linux VPS (like DigitalOcean, Hetzner, AWS, or Vultr) for 24/7 automated running.

## Prerequisites
1. **A Linux VPS** (Ubuntu 22.04 or 24.04 is highly recommended).
2. **A Domain Name** (e.g. `yourdomain.com`), with DNS "A Records" pointing to your VPS IP address.
3. Your code is pushed to a private GitHub repository or ready to transfer via SFTP/scp.

## Recommended VPS Providers
For a Solana Sniper Bot running Node.js, you need decent CPU performance and good network connectivity. Here are the best low-cost options:

1. **Hetzner (Best Value)**: Their Cloud Servers (cpx11 or cpx21) cost roughly **$4 - $6/month**. They offer the absolute best CPU performance per dollar. Choose the Ashburn (USA) or Falkenstein (Germany) datacenters.
2. **DigitalOcean (Most Popular)**: The **$6/month** Basic Droplet (1GB RAM) is perfectly fine for running this Docker stack. Very beginner friendly.
3. **Vultr (Great Network)**: Their **$5 - $6/month** Cloud Compute instances are excellent for crypto bots due to their wide variety of global datacenters.

*When creating a server on any of these platforms, always select **Ubuntu 24.04 LTS (or 22.04 LTS)** as the operating system.*

---

## Step 1: Initial VPS Setup
SSH into your VPS and run the following commands to update the system and install Docker & Docker Compose:

```bash
# Update package lists
sudo apt update && sudo apt upgrade -y

# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# Install Docker Compose plugin
sudo apt install docker-compose-plugin -y
```

## Step 2: Transfer Your Code
You can clone your git repo directly to the server:
```bash
git clone https://github.com/yourusername/sniper-bot.git
cd sniper-bot
```
*(If you don't use Git, you can use a program like FileZilla or `scp` to copy the `sniper-bot` folder from your desktop to the VPS).*

## Step 3: Configure Environment
You need to re-create your `.env` secrets on the server since they are safely ignored by git.

```bash
nano .env
```
Paste your private variables, save (`Ctrl+O`, `Enter`) and exit (`Ctrl+X`).
```env
# Helius RPC & WebSocket
HELIUS_RPC_URL=https://mainnet.helius-rpc.com/?api-key=YOUR-KEY
HELIUS_WS_URL=wss://mainnet.helius-rpc.com/?api-key=YOUR-KEY
JITO_BLOCK_ENGINE_URL=https://mainnet.block-engine.jito.wtf
WALLET_PRIVATE_KEY=YOUR_BASE58_KEY

# Keep false until you want it trading real SOL
DRY_RUN=true 
```

## Step 4: Configure the Domain (Caddy proxy)
Open the `Caddyfile`:
```bash
nano Caddyfile
```
Change `yourdomain.com` to your actual domain name. 
```text
bot.yourdomain.com {
    reverse_proxy dashboard:80
}
```
*(Caddy will read this and automatically provision free SSL certificates from Let's Encrypt for HTTPS).*

---

## Step 5: Launching your 24/7 Bot
Because we containerized everything with Docker, starting your bot, API, and dashboard is a single command. 

From inside the `sniper-bot` folder, run:
```bash
sudo docker compose up -d --build
```
> The `-d` flag means "detached" mode. Docker will build the images and run them silently in the background 24/7, even after you close your SSH terminal!

## Monitoring and Maintenance
Your bot is now trading and your dashboard is live at `https://bot.yourdomain.com`.

**How to view live logs:**
```bash
sudo docker compose logs -f bot
```

**How to stop everything gracefully:**
```bash
sudo docker compose down
```

**How to update code if you change something:**
```bash
git pull
sudo docker compose up -d --build
```
