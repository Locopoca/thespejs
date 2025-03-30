# Voice Platform

A WebRTC-based voice streaming platform with room-based sessions (max 13 participants), chat, voice recording, studio setup, and an admin panel.

## Setup

1. **Server**:
   - Navigate to `server/`.
   - Run `npm install` to install dependencies.
   - Run `npm start` to start the server on port 3000.

2. **Client**:
   - Open `client/index.html` in a browser (or serve it with a static server like `npx serve`).

## Features
- Join rooms with a max of 13 participants.
- Real-time voice streaming via WebRTC.
- Chat window for text communication.
- Voice recording (saved as `.webm` files).
- Studio setup for microphone selection and gain control.
- Admin API for monitoring and managing rooms.

## Usage
- Enter a room ID and click "Join Room" to configure your studio setup.
- Save your settings to join the session.
- Use the chat window and recording buttons during the session.