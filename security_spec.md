# PulseLite Security Specification (Phase 0 TDD)

## 1. Data Invariants
1. **PII Isolation**: User email addresses and private preferences live exclusively in `/users/{userId}/private/{docId}` and may only be read or written by the authenticated owner (`request.auth.uid == userId` with `email_verified == true`). Public profiles at `/users/{userId}` never store emails, phones, or addresses.
2. **Room Membership Gate**: A chat room (`/rooms/{roomId}`) must contain 1 to 20 participant UIDs (`participantIds`), must include its creator (`createdBy == request.auth.uid`) on creation, and may only be read, listed, or updated by current participants (`request.auth.uid in resource.data.participantIds`).
3. **Message Master Gate & Ownership**: A message (`/rooms/{roomId}/messages/{messageId}`) cannot exist without a valid parent room (`/rooms/{roomId}`), must match the parent room's `roomParticipantIds`, and must have `senderId == request.auth.uid` on creation.
4. **Immutable Provenance & Temporal Integrity**: `createdAt`, `createdBy`, `senderId`, `roomId`, `id`, and `clientCreatedAt` are immutable after creation. All `createdAt` and `updatedAt` fields must equal `request.time`.
5. **Bounded Payloads (Denial-of-Wallet Guard)**: Every document ID must match `^[a-zA-Z0-9_\-]+$` (`<= 128` chars), message `text` is capped at `2000` chars, and optional compressed `attachmentDataUrl` is capped at `120000` bytes.

## 2. The "Dirty Dozen" Attack Payloads
1. **Identity Spoofing on PublicUser**: Authenticated User A creates `/users/userB` with `uid: "userB"`. Expected: `PERMISSION_DENIED`.
2. **PII Leak via Blanket Read**: User A reads `/users/userB/private/info`. Expected: `PERMISSION_DENIED`.
3. **Unverified Email Write**: User with `email_verified: false` attempts to create a room. Expected: `PERMISSION_DENIED`.
4. **Shadow Field Injection on Room**: User A creates `/rooms/r1` with an extra ghost field `isOfficial: true`. Expected: `PERMISSION_DENIED`.
5. **Oversized Room Membership**: User A creates `/rooms/r1` with 25 `participantIds`. Expected: `PERMISSION_DENIED`.
6. **Non-Participant Room Hijack**: User C (not in `participantIds`) updates `/rooms/r1` to add themselves. Expected: `PERMISSION_DENIED`.
7. **Orphaned Message Creation**: User A creates `/rooms/nonexistent/messages/m1`. Expected: `PERMISSION_DENIED`.
8. **Sender Spoofing in Message**: User A creates `/rooms/r1/messages/m1` with `senderId: "userB"`. Expected: `PERMISSION_DENIED`.
9. **Client Timestamp Forgery**: User A creates a message with `createdAt` set to a past timestamp instead of `request.time`. Expected: `PERMISSION_DENIED`.
10. **ID Poisoning**: User A writes to `/rooms/invalid$id..with..dots` or 500-char ID. Expected: `PERMISSION_DENIED`.
11. **Attachment Resource Exhaustion**: User A creates a message with a 500KB `attachmentDataUrl` (> 120KB limit). Expected: `PERMISSION_DENIED`.
12. **Message Text Tampering**: User A updates `/rooms/r1/messages/m1` to alter `text` or `senderId` after creation (only `status: 'sent' -> 'delivered'` is permitted by participants). Expected: `PERMISSION_DENIED`.
