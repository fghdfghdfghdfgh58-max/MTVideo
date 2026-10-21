# MTVideo — self-hosted

No dependencies. Needs **Node.js 22.13 or newer** and a server with a **persistent disk** (a VPS).
Static hosts like Netlify/Vercel/GitHub Pages will NOT work: this has a backend.

## Run it
    node server.js            # http://localhost:3000

Everything is stored in `./data` (SQLite database + uploaded videos). Back this folder up.

## Put it on your domain (HTTPS is required for camera/live and secure login)
1. Rent a VPS (any Linux box), point your domain's **A record** to its IP.
2. Install Node 22+ and copy this folder up.
3. Install Caddy (automatic HTTPS) with this Caddyfile:

       yourdomain.com {
           request_body { max_size 600MB }
           reverse_proxy localhost:3000
       }

4. Start the app and keep it running:

       COOKIE_SECURE=1 TRUST_PROXY=1 node server.js
   (use `pm2` or a systemd service so it restarts)

## Settings (environment variables)
PORT (3000) · DATA_DIR (./data) · MAX_UPLOAD_MB (500) · COOKIE_SECURE=1 (use behind HTTPS) · TRUST_PROXY=1 (behind Caddy/nginx)

## What it has / doesn't have
Has: email + password accounts (hashed with scrypt), 2 channels per email (enforced on the server), uploads, shorts (3 min max), likes/dislikes, comments, subscriptions, live chat.
Doesn't have yet: email verification, password reset (needs an email service), video transcoding/thumbnails, moderation tools, real live video to viewers (needs WebRTC/RTMP), CDN. The 3-minute short limit trusts the browser-reported length.
