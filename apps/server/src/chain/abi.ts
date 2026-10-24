// ABI subset of contracts/src/TestnetPoolEscrow.sol, copied from the forge
// artifact (contracts/out/TestnetPoolEscrow.sol/TestnetPoolEscrow.json).
// Error entries are included so selector maps stay in sync with the contract.
// Read at build time only; nothing loads the artifact at runtime.

export const ESCROW_ABI = [
  {
    "type": "error",
    "name": "AccessControlBadConfirmation",
    "inputs": []
  },
  {
    "type": "error",
    "name": "AccessControlUnauthorizedAccount",
    "inputs": [
      {
        "name": "account",
        "type": "address"
      },
      {
        "name": "neededRole",
        "type": "bytes32"
      }
    ]
  },
  {
    "type": "error",
    "name": "AlreadyCanceled",
    "inputs": []
  },
  {
    "type": "error",
    "name": "AlreadyDeposited",
    "inputs": []
  },
  {
    "type": "error",
    "name": "AlreadySettled",
    "inputs": []
  },
  {
    "type": "error",
    "name": "BadDeadlines",
    "inputs": []
  },
  {
    "type": "error",
    "name": "BadEntry",
    "inputs": []
  },
  {
    "type": "error",
    "name": "BadSeats",
    "inputs": []
  },
  {
    "type": "error",
    "name": "DeadlineNotPassed",
    "inputs": []
  },
  {
    "type": "error",
    "name": "DeadlinePassed",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NotAdmin",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NotCancelable",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NotDepositor",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NotFunded",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NotSettled",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NotSettler",
    "inputs": []
  },
  {
    "type": "error",
    "name": "PrizeAlreadyPaid",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ReentrancyGuardReentrantCall",
    "inputs": []
  },
  {
    "type": "error",
    "name": "RefundAlreadyWithdrawn",
    "inputs": []
  },
  {
    "type": "error",
    "name": "RoomExists",
    "inputs": []
  },
  {
    "type": "error",
    "name": "RoomFull",
    "inputs": []
  },
  {
    "type": "error",
    "name": "RoomMissing",
    "inputs": []
  },
  {
    "type": "error",
    "name": "RoomNotFunding",
    "inputs": []
  },
  {
    "type": "error",
    "name": "TransferFailed",
    "inputs": []
  },
  {
    "type": "error",
    "name": "WinnerNotDepositor",
    "inputs": []
  },
  {
    "type": "error",
    "name": "WrongValue",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ZeroResultHash",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ZeroRoomKey",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ZeroWinner",
    "inputs": []
  },
  {
    "type": "event",
    "name": "DepositConfirmed",
    "inputs": [
      {
        "name": "roomKey",
        "type": "bytes32",
        "indexed": true
      },
      {
        "name": "player",
        "type": "address",
        "indexed": true
      },
      {
        "name": "amountWei",
        "type": "uint256",
        "indexed": false
      },
      {
        "name": "count",
        "type": "uint8",
        "indexed": false
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "MatchSettled",
    "inputs": [
      {
        "name": "roomKey",
        "type": "bytes32",
        "indexed": true
      },
      {
        "name": "winner",
        "type": "address",
        "indexed": true
      },
      {
        "name": "prizeWei",
        "type": "uint256",
        "indexed": false
      },
      {
        "name": "resultHash",
        "type": "bytes32",
        "indexed": false
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "PrizePaid",
    "inputs": [
      {
        "name": "roomKey",
        "type": "bytes32",
        "indexed": true
      },
      {
        "name": "winner",
        "type": "address",
        "indexed": true
      },
      {
        "name": "amountWei",
        "type": "uint256",
        "indexed": false
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "RefundWithdrawn",
    "inputs": [
      {
        "name": "roomKey",
        "type": "bytes32",
        "indexed": true
      },
      {
        "name": "player",
        "type": "address",
        "indexed": true
      },
      {
        "name": "amountWei",
        "type": "uint256",
        "indexed": false
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "RoleAdminChanged",
    "inputs": [
      {
        "name": "role",
        "type": "bytes32",
        "indexed": true
      },
      {
        "name": "previousAdminRole",
        "type": "bytes32",
        "indexed": true
      },
      {
        "name": "newAdminRole",
        "type": "bytes32",
        "indexed": true
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "RoleGranted",
    "inputs": [
      {
        "name": "role",
        "type": "bytes32",
        "indexed": true
      },
      {
        "name": "account",
        "type": "address",
        "indexed": true
      },
      {
        "name": "sender",
        "type": "address",
        "indexed": true
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "RoleRevoked",
    "inputs": [
      {
        "name": "role",
        "type": "bytes32",
        "indexed": true
      },
      {
        "name": "account",
        "type": "address",
        "indexed": true
      },
      {
        "name": "sender",
        "type": "address",
        "indexed": true
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "RoomCanceled",
    "inputs": [
      {
        "name": "roomKey",
        "type": "bytes32",
        "indexed": true
      },
      {
        "name": "reason",
        "type": "bytes32",
        "indexed": false
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "RoomCreated",
    "inputs": [
      {
        "name": "roomKey",
        "type": "bytes32",
        "indexed": true
      },
      {
        "name": "host",
        "type": "address",
        "indexed": true
      },
      {
        "name": "entryWei",
        "type": "uint256",
        "indexed": false
      },
      {
        "name": "maxSeats",
        "type": "uint8",
        "indexed": false
      },
      {
        "name": "fundingDeadline",
        "type": "uint64",
        "indexed": false
      },
      {
        "name": "resolutionDeadline",
        "type": "uint64",
        "indexed": false
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "RoomFunded",
    "inputs": [
      {
        "name": "roomKey",
        "type": "bytes32",
        "indexed": true
      },
      {
        "name": "potWei",
        "type": "uint256",
        "indexed": false
      }
    ],
    "anonymous": false
  },
  {
    "type": "function",
    "name": "cancelRoom",
    "inputs": [
      {
        "name": "roomKey",
        "type": "bytes32"
      },
      {
        "name": "reason",
        "type": "bytes32"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "createRoom",
    "inputs": [
      {
        "name": "roomKey",
        "type": "bytes32"
      },
      {
        "name": "seats",
        "type": "uint8"
      },
      {
        "name": "entryWei",
        "type": "uint256"
      },
      {
        "name": "fundingDeadline",
        "type": "uint64"
      },
      {
        "name": "resolutionDeadline",
        "type": "uint64"
      }
    ],
    "outputs": [],
    "stateMutability": "payable"
  },
  {
    "type": "function",
    "name": "entryBounds",
    "inputs": [],
    "outputs": [
      {
        "name": "min",
        "type": "uint256"
      },
      {
        "name": "max",
        "type": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "expireUnfunded",
    "inputs": [
      {
        "name": "roomKey",
        "type": "bytes32"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "expireUnresolved",
    "inputs": [
      {
        "name": "roomKey",
        "type": "bytes32"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "getRoom",
    "inputs": [
      {
        "name": "roomKey",
        "type": "bytes32"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "tuple",
        "components": [
          {
            "name": "host",
            "type": "address"
          },
          {
            "name": "maxSeats",
            "type": "uint8"
          },
          {
            "name": "depositCount",
            "type": "uint8"
          },
          {
            "name": "entryWei",
            "type": "uint256"
          },
          {
            "name": "potWei",
            "type": "uint256"
          },
          {
            "name": "fundingDeadline",
            "type": "uint64"
          },
          {
            "name": "resolutionDeadline",
            "type": "uint64"
          },
          {
            "name": "status",
            "type": "uint8"
          },
          {
            "name": "winner",
            "type": "address"
          },
          {
            "name": "resultHash",
            "type": "bytes32"
          },
          {
            "name": "cancelReason",
            "type": "bytes32"
          },
          {
            "name": "prizePaid",
            "type": "bool"
          }
        ]
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getRoomDepositors",
    "inputs": [
      {
        "name": "roomKey",
        "type": "bytes32"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "address[]"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "hasDeposited",
    "inputs": [
      {
        "name": "roomKey",
        "type": "bytes32"
      },
      {
        "name": "player",
        "type": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "hasRole",
    "inputs": [
      {
        "name": "role",
        "type": "bytes32"
      },
      {
        "name": "account",
        "type": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "joinRoom",
    "inputs": [
      {
        "name": "roomKey",
        "type": "bytes32"
      }
    ],
    "outputs": [],
    "stateMutability": "payable"
  },
  {
    "type": "function",
    "name": "maxFundingWindowSec",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint64"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "maxResolutionWindowSec",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint64"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "payout",
    "inputs": [
      {
        "name": "roomKey",
        "type": "bytes32"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "refundWithdrawn",
    "inputs": [
      {
        "name": "",
        "type": "bytes32"
      },
      {
        "name": "",
        "type": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "settle",
    "inputs": [
      {
        "name": "roomKey",
        "type": "bytes32"
      },
      {
        "name": "winner",
        "type": "address"
      },
      {
        "name": "resultHash",
        "type": "bytes32"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "SETTLER_ROLE",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "bytes32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "withdrawRefund",
    "inputs": [
      {
        "name": "roomKey",
        "type": "bytes32"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
] as const;

// `TestnetPoolEscrow.EscrowStatus` ordinals, pinned by ABI_HANDOFF §2.
// NONE is the zero value: getRoom on an unknown key returns it, meaning
// "this room does not exist", not "funding has not started".
export enum EscrowStatus {
  NONE = 0,
  FUNDING = 1,
  FUNDED = 2,
  SETTLED = 3,
  CANCELED = 4,
}
