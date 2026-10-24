# CHANGELOG

## v0.3 — 23 October 2026 (Cross-platform sprint revision)
**Breaking decisions:**
- Changed **fixed isometric view** to **third-person orbit-follow**. Mouse drag/scroll (desktop), swipe right side (mobile).
- Replaced **Space dash + five-second cooldown** with **Shift/RUN five-bar stamina sprint**: 1 bar/s consumption, 1.5 s delay, 1 bar/s regeneration, walk 4.5 and sprint 7.0 units/s.
- Promoted **mobile web gameplay to P0**, not desktop-only/mobile spectator fallback. Responsive portrait menus + landscape arena, left floating joystick, right camera swipe, RUN toggle, PASS button.
- Unified desktop/mobile controller output; server authoritative normalized movement, sprint and nearest-target bomb PASS. Changed Socket.IO contract accordingly.
- Added 3 developer + AI agent parallel ownership, QA crossplay matrix, camera/stamina canonical specs, and typed API contract.
- Clarified virtual room entry is **virtual points** in P0. Real test MON escrow is optional P2; mainnet wagering remains excluded.

**Documents updated:** README, BRD, PRD, SYS, ERD, TRD, FLOWCHART, design, DECISIONS.  
**Documents added:** GAMEPLAY_CONTROLS, API_CONTRACT, QA_CROSSPLAY, AGENT_HANDOFF, CHANGELOG.

## v0.1 — 23 October 2026
Original desktop-first 3D hot-potato specification with isometric camera and dash action. Superseded by v0.3.
