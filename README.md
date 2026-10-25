# ChatApp Public Upgrade v2

A room-based real-time chat application built with Node.js, Express,
Socket.IO, and a browser-based frontend. The app supports
password-protected rooms, real-time messaging, online presence, and
peer-to-peer voice/video calls.

**Creators:** Vikas Choudhary & Shivam Chauhan\
**Project type:** Node.js + Express + Socket.IO web application

> **Deployment note:** This README describes the project behavior
> documented for this version. Before deploying, verify that
> configuration, routes, and scripts match the files in your current
> project.

## Features

-   Create or join a named room protected by a room password
-   Choose a username; duplicate usernames in the same room are rejected
-   Real-time messages, online-user list, and typing indicators
-   Emoji picker, replies, and deletion of your own messages
-   Voice and video calls using WebRTC
-   Mute/unmute microphone, enable/disable camera, accept/reject/end
    calls
-   Responsive layout for desktop and mobile screens
-   HTTPS support through the deployment host in production

## Technology stack

-   **Node.js** --- JavaScript runtime
-   **Express** --- HTTP server and API routes
-   **Socket.IO** --- real-time messaging, presence, and call signaling
-   **WebRTC** --- peer-to-peer audio/video media
-   **HTML, CSS, JavaScript** --- browser interface
-   **PostgreSQL** --- database, if configured by the current server
    version

## Requirements

-   Node.js and npm installed on the computer running the server
-   A PostgreSQL database if the current server configuration requires
    `DATABASE_URL`
-   A modern browser
-   Camera and microphone permissions for voice/video calls

## Run locally

1.  Extract the project ZIP.

2.  Open PowerShell or Command Prompt in the project root---the folder
    containing `package.json`.

3.  Install dependencies:

    ``` bash
    npm install
    ```

    On Windows PowerShell, if the `npm` command is blocked by script
    execution policy, use:

    ``` powershell
    npm.cmd install
    ```

4.  Configure the environment variables required by the current
    `server.js`. For the public version, these may include:

    -   `JWT_SECRET` --- a long, random secret used for authentication
    -   `DATABASE_URL` --- PostgreSQL connection string
    -   `CLIENT_ORIGIN` --- the exact origin of the deployed frontend,
        such as your Vercel or Netlify URL

    Use the variable names and formats expected by the current server
    code. Do not commit real secrets or database credentials to Git.

5.  Start the server:

    ``` bash
    npm start
    ```

    On Windows, you can also use:

    ``` powershell
    npm.cmd start
    ```

6.  Open the local URL printed by the server, or the frontend URL
    configured for your environment.

7.  Create or join a room with a username, room name, and room password.

8.  Allow camera and microphone access when prompted if you want to use
    calls.

## Important configuration notes

-   Run commands from the directory containing the relevant
    `package.json`. Running `npm start` from `C:\Users\<your-user>` or
    another unrelated directory will fail if that directory has no
    `package.json`.
-   If the project has separate `client` and `server` folders, follow
    the scripts in the root and subfolder `package.json` files rather
    than assuming the older `public/` layout described below.
-   A deployed frontend cannot use `localhost` as the backend URL for
    other users. Set the frontend's server URL to the reachable backend
    URL.
-   The backend must allow the deployed frontend origin through its CORS
    configuration.

## Rooms, messages, and database behavior

The exact persistence behavior depends on the current server
implementation:

-   In the earlier in-memory version, room state and message history
    were lost when the server restarted.
-   In a database-backed version, persistence depends on the tables and
    queries implemented in `server.js`.
-   Check the current server code and PostgreSQL schema before assuming
    that messages or room history are permanently stored.

Room-password behavior also depends on the server implementation. Use
the same room name and password when joining an existing room.

## Voice and video calls

Calls use WebRTC for audio/video and Socket.IO for signaling. Media
generally travels directly between participants, so successful call
setup depends on browser permissions and network connectivity.

If calls do not connect, check the following:

1.  Open the app over HTTPS in production. Camera and microphone access
    generally require a secure context.
2.  Allow camera and microphone permissions in the browser.
3.  Check operating-system privacy settings and close other apps using
    the camera or microphone.
4.  Confirm both users can reach the backend and that the Socket.IO
    connection is established.
5.  Test across the actual networks and devices you intend to support.
    Some routers, firewalls, and carrier networks require a correctly
    configured STUN/TURN setup for reliable WebRTC connectivity.

## Deployment and security

-   The frontend can be hosted on a static hosting provider such as
    Vercel or Netlify.
-   The Express/Socket.IO backend needs a host that supports a
    persistent Node.js process and WebSocket connections; static hosting
    alone is not sufficient for the persistent chat server.
-   In production, use HTTPS provided by the hosting platform or a
    properly configured TLS termination layer.
-   Keep `JWT_SECRET` and database credentials on the server. Never
    place them in frontend JavaScript or commit them to the repository.
-   Configure CORS to allow only the intended frontend origin(s).
-   Review authentication, room access, rate limiting, message
    validation, deletion ownership checks, and database queries before
    making the app publicly available.
-   Do not expose a development server with a self-signed certificate as
    a public production service.
-   If PostgreSQL is enabled, verify that the server creates or migrates
    the required tables and that the deployed database is reachable.

## Project structure

The repository layout can differ between versions. The earlier layout
was:

``` text
ChatApp/
├── server.js
├── package.json
├── README.md
├── how to use.txt
└── public/
    ├── index.html
    ├── style.css
    └── app.js
```

If your current ZIP instead contains separate `client/` and `server/`
folders, treat the actual folder structure and `package.json` scripts in
that ZIP as authoritative.

## License

No license has been specified. Contact the project creators before
redistributing or reusing this project beyond personal evaluation.
