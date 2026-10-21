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

## Tech stack

- **Node.js** — JavaScript runtime
- **Express** — serves the client files
- **Socket.IO** — real-time chat events and call signalling
- **WebRTC** — peer-to-peer audio/video media
- **Self-signed TLS certificate** — generated locally for HTTPS
- **HTML, CSS, JavaScript** — browser interface

## Requirements

- Node.js installed on the computer that will run the server
- Devices connected to the same Wi-Fi/local network
- A modern browser with camera and microphone permissions for calls

## Run locally

1. Extract the project ZIP.
2. Open a terminal in the `ChatApp-Public` folder (the folder containing `package.json`).
3. Install dependencies:

   ```bash
   npm install
   ```

4. Start the server:

   ```bash
   npm start
   ```

5. The terminal prints HTTPS addresses. On the host computer, open `https://localhost:3000`. On another device on the same network, open the network address printed by the server, for example `https://192.168.1.10:3000`.
6. On each device, the browser may show a warning because the certificate is self-signed. This is expected for this local setup. Proceed only if you trust the computer and network hosting this app.
7. Allow camera and microphone access when prompted.
8. Enter a username, room name, and room password. Other participants must use the same room name and password.

On Windows, `npm install` and `npm start` work in PowerShell or Command Prompt when Node.js is on PATH. You can also use `npm.cmd install` and `npm.cmd start`.

## How rooms and calls work

- The first participant to create a room establishes its password for that room while it exists.
- Chat messages and room membership are kept in server memory, not in a database. Room history is lost when the server restarts, and an empty room is eventually removed.
- WebRTC carries audio/video directly between participants when the network allows it. Socket.IO exchanges call setup/signalling messages; it is not a cloud media relay.
- Both devices should be able to reach the server over the local network. Some Wi-Fi networks, firewalls, or router settings can block device-to-device connections.

## Troubleshooting calls

1. Use the `https://` URL printed by the server, not `http://`.
2. Open the URL directly and handle the self-signed certificate warning only if you trust the local server.
3. Check the browser's site permissions and allow camera and microphone.
4. Check Windows/macOS privacy settings and close other apps that may be using the camera or microphone.
5. Confirm both devices are on the same network and can reach the host computer.
6. Keep the terminal running while the app is in use; stopping the process stops the server.

## Security and deployment notes

- This project is designed for a trusted local network, not as a hardened public production service.
- The HTTPS certificate is self-signed and is not trusted automatically by browsers.
- Room passwords are hashed in server memory, but rooms, messages, and users are not persisted to a database.
- Do not expose this server directly to the public internet without a security review, proper certificate management, stronger access controls, abuse protections, and production deployment configuration.
- The current app does not provide durable message storage, account registration, or a recovery flow for forgotten room passwords.
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

## Important

Netlify is the frontend host. Do not try to run the persistent Socket.IO server on Netlify Functions.

The server automatically creates database tables on first boot.

The supplied project used a LAN self-signed HTTPS server. That has been removed from the public version; production TLS should be terminated by the backend host.

## Security



## Project structure

```text
ChatApp/
├── server.js          # HTTPS server, room state, chat events, WebRTC signalling
├── package.json       # Project metadata and dependencies
├── README.md          # Project documentation
├── how to use.txt     # Quick-start notes
└── public/
    ├── index.html     # Login/join screen and chat interface
    ├── style.css      # Responsive interface styling
    └── app.js         # Browser-side chat and call logic
```

## License

No license has been specified. Contact the project creator before redistributing or reusing this project beyond personal evaluation.
