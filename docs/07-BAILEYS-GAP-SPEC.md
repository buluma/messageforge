# Baileys Gap Spec

This document defines the remaining non-group Baileys surfaces that MessageForge should expose or support. The goal is to cover the documented Baileys API surface intentionally, while keeping the implementation aligned with the current command/plugin architecture.

## Scope

In scope:

- Privacy controls
- Chat-level management actions
- Pairing-code login support
- Broadcast list inspection
- Profile-picture removal
- Explicit message edit action
- Optional direct exposure of selected Baileys primitives
- Event-handling cleanup where it improves stability

Out of scope:

- Group moderation features already implemented
- Rewriting the entire plugin architecture
- Removing the current QR/session login path
- Replacing the current persistence layer unless needed for auth state

## Current Baseline

The bot already supports:

- Session-based auth loading
- QR login fallback
- Presence updates and presence subscription
- Read receipts
- Status view/react/reply automation
- Profile name and bio updates
- Block/unblock and blocklist access
- Profile picture lookup

The gaps below are the remaining non-group surfaces that should be added or formalized.

## Required Features

### 1. Privacy Commands

Expose a command group for privacy settings using Baileys privacy APIs.

Required actions:

- `last seen`
- `online`
- `profile picture`
- `status`
- `read receipts`
- `groups add`
- `disappearing mode`

Expected behavior:

- Commands must be owner-only unless there is a clear reason to broaden access.
- Each action should report the current setting or the result of the update.
- Invalid values should be rejected with a clear usage message.

### 2. Chat Management Commands

Expose chat-level actions that are not group-specific.

Required actions:

- archive / unarchive
- mute / unmute private chats
- mark read / unread
- star / unstar
- optional chat clear / delete history if supported cleanly

Expected behavior:

- Actions should target the current chat by default.
- Commands should support a quoted chat/message context where useful.
- Commands must not leak into group-only logic.

### 3. Pairing-Code Login

Add a boot-time or command-driven pairing-code login flow.

Expected behavior:

- The existing QR/session path remains available.
- Pairing-code flow should only run when explicitly requested or configured.
- The flow should not overwrite valid auth state unless the user opts in.
- Implementation must remain compatible with the current `session/` and Postgres auth handling.

### 4. Broadcast List Support

Expose a way to inspect broadcast lists.

Expected behavior:

- Fetch and display broadcast list metadata.
- If the Baileys API returns a list object, present a readable summary.
- Keep the command admin-only or owner-only unless there is a strong reason not to.

### 5. Profile-Picture Removal

Add an explicit action to remove the bot or user profile photo.

Expected behavior:

- A clear command or admin action should remove the current profile picture.
- This should be separate from updating profile picture and profile bio/name.

### 6. Explicit Message Edit

Add a command that edits a message through the Baileys edit payload.

Expected behavior:

- Support editing a quoted message or a message identified by ID.
- Keep this separate from the receive-side edited-message detection already in place.
- Only allow editing when Baileys and the chat context permit it.

### 7. Selected Primitive Exposure

Decide whether to expose these Baileys primitives directly as commands or admin tools:

- `onWhatsApp`
- `fetchStatus`
- `getBusinessProfile`
- `profilePictureUrl`
- `presenceSubscribe`
- `sendPresenceUpdate`
- `readMessages`

Expected behavior:

- If exposed, each primitive should have a small, predictable command surface.
- Avoid duplicating existing commands unless the new surface adds something concrete.

### 8. Event Handling Cleanup

Consider consolidating runtime event handling around `sock.ev.process()`.

Expected behavior:

- This is a stability refactor, not a feature add.
- Do it after the missing command surfaces are covered.
- Keep the current behavior equivalent, especially for message processing and reconnect behavior.

## Non-Functional Requirements

- Preserve the current public/private permission model.
- Keep direct sends guarded by the current pacing layer.
- Do not regress reconnect stability or duplicate listeners.
- Keep support for the current Postgres auth fallback and the local session fallback.
- Keep existing status/newsletter handling unchanged unless the new work depends on it.

## Acceptance Criteria

The work is complete when:

- Each required feature above has a corresponding command or explicit decision not to implement it.
- Commands have clear permission handling and usage text.
- Reconnects do not duplicate handlers or resend startup side effects.
- Postgres-backed auth continues to work with local fallback.
- The bot still starts cleanly with either `DATABASE_TYPE=local` or `DATABASE_TYPE=postgres`.

## Suggested Order

1. Privacy commands
2. Chat management commands
3. Pairing-code login
4. Broadcast list support
5. Profile-picture removal
6. Explicit message edit
7. Selected primitive exposure
8. Event handling cleanup
