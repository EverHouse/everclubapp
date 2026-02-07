## 2025-05-14 - WebSocket Staff Broadcast Optimization
**Learning:** Iterating over all connected clients (O(N)) to find a small subset of staff (O(M)) is a significant CPU bottleneck as the member base grows. The server already had a `staffEmails` Set, but it was only being used for tracking, not for efficient broadcasting.
**Action:** Use the `staffEmails` Set to perform O(M) broadcasts for staff-only notifications. Ensure that mixed broadcasts (affected member + staff) also use this optimized path while avoiding duplicate messages to the member if they are also staff.
