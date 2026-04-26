# 🧠 Architecture & API Reference

This document provides a technical overview of ShadowBot's core systems for developers who wish to contribute to the engine.

## 🏗️ Core Components

### 1. `silva.js` (The Entry Point)
Responsible for:
- Initializing the Baileys connection (`@whiskeysockets/baileys`).
- Managing authentication sessions.
- Handling connection lifecycle events (open, close, reconnect).
- Coordinating background services (Auto-Status, Anti-Delete, Anti-Call).
- Initializing the Express health-check server.

### 2. `handler.js` (The Brain)
Responsible for:
- Loading plugins from the `plugins/` directory.
- Parsing incoming messages.
- Checking user permissions (Owner, Admin, Public).
- Resolving `@lid` (modern WhatsApp ID) to standard numbers.
- Dispatching messages to the appropriate plugin.
- Enforcing global rate limits (`safeSend`).

### 3. `config.js` (State & Settings)
Centralized location for all environment variables and default values. It uses `dotenv` to load local `.env` files.

---

## 🛠️ Internal Libraries (`lib/`)

### `lib/theme.js`
Manages the loading of theme JSON files and provides the `getStr()` utility to fetch themed strings. It also includes the `fmt()` helper for string interpolation.

### `lib/statusManager.js`
Contains the logic for automatically viewing contact statuses, reacting to them with emojis, and providing auto-replies.

### `lib/dlmedia.js`
A collection of scraping utilities for downloading media from TikTok, Instagram, Facebook, and YouTube.

---

## 🛡️ Security & Rate Limiting

### `safeSend`
To prevent your WhatsApp account from being banned, always use `ctx.safeSend()` instead of raw Baileys calls. 
- **Rate Limit:** 30 messages per minute.
- **Jitter:** Random delay (100ms - 500ms) added to every message.
- **Queueing:** Messages are automatically queued if they exceed the rate limit.

### Permissions
Permissions are hierarchical:
- `owner`: Only the primary bot owner.
- `sudo`: Pre-authorized users in `sudo.json`.
- `admin`: Group administrators.
- `public`: Any user.
