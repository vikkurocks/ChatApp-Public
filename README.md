# ChatApp Public Upgrade v2

A lightweight, room-based real-time chat app for devices connected to the same Wi-Fi or local network. It includes chat, online-user presence, message replies/deletion, typing indicators, emoji, and peer-to-peer voice/video calls.

**Creator:** Vikas Choudhary & Shivam Chauhan

**Project type:** Node.js + Express + Socket.IO web application 

**Intended use:** Local network / personal testing


## Features

- Create or join a named chat room with a room password
- Choose a username; duplicate usernames in the same room are rejected
- Real-time messages, online-user list, and typing indicator
- Emoji picker, reply to a message, and delete your own messages
- Voice and video calls using WebRTC
- Mute/unmute microphone, enable/disable camera, accept/reject/end calls
- HTTPS server with a locally generated self-signed certificate to support camera/microphone access on LAN addresses
- Responsive layout for desktop and mobile screens

## Architecture

- `client/` -> static frontend for Netlify
- `server/` -> Node.js + Express + Socket.IO backend
- PostgreSQL -> persistent room/message data
- WebRTC -> peer-to-peer audio/video, with optional TURN support

## Deployment order

1. Create a managed PostgreSQL database.
2. Deploy `server/` to Render/Railway.
3. Set `DATABASE_URL`, `JWT_SECRET`, `CLIENT_ORIGIN`, `NODE_ENV=production`.
4. Copy the backend URL into `client/config.js`.
5. Deploy `client/` to Netlify.
6. Update `CLIENT_ORIGIN` on backend to the final Netlify URL and redeploy.
7. For reliable calls across mobile networks/NAT, configure a TURN provider using `TURN_URL`, `TURN_USERNAME`, `TURN_PASSWORD`.

## Important

Netlify is the frontend host. Do not try to run the persistent Socket.IO server on Netlify Functions.

The server automatically creates database tables on first boot.

The supplied project used a LAN self-signed HTTPS server. That has been removed from the public version; production TLS should be terminated by the backend host.

## Security

- bcrypt password hashing
- JWT-authenticated Socket.IO connection
- Helmet
- strict CORS origin
- rate limiting
- parameterized PostgreSQL queries
- message length limits
- ownership checks for deletion
- no credentials in frontend
- HTTPS expected in production
