# Baileys Gap Manual Verification

This checklist verifies the command surface added in `plugins/baileys-gap.js`.

## Preconditions

1. Start bot with `npm start` (or `node messageforge.js`).
2. Use one owner account and one non-owner account.
3. Prepare one private chat and one group chat where the bot is present.
4. Ensure logs are visible to observe reconnect/listener behavior.

## Permission Gates (Owner-Only)

Run each command from a non-owner account and confirm access is denied:

- `.privacy`
- `.chatarchive`
- `.chatmute 8h`
- `.chatstar` (reply case)
- `.broadcastlist <jid@broadcast>`
- `.removepp`
- `.msgedit test`
- `.paircode <number>`
- `.waon <number>`
- `.statusof <number>`
- `.bizprofileof <number>`
- `.ppurlof <number>`
- `.presub <number>`
- `.sendpresence available`
- `.readmsg` (reply case)

Expected: owner-only rejection response for all above.

## Privacy Commands

From owner account:

1. `.privacy` and verify current values are listed.
2. Update each field and verify success response:
   - `.privacy lastseen contacts`
   - `.privacy online match_last_seen`
   - `.privacy profile contacts`
   - `.privacy status contacts`
   - `.privacy readreceipts all`
   - `.privacy groupsadd contacts`
   - `.privacy disappearing 86400`
3. Send invalid values (for example `.privacy online foo`) and verify usage/error response.

## Chat Management Commands

### Private chat behavior

1. `.chatarchive` then `.chatunarchive`.
2. `.chatmute 8h` then `.chatunmute`.
3. `.chatread` then `.chatunread`.
4. Reply to a message with `.chatstar`, then `.chatunstar`.
5. Reply to a message with `.chatclear`.
6. `.chatdelete`.

Expected: success responses and no crashes.

### Group behavior

1. Run `.chatmute 8h` in group.
2. Expected: explicit private-chat-only rejection.

## Pairing Code Flow

### Command path

1. In an unregistered session, run `.paircode <number_with_country_code>`.
2. Confirm pairing code is returned.

### Boot path

1. Set:
   - `PAIRING_CODE=true`
   - `PAIRING_NUMBER=<digits>`
2. Restart bot with unregistered auth and confirm code logs on `connection.update`.
3. Simulate/observe transient failure and confirm retry occurs on subsequent `connection.update` (flag reset path).
4. Verify QR fallback still prints when pairing is not configured or fails.

## Broadcast List Support

1. Get a broadcast JID (`<timestamp>@broadcast`).
2. Run `.broadcastlist <jid>` (or `.blistinfo <jid>`).
3. Confirm metadata is returned (name/subject + recipient count).

## Profile Picture Removal

1. Set profile picture first (existing `.pp` flow).
2. Run `.removepp` (or `.clearpp`).
3. Confirm picture is removed.

## Explicit Message Edit

1. Send a bot-owned message.
2. Reply to it with `.msgedit <new text>`.
3. Confirm target message edits in chat.
4. Confirm anti-edit receive-side logic still functions independently for remote edits.

## Primitive Exposure Commands

From owner account, validate each command:

1. `.waon <number>`
2. `.statusof <number>` (verify it reads status correctly, including list-shaped fetchStatus result)
3. `.bizprofileof <number>`
4. `.ppurlof <number>`
5. `.presub <number>`
6. `.sendpresence available [number]`
7. `.readmsg` (reply to a message)

## Reconnect / Listener Stability

1. Start bot and send one command (for example `.privacy`), note one response.
2. Force reconnect (toggle network or restart process).
3. Send same command again.
4. Confirm:
   - one response only (no duplicate handling),
   - no duplicate startup side effects beyond expected throttling,
   - no repeated event spam indicating duplicate listeners.

## Sign-off Template

- Date:
- Tester:
- Environment (`local`/`postgres`):
- Result: Pass / Fail
- Notes:
