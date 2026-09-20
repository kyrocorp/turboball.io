const http = require("http");
const WebSocket = require("ws");

const PORT = process.env.PORT || 10000;

const httpServer = http.createServer((req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/plain; charset=utf-8"
  });

  res.end("Rocket League.io server online");
});

const wss = new WebSocket.Server({
  server: httpServer
});

const waitingPlayers = [];
const matches = new Map();

let nextPlayerId = 1;
let nextMatchId = 1;

function send(player, data) {
  if (!player || !player.ws) return;

  if (player.ws.readyState === WebSocket.OPEN) {
    player.ws.send(JSON.stringify(data));
  }
}

function removeFromQueue(player) {
  const index = waitingPlayers.indexOf(player);

  if (index !== -1) {
    waitingPlayers.splice(index, 1);
  }

  player.searching = false;
}

function makeMatch(player1, player2) {
  const matchId = "match-" + nextMatchId++;

  const match = {
    id: matchId,
    player1,
    player2
  };

  matches.set(matchId, match);

  player1.match = match;
  player2.match = match;

  player1.searching = false;
  player2.searching = false;

  send(player1, {
    type: "match-found",
    matchId,
    playerNumber: 1,
    team: "blue",
    isHost: true
  });

  send(player2, {
    type: "match-found",
    matchId,
    playerNumber: 2,
    team: "orange",
    isHost: false
  });

  console.log(
    `Match ${matchId}: ${player1.id} vs ${player2.id}`
  );
}

function findOpponent(player) {
  for (let i = 0; i < waitingPlayers.length; i++) {
    const opponent = waitingPlayers[i];

    if (
      opponent !== player &&
      opponent.searching &&
      !opponent.match
    ) {
      waitingPlayers.splice(i, 1);
      makeMatch(opponent, player);
      return true;
    }
  }

  return false;
}

function disconnectMatch(player) {
  const match = player.match;

  if (!match) return;

  const opponent =
    match.player1 === player
      ? match.player2
      : match.player1;

  matches.delete(match.id);

  player.match = null;

  if (opponent) {
    opponent.match = null;

    send(opponent, {
      type: "opponent-left"
    });
  }
}

wss.on("connection", ws => {
  const player = {
    id: "player-" + nextPlayerId++,
    ws,
    searching: false,
    match: null
  };

  console.log("Player connected:", player.id);

  send(player, {
    type: "connected",
    playerId: player.id
  });

  ws.on("message", raw => {
    let data;

    try {
      data = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (data.type === "ping") {
      send(player, {
        type: "pong"
      });

      return;
    }

    if (data.type === "find-match") {
      if (player.match) return;

      removeFromQueue(player);

      player.searching = true;

      const found = findOpponent(player);

      if (!found) {
        waitingPlayers.push(player);

        send(player, {
          type: "searching"
        });

        console.log(
          `${player.id} is searching for a 1v1`
        );
      }

      return;
    }

    if (data.type === "cancel-search") {
      removeFromQueue(player);

      send(player, {
        type: "search-cancelled"
      });

      return;
    }

    if (data.type === "input") {
      if (!player.match) return;

      const opponent =
        player.match.player1 === player
          ? player.match.player2
          : player.match.player1;

      send(opponent, {
        type: "opponent-input",
        input: data.input
      });

      return;
    }

    if (data.type === "game-state") {
      if (!player.match) return;

      // Only the host is allowed to send authoritative game state.
      if (player.match.player1 !== player) return;

      const opponent = player.match.player2;

      send(opponent, {
        type: "game-state",
        state: data.state
      });

      return;
    }

    if (data.type === "leave-match") {
      disconnectMatch(player);

      return;
    }
  });

  ws.on("close", () => {
    console.log("Player disconnected:", player.id);

    removeFromQueue(player);
    disconnectMatch(player);
  });

  ws.on("error", () => {
    removeFromQueue(player);
    disconnectMatch(player);
  });
});

httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(
    `Rocket League.io server listening on port ${PORT}`
  );
});
if (data.type === "get-notifications") {
  send(player, { type: "notifications-sync", notifications: serverNotifications });
  return;
}

if (data.type === "admin-add-notification") {
  serverNotifications.unshift(data.notification);
  broadcastNotifications();
  return;
}

if (data.type === "admin-delete-notification") {
  serverNotifications = serverNotifications.filter(n => n.id !== data.id);
  broadcastNotifications();
  return;
}
if (data.type === "admin-stats") {
  send(player, {
    type: "admin-stats",
    matchCount: matches.size
  });
  return;
}
