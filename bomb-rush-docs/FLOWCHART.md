# FLOWCHART — v0.5 End-to-End Journeys & Recovery

## A. Player journey
```mermaid
flowchart TD
  HOME[Landing] --> MODE{Create / Join}
  MODE -->|Create| HOST[Set 3/4 seats and exact test MON]
  MODE -->|Join| LOOKUP[Enter code; inspect immutable pool]
  HOST --> WALLET[Connect wallet and switch Monad Testnet 10143]
  LOOKUP --> WALLET
  WALLET --> AUTH[Prove wallet ownership via signed nonce]
  AUTH --> TX{Host createRoom + deposit OR player joinRoom deposit}
  TX -->|Reject/revert| ERR[Show reason and retry / leave]
  TX -->|Submitted| RECEIPT[Verify correct chain, contract, room, amount, sender and receipt]
  RECEIPT -->|Not confirmed| PENDING[Pending; poll / check explorer] --> RECEIPT
  RECEIPT -->|Confirmed| LOBBY[Lobby: funded seat shown]
  LOBBY --> CHECK{All selected seats funded + ready?}
  CHECK -->|No| LOBBY
  CHECK -->|Yes| CD[15s countdown; lock admissions]
  CD --> GAME[3D match 20/30s nominal]
  GAME -->|Unrecoverable| ABORT[No invented winner; cancel/expire + refunds]
  GAME -->|Last survivor| RESULT[Operator emits winner/result hash]
  RESULT --> SETTLE{settle on chain verified?}
  SETTLE -->|Yes| CLAIMABLE[Show claimable prize]
  CLAIMABLE --> PAY[payout trigger → winner only]
  PAY -->|Confirmed| DONE[Explorer proof; Play Again new room]
  SETTLE -->|No| RECOVER[Retry if allowed / deadline-based refund recovery]
  ABORT --> RECOVER
```

## B. Escrow contract state machine
```mermaid
stateDiagram-v2
  [*] --> NONE
  NONE --> FUNDING: createRoom payable / host deposit
  FUNDING --> FUNDING: joinRoom payable / exact amount
  FUNDING --> FUNDED: count reaches seats
  FUNDING --> CANCELED: operator cancel OR expireUnfunded after deadline
  FUNDED --> SETTLED: onlySettler settle before resolution deadline
  FUNDED --> CANCELED: operator cancel OR expireUnresolved after deadline
  SETTLED --> SETTLED: payout exactly once; prizePaid=true
  CANCELED --> CANCELED: each depositor withdrawRefund once
```
`SETTLED` means claimable **not necessarily paid**; `CANCELED` means refundable **not necessarily withdrawn**. The escrow state is separate from game status.

## C. Server restart with funds escrowed
```mermaid
flowchart TD
  R[Server process disappears] --> CH[On-chain room still exists]
  CH --> S{Contract state?}
  S -->|SETTLED| P[Permissionless payout if not already paid]
  S -->|CANCELED| RF[Depositor withdrawRefund]
  S -->|FUNDING & past deadline| E1[Anyone expireUnfunded] --> RF
  S -->|FUNDED & past resolution deadline| E2[Anyone expireUnresolved] --> RF
  S -->|Not expired| WAIT[Wait for operator cancel or deadline; explain timing]
  WAIT --> S
```

## D. Verification / trust boundaries
```mermaid
sequenceDiagram
  participant P as Browser + Wallet
  participant B as Game Server
  participant C as Monad Escrow
  P->>B: prepare / join-intent (wallet signed challenge)
  B-->>P: roomKey + exact entryWei + deadline
  P->>C: payable createRoom/joinRoom
  C-->>P: transaction hash (not proof yet)
  P->>B: txHash (untrusted reference)
  B->>C: fetch receipt + verify event/status
  C-->>B: verified member, amount, roomKey
  B-->>P: funded seat + accurate pool
  Note over P,B: Live movement off-chain, no blockchain per frame
  B->>C: onlySettler settle(winner,resultHash)
  C-->>B: MatchSettled confirmed
  B-->>P: winner claimable
  P->>C: payout(roomKey)
  C-->>P: PrizePaid receipt; winner address fixed
```
