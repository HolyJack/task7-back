import { Server } from "socket.io";
import { config } from "dotenv";
import { randomUUID } from "crypto";

config();

const io = new Server(3000, {
  cors: {
    origin: process.env.URL,
  },
});

type Game = "tic-tac-toe" | "battleships";
type GameConfig = {
  checkOver: (turns: number[]) => undefined | number;
  playersNumber: number;
};
type GameConfigs = Record<Game, GameConfig>;
type SessionConfig = {
  type: Game;
  players: string[];
  turn: string;
  turns: number[];
  playerFields: number[][];
};

const gameConfigs: GameConfigs = {
  "tic-tac-toe": {
    playersNumber: 2,
    checkOver: (turns) => {
      if (turns.length === 9) return 2;
      const winningCombinations = [
        [0, 1, 2],
        [3, 4, 5],
        [6, 7, 8],
        [0, 3, 6],
        [1, 4, 7],
        [2, 5, 8],
        [0, 4, 8],
        [2, 4, 6],
      ];

      for (let playerIndex = 0; playerIndex < 2; playerIndex++) {
        const playerMoves = turns.filter(
          (_, index) => index % 2 === playerIndex,
        );

        for (const combination of winningCombinations) {
          if (combination.every((turn) => playerMoves.includes(turn))) {
            return playerIndex;
          }
        }
      }
      return undefined;
    },
  },
  battleships: {
    playersNumber: 2,
    checkOver: (turns) => {
      return turns.length ? turns.length : undefined;
    },
  },
};

const gameSessions: Record<string, SessionConfig> = {};

io.on("connection", (socket) => {
  socket.on("create new game", (game: Game) => {
    const session_uuid = randomUUID().toString();

    socket.join(session_uuid);
    gameSessions[session_uuid] = {
      type: game,
      players: [socket.id],
      turn: socket.id,
      turns: [],
      playerFields: [],
    };
    io.to(session_uuid).emit("game created", session_uuid);
  });

  socket.on("join game", (session_uuid: string, game: Game) => {
    if (
      gameSessions[session_uuid] &&
      gameSessions[session_uuid].type === game
    ) {
      const gameSes = gameSessions[session_uuid];
      if (gameSes.players.length >= gameConfigs[gameSes.type].playersNumber) {
        io.to(socket.id).emit("failed", "session is full");
        return;
      }
      socket.join(session_uuid);
      gameSes.players.push(socket.id);
      io.to(session_uuid).emit("player 2 joined", session_uuid);
      return;
    }
    io.to(socket.id).emit("failed", "no session");
  });

  socket.on("make turn", (session_uuid: string, turn: number) => {
    if (gameSessions[session_uuid]) {
      const gameSession = gameSessions[session_uuid];
      const gameConfig = gameConfigs[gameSession.type];
      if (gameSession.players.length !== gameConfig.playersNumber) {
        io.to(socket.id).emit("failed", "no second player!");
        return;
      }
      if (gameSession.turns.includes(turn)) {
        io.to(socket.id).emit("wrong turn");
        return;
      }

      console.log("second player connected");
      const curturn = gameSession.turn;
      if (curturn === socket.id) {
        const indexOfNext =
          (gameSession.players.indexOf(gameSession.turn) + 1) %
          gameConfig.playersNumber;

        gameSession.turn = gameSession.players[indexOfNext];
        gameSession.turns.push(turn);
        socket.in(session_uuid).emit("new turn", turn);
        const gameStatus = gameConfig.checkOver(gameSession.turns);
        if (gameStatus !== undefined) {
          io.to(session_uuid).emit("game finished", gameStatus);
        }
      }
      io.to(socket.id).emit("failed", "wait for your turn!");
      return;
    }
    io.to(socket.id).emit("failed", "no session");
  });

  socket.on("player ready", (session_uuid: string, player_field: number[]) => {
    const gameSession = gameSessions[session_uuid];
    if (!gameSession) {
      io.to(socket.id).emit("error", "no session");
      return;
    }
    if (!player_field) return;
    gameSession.playerFields[gameSession.players.indexOf(socket.id)] =
      player_field;
    io.in(session_uuid).emit(
      "player ready",
      gameSession.players.indexOf(socket.id),
    );
  });

  socket.on("make turn battleships", (session_uuid: string, turn: number) => {
    const gameSession = gameSessions[session_uuid];
    if (!gameSession) {
      io.to(socket.id).emit("error", "no session");
      return;
    }
    if (gameSession.turn !== socket.id) return;
    if (turn < 0 || turn > 99) return;

    const player = gameSession.players.indexOf(socket.id);
    const enemy = (player + 1) % 2;

    gameSession.turn = gameSession.players[enemy];

    if (player === undefined) return;
    const targetCell = gameSession.playerFields[enemy][turn];
    if (targetCell === 1) {
      gameSession.playerFields[enemy][turn] = 2;
      io.to(session_uuid).emit("turn result", enemy, turn, 2);
    }
    if (targetCell === 0) {
      gameSession.playerFields[enemy][turn] = 3;
      io.to(session_uuid).emit("turn result", enemy, turn, 3);
    }
    const hits = gameSession.playerFields[enemy].reduce(
      (acc, e) => acc + (e === 2 ? 1 : 0),
    );
    console.log(hits);
    if (hits === 1 * 5 + 2 * 4 + 3 * 3 + 2 * 4) {
      io.to(session_uuid).emit("game finished", player);
    }
  });

  socket.on("exit game", (session_uuid: string) => {
    io.in(session_uuid).emit("exit game");
    io.in(session_uuid).socketsLeave(session_uuid);
  });
});
